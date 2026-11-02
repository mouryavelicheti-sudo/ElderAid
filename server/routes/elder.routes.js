const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify, notifyCaregiversOfElder, notifyAdmins, logActivity } = require('../notify');
const { validateElderProfile, validateAppointmentSlot, validateAppointmentReason } = require('../validators');
const { slotConflict } = require('../appointments');
const { generateOccurrences, upcomingOccurrences, todayStr } = require('../schedule');
const { sendExternal, queueExternal, dispatchExternal, deliveriesForAlert } = require('../delivery');

const router = express.Router();
router.use(requireAuth, requireRole('ELDER'));

// Local-date helper shared with the scheduler (was UTC; slots/appointments are local time).
const today = () => todayStr();

// ---- Profile ----
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone FROM users WHERE id=?').get(req.user.id);
  const profile = db.prepare('SELECT * FROM elder_profiles WHERE user_id=?').get(req.user.id) || {};
  res.json({ ...user, ...profile });
});

router.put('/profile', (req, res) => {
  const current = {
    ...(db.prepare('SELECT name, phone FROM users WHERE id=?').get(req.user.id) || {}),
    ...(db.prepare('SELECT * FROM elder_profiles WHERE user_id=?').get(req.user.id) || {}),
  };

  // REQ-F-13: validate EVERYTHING before any database write.
  const { errors, values } = validateElderProfile(req.body, current);
  const messages = Object.values(errors);
  if (messages.length > 0) {
    // REQ-F-17: a specific, user-visible message (plus per-field detail for the form).
    return res.status(400).json({ error: messages.join(' '), errors });
  }

  // Always the logged-in elder (JWT) — body ids are ignored, so one elder cannot edit another.
  const save = db.transaction(() => {
    db.prepare('UPDATE users SET name=?, phone=? WHERE id=?')
      .run(values.name, values.phone || null, req.user.id);
    const exists = db.prepare('SELECT user_id FROM elder_profiles WHERE user_id=?').get(req.user.id);
    const nul = (v) => (v === '' ? null : v);
    if (exists) {
      db.prepare(`UPDATE elder_profiles SET dob=?, address=?, blood_group=?, emergency_contact_name=?, emergency_contact_phone=?, notes=? WHERE user_id=?`)
        .run(nul(values.dob), nul(values.address), nul(values.blood_group), nul(values.emergency_contact_name),
             nul(values.emergency_contact_phone), nul(values.notes), req.user.id);
    } else {
      db.prepare(`INSERT INTO elder_profiles (user_id,dob,address,blood_group,emergency_contact_name,emergency_contact_phone,notes) VALUES (?,?,?,?,?,?,?)`)
        .run(req.user.id, nul(values.dob), nul(values.address), nul(values.blood_group), nul(values.emergency_contact_name),
             nul(values.emergency_contact_phone), nul(values.notes));
    }
  });
  save();
  res.json({ ok: true, profile: values });
});

// ---- Medications (today's schedule, ensures log rows exist) ----
// REQ-F-23/24: today's doses are the scheduled occurrences generated from the prescriptions.
function getTodaysMeds(elderId) {
  generateOccurrences({ elderId }); // idempotent
  return db.prepare(`
    SELECT m.id, m.name, m.dosage, m.frequency, m.time_slot, m.instructions, p.doctor_id, u.name as doctor_name,
           ml.status, ml.scheduled_time, ml.auto_missed, ml.updated_at
    FROM medication_logs ml
    JOIN medications m ON m.id = ml.medication_id
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN users u ON u.id = p.doctor_id
    WHERE p.elder_id = ? AND ml.log_date = ?
    ORDER BY CASE m.time_slot WHEN 'Morning' THEN 1 WHEN 'Afternoon' THEN 2 WHEN 'Evening' THEN 3 ELSE 4 END, m.id
  `).all(elderId, today());
}

router.get('/medications/today', (req, res) => {
  res.json(getTodaysMeds(req.user.id));
});

router.put('/medications/:medId/status', (req, res) => {
  const { status } = req.body;
  if (!['Taken', 'Missed', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const med = db.prepare(`
    SELECT m.id FROM medications m JOIN prescriptions p ON p.id=m.prescription_id
    WHERE m.id=? AND p.elder_id=?
  `).get(req.params.medId, req.user.id);
  if (!med) return res.status(404).json({ error: 'Medication not found.' });

  generateOccurrences({ elderId: req.user.id });
  const log = db.prepare(`SELECT id, status FROM medication_logs WHERE medication_id=? AND log_date=?`).get(med.id, today());
  if (!log) return res.status(400).json({ error: 'This medicine is not scheduled for today.' });

  // Elder confirmation (Taken/Missed/Pending). auto_missed is cleared: this is now the elder's own word.
  db.prepare(`UPDATE medication_logs SET status=?, auto_missed=0, updated_at=datetime('now') WHERE id=?`)
    .run(status, log.id);

  // Missed medication → alert the elder's caregivers. Only on a real transition and de-duplicated,
  // so it cannot double-notify if the scheduler already marked this dose Missed.
  if (status === 'Missed' && log.status !== 'Missed') {
    const medInfo = db.prepare(`
      SELECT m.name, m.dosage, m.time_slot, u.name AS elder_name
      FROM medications m JOIN prescriptions p ON p.id=m.prescription_id
      JOIN users u ON u.id=p.elder_id WHERE m.id=?
    `).get(med.id);
    notifyCaregiversOfElder(
      req.user.id, 'MISSED_MEDICATION',
      `Missed medication: ${medInfo.elder_name}`,
      `${medInfo.elder_name} marked ${medInfo.name} ${medInfo.dosage} (${medInfo.time_slot}) as missed today.`,
      { dedupePrefix: `medmiss:${log.id}` }
    );
    logActivity(req.user.id, medInfo.elder_name, 'MEDICATION_MISSED',
      `${medInfo.name} ${medInfo.dosage} (${medInfo.time_slot}) marked as missed.`);
  }
  res.json({ ok: true });
});

// ---- Medication schedule: today + upcoming days generated from prescriptions (REQ-F-23/24) ----
router.get('/medications/schedule', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 14);
  generateOccurrences({ elderId: req.user.id });
  res.json(upcomingOccurrences(req.user.id, days));
});

// ---- Medication history (past check-in logs) ----
router.get('/medications/history', (req, res) => {
  const days = Math.min(Number(req.query.days) || 30, 90);
  const rows = db.prepare(`
    SELECT ml.log_date, ml.status, ml.updated_at, ml.scheduled_time, ml.auto_missed,
           m.id AS medication_id, m.name, m.dosage, m.frequency, m.time_slot
    FROM medication_logs ml
    JOIN medications m ON m.id = ml.medication_id
    JOIN prescriptions p ON p.id = m.prescription_id
    WHERE p.elder_id = ? AND ml.log_date >= date('now', ?)
    ORDER BY ml.log_date DESC,
      CASE m.time_slot WHEN 'Morning' THEN 1 WHEN 'Afternoon' THEN 2 WHEN 'Evening' THEN 3 ELSE 4 END
  `).all(req.user.id, `-${days} days`);
  res.json(rows);
});

// ---- Health records (elder views their own) ----
router.get('/health-records', (req, res) => {
  const rows = db.prepare(`
    SELECT h.id, h.record_type, h.title, h.description, h.created_at, h.updated_at,
           u.name AS doctor_name, d.specialization
    FROM health_records h
    JOIN users u ON u.id = h.doctor_id
    LEFT JOIN doctor_profiles d ON d.user_id = h.doctor_id
    WHERE h.elder_id = ? ORDER BY h.created_at DESC, h.id DESC
  `).all(req.user.id);
  res.json(rows);
});

// ---- Emergency SOS ----
// Active alert (if any) + full history for the logged-in elder.
router.get('/sos', (req, res) => {
  const alerts = db.prepare(`
    SELECT id, message, status, created_at, updated_at
    FROM emergency_alerts WHERE elder_id=? ORDER BY created_at DESC, id DESC
  `).all(req.user.id);
  res.json(alerts.map(a => ({ ...a, contactDeliveries: deliveriesForAlert(a.id) })));
});

// SOS flow (REQ-F-52..58, 69..71):
//   Elder → Emergency alert saved → Emergency CONTACT notification (external delivery record)
//         → Caregiver in-app notifications → Administrator in-app escalation.
// A failure in one notification step never blocks the alert or the later steps.
router.post('/sos', (req, res) => {
  const existing = db.prepare(
    `SELECT id FROM emergency_alerts WHERE elder_id=? AND status='ACTIVE'`
  ).get(req.user.id);
  if (existing) {
    return res.status(409).json({ error: 'You already have an active emergency alert. Your caregivers have been notified.' });
  }

  const rawMsg = req.body && req.body.message;
  if (rawMsg !== undefined && rawMsg !== null && typeof rawMsg !== 'string') {
    return res.status(400).json({ error: 'The emergency message must be text.' });
  }
  const message = (rawMsg || '').trim() || 'Emergency assistance needed.';
  if (message.length > 500) {
    return res.status(400).json({ error: 'The emergency message must be at most 500 characters.' });
  }

  let alertId;
  try {
    alertId = Number(db.prepare(
      `INSERT INTO emergency_alerts (elder_id, message, status) VALUES (?,?,'ACTIVE')`
    ).run(req.user.id, message).lastInsertRowid);
  } catch (err) {
    console.error('SOS insert failed', err);
    return res.status(500).json({ error: 'We could not create your emergency alert. Please call your emergency contact or local emergency number directly.' });
  }

  // REQ-F-57: determine the elder's emergency contact (existing elder_profiles columns, not duplicated).
  const elder = db.prepare(`
    SELECT u.name, u.phone, e.emergency_contact_name, e.emergency_contact_phone, e.address
    FROM users u LEFT JOIN elder_profiles e ON e.user_id=u.id WHERE u.id=?
  `).get(req.user.id);

  const detail = `${elder.name} triggered an SOS: "${message}"` +
    (elder.address ? ` Address: ${elder.address}.` : '') +
    (elder.emergency_contact_name ? ` Emergency contact: ${elder.emergency_contact_name} (${elder.emergency_contact_phone || 'no phone'}).` : '');

  // REQ-F-58 / REQ-F-70: emergency-contact notification (external channel; honest delivery status).
  let contactDelivery = null;
  try {
    if (elder.emergency_contact_name || elder.emergency_contact_phone) {
      contactDelivery = sendExternal({
        channel: 'SMS', type: 'EMERGENCY',
        title: `EMERGENCY: ${elder.name} needs help`,
        message: `${elder.name} pressed the ElderAid SOS button: "${message}".` +
          (elder.address ? ` Address: ${elder.address}.` : '') + (elder.phone ? ` Call: ${elder.phone}.` : ''),
        recipientName: elder.emergency_contact_name, recipientContact: elder.emergency_contact_phone,
        alertId,
      }, { ownerId: req.user.id, ownerName: elder.name });
    } else {
      // No contact on file: record that explicitly instead of silently skipping.
      const id = queueExternal({
        channel: 'SMS', type: 'EMERGENCY', title: `EMERGENCY: ${elder.name} needs help`,
        message, recipientName: null, recipientContact: null, alertId,
      });
      contactDelivery = dispatchExternal(id, { ownerId: req.user.id, ownerName: elder.name });
    }
  } catch (err) {
    console.error('Emergency contact notification step failed:', err);
  }

  let caregiversNotified = 0, adminsNotified = 0;
  try { caregiversNotified = notifyCaregiversOfElder(req.user.id, 'EMERGENCY', `SOS alert: ${elder.name}`, detail, { alertId }); }
  catch (err) { console.error('Caregiver SOS notification failed:', err); }
  try { adminsNotified = notifyAdmins('EMERGENCY', `SOS alert: ${elder.name}`, detail, { alertId }); }
  catch (err) { console.error('Admin SOS notification failed:', err); }

  try {
    logActivity(req.user.id, elder.name, 'SOS_TRIGGERED',
      `${message} | contact: ${contactDelivery ? contactDelivery.delivery_status : 'none'}, caregivers notified: ${caregiversNotified}, admins notified: ${adminsNotified}`);
  } catch (err) { console.error(err); }

  res.status(201).json({
    id: alertId, status: 'ACTIVE',
    inApp: { caregiversNotified, adminsNotified },
    emergencyContact: contactDelivery && {
      name: contactDelivery.recipient_name, phone: contactDelivery.recipient_contact,
      channel: contactDelivery.channel, delivery_status: contactDelivery.delivery_status,
      delivery_error: contactDelivery.delivery_error,
    },
  });
});

// Elder can cancel their own active alert (e.g. pressed by mistake).
router.put('/sos/:id/cancel', (req, res) => {
  const alert = db.prepare(
    `SELECT * FROM emergency_alerts WHERE id=? AND elder_id=?`
  ).get(req.params.id, req.user.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found.' });
  if (alert.status !== 'ACTIVE') {
    return res.status(400).json({ error: 'Only an active alert can be cancelled.' });
  }
  db.prepare(`UPDATE emergency_alerts SET status='CANCELLED', updated_at=datetime('now') WHERE id=?`)
    .run(alert.id);

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id).name;
  notifyCaregiversOfElder(req.user.id, 'EMERGENCY', `SOS cancelled: ${elderName}`,
    `${elderName} cancelled their emergency alert (raised ${alert.created_at}).`);
  logActivity(req.user.id, elderName, 'SOS_CANCELLED', `Alert #${alert.id} cancelled by elder.`);
  res.json({ ok: true });
});

// ---- Prescriptions ----
router.get('/prescriptions', (req, res) => {
  const rx = db.prepare(`
    SELECT p.id, p.notes, p.created_at, p.updated_at, u.name as doctor_name, d.specialization
    FROM prescriptions p
    JOIN users u ON u.id = p.doctor_id
    LEFT JOIN doctor_profiles d ON d.user_id = p.doctor_id
    WHERE p.elder_id = ? ORDER BY p.created_at DESC
  `).all(req.user.id);

  const getMeds = db.prepare(`SELECT id,name,dosage,frequency,time_slot,instructions FROM medications WHERE prescription_id=?`);
  res.json(rx.map(r => ({ ...r, medications: getMeds.all(r.id) })));
});

// ---- Appointments ----
router.get('/appointments', (req, res) => {
  const appts = db.prepare(`
    SELECT a.*, u.name as doctor_name, d.specialization
    FROM appointments a
    JOIN users u ON u.id = a.doctor_id
    LEFT JOIN doctor_profiles d ON d.user_id = a.doctor_id
    WHERE a.elder_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC
  `).all(req.user.id);
  res.json(appts);
});

router.post('/appointments', (req, res) => {
  const { doctor_id } = req.body || {};
  if (!doctor_id) return res.status(400).json({ error: 'Doctor, date, and time are required.' });
  const slot = validateAppointmentSlot((req.body || {}).appt_date, (req.body || {}).appt_time);
  if (slot.error) return res.status(400).json({ error: slot.error });
  const rs = validateAppointmentReason((req.body || {}).reason);
  if (rs.error) return res.status(400).json({ error: rs.error });
  const appt_date = slot.value.date, appt_time = slot.value.time, reason = rs.value;

  const doctor = db.prepare(`SELECT id, name FROM users WHERE id=? AND role='DOCTOR' AND is_active=1`).get(doctor_id);
  if (!doctor) return res.status(400).json({ error: 'Selected doctor was not found.' });

  const clash = slotConflict(req.user.id, doctor.id, appt_date, appt_time);
  if (clash) return res.status(409).json({ error: clash });

  const info = db.prepare(`INSERT INTO appointments (elder_id,doctor_id,appt_date,appt_time,reason,status) VALUES (?,?,?,?,?,'Pending')`)
    .run(req.user.id, doctor.id, appt_date, appt_time, reason);

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id).name;
  notify(doctor.id, 'APPOINTMENT', `New appointment request: ${elderName}`,
    `${elderName} requested an appointment on ${appt_date} at ${appt_time}${reason ? ` — ${reason}` : ''}.`);
  notifyCaregiversOfElder(req.user.id, 'APPOINTMENT', `Appointment requested: ${elderName}`,
    `${elderName} requested an appointment with Dr. ${doctor.name} on ${appt_date} at ${appt_time}.`);
  logActivity(req.user.id, elderName, 'APPOINTMENT_BOOKED',
    `With Dr. ${doctor.name} on ${appt_date} at ${appt_time}.`);

  res.status(201).json({ id: info.lastInsertRowid });
});

// Elder cancels their own appointment (only while still Pending/Confirmed).
router.put('/appointments/:id/cancel', (req, res) => {
  const appt = db.prepare(`
    SELECT a.*, u.name AS doctor_name FROM appointments a JOIN users u ON u.id=a.doctor_id
    WHERE a.id=? AND a.elder_id=?
  `).get(req.params.id, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (!['Pending', 'Confirmed'].includes(appt.status)) {
    return res.status(400).json({ error: `A ${appt.status.toLowerCase()} appointment cannot be cancelled.` });
  }

  db.prepare(`UPDATE appointments SET status='Cancelled' WHERE id=?`).run(appt.id);

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id).name;
  notify(appt.doctor_id, 'APPOINTMENT_CANCELLED', `Appointment cancelled: ${elderName}`,
    `${elderName} cancelled the appointment on ${appt.appt_date} at ${appt.appt_time}.`);
  notifyCaregiversOfElder(req.user.id, 'APPOINTMENT_CANCELLED', `Appointment cancelled: ${elderName}`,
    `${elderName} cancelled the appointment with Dr. ${appt.doctor_name} on ${appt.appt_date} at ${appt.appt_time}.`);
  logActivity(req.user.id, elderName, 'APPOINTMENT_CANCELLED',
    `Appointment with Dr. ${appt.doctor_name} on ${appt.appt_date} at ${appt.appt_time} cancelled by elder.`);

  res.json({ ok: true });
});

// REQ-F-35: elder reschedules their own appointment (only while Pending/Confirmed).
// A Confirmed appointment goes back to Pending: the doctor has to confirm the new time.
router.put('/appointments/:id/reschedule', (req, res) => {
  const appt = db.prepare(`
    SELECT a.*, u.name AS doctor_name FROM appointments a JOIN users u ON u.id=a.doctor_id
    WHERE a.id=? AND a.elder_id=?
  `).get(req.params.id, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (!['Pending', 'Confirmed'].includes(appt.status)) {
    return res.status(400).json({ error: `A ${appt.status.toLowerCase()} appointment cannot be rescheduled.` });
  }
  const body = req.body || {};
  const slot = validateAppointmentSlot(body.appt_date, body.appt_time);
  if (slot.error) return res.status(400).json({ error: slot.error });
  let reason = appt.reason || '';
  if (body.reason !== undefined) {
    const rs = validateAppointmentReason(body.reason);
    if (rs.error) return res.status(400).json({ error: rs.error });
    reason = rs.value;
  }
  const { date, time } = slot.value;
  if (date === appt.appt_date && time === appt.appt_time && reason === (appt.reason || '')) {
    return res.status(400).json({ error: 'The new date and time are the same as the current appointment.' });
  }
  const clash = slotConflict(req.user.id, appt.doctor_id, date, time, appt.id);
  if (clash) return res.status(409).json({ error: clash });

  db.prepare(`UPDATE appointments SET appt_date=?, appt_time=?, reason=?, status='Pending', rescheduled_at=datetime('now') WHERE id=?`)
    .run(date, time, reason, appt.id);

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id).name;
  const msg = `${elderName} moved the appointment from ${appt.appt_date} ${appt.appt_time} to ${date} ${time}.`;
  notify(appt.doctor_id, 'APPOINTMENT_UPDATE', `Appointment rescheduled: ${elderName}`, `${msg} Please confirm the new time.`);
  notifyCaregiversOfElder(req.user.id, 'APPOINTMENT_UPDATE', `Appointment rescheduled: ${elderName}`,
    `${elderName}'s appointment with Dr. ${appt.doctor_name} moved from ${appt.appt_date} ${appt.appt_time} to ${date} ${time}.`);
  logActivity(req.user.id, elderName, 'APPOINTMENT_RESCHEDULED',
    `Appointment #${appt.id} with Dr. ${appt.doctor_name}: ${appt.appt_date} ${appt.appt_time} → ${date} ${time} (by elder).`);
  res.json({ ok: true, appt_date: date, appt_time: time, status: 'Pending' });
});

// ---- Doctors list (for booking) ----
router.get('/doctors', (req, res) => {
  const docs = db.prepare(`
    SELECT u.id, u.name, d.specialization
    FROM users u LEFT JOIN doctor_profiles d ON d.user_id = u.id
    WHERE u.role = 'DOCTOR'
  `).all();
  res.json(docs);
});

// ---- Dashboard summary ----
router.get('/dashboard', (req, res) => {
  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.user.id);
  const meds = getTodaysMeds(req.user.id);
  const upcoming = db.prepare(`
    SELECT a.*, u.name as doctor_name FROM appointments a
    JOIN users u ON u.id=a.doctor_id
    WHERE a.elder_id=? AND a.appt_date >= ? AND a.status != 'Cancelled'
    ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 3
  `).all(req.user.id, today());
  const activeAlert = db.prepare(`
    SELECT id, message, status, created_at FROM emergency_alerts
    WHERE elder_id=? AND status IN ('ACTIVE','ACKNOWLEDGED')
    ORDER BY created_at DESC LIMIT 1
  `).get(req.user.id) || null;
  if (activeAlert) activeAlert.contactDeliveries = deliveriesForAlert(activeAlert.id);
  res.json({ user, medicationsToday: meds, upcomingAppointments: upcoming, activeAlert });
});

module.exports = router;
