const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify, notifyCaregiversOfElder, logActivity } = require('../notify');
const { validateMedication, validatePrescriptionNotes, validateHealthRecord, validateAppointmentSlot, RECORD_TYPES } = require('../validators');
const { slotConflict } = require('../appointments');
const { generateOccurrences, todayStr, dateTimeStr } = require('../schedule');

const router = express.Router();
router.use(requireAuth, requireRole('DOCTOR'));

const today = () => todayStr();


router.get('/elders', (req, res) => {
  const elders = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, e.dob, e.blood_group
    FROM users u LEFT JOIN elder_profiles e ON e.user_id = u.id
    WHERE u.role = 'ELDER' ORDER BY u.name
  `).all();
  res.json(elders);
});

router.get('/elders/:id', (req, res) => {
  const elder = db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, e.dob, e.address, e.blood_group,
           e.emergency_contact_name, e.emergency_contact_phone, e.notes
    FROM users u LEFT JOIN elder_profiles e ON e.user_id = u.id
    WHERE u.id = ? AND u.role = 'ELDER'
  `).get(req.params.id);
  if (!elder) return res.status(404).json({ error: 'Elder not found.' });

  const prescriptions = db.prepare(`
    SELECT p.id, p.notes, p.created_at, p.updated_at, p.doctor_id, d.name AS doctor_name
    FROM prescriptions p JOIN users d ON d.id = p.doctor_id
    WHERE p.elder_id=? ORDER BY p.created_at DESC, p.id DESC
  `).all(req.params.id);
  const getMeds = db.prepare(`SELECT id,name,dosage,frequency,time_slot,instructions FROM medications WHERE prescription_id=?`);
  elder.prescriptions = prescriptions.map(p => ({ ...p, medications: getMeds.all(p.id) }));

  elder.appointments = db.prepare(`
    SELECT * FROM appointments WHERE elder_id=? ORDER BY appt_date DESC, appt_time DESC
  `).all(req.params.id);

  elder.healthRecords = db.prepare(`
    SELECT h.id, h.record_type, h.title, h.description, h.created_at, h.updated_at,
           h.doctor_id, u.name AS doctor_name
    FROM health_records h JOIN users u ON u.id = h.doctor_id
    WHERE h.elder_id=? ORDER BY h.created_at DESC, h.id DESC
  `).all(req.params.id);

  res.json(elder);
});

// ---- Health records (doctor creates/updates; elder + caregivers read) ----
router.post('/elders/:id/health-records', (req, res) => {
  const elder = db.prepare(`SELECT id, name FROM users WHERE id=? AND role='ELDER'`).get(req.params.id);
  if (!elder) return res.status(404).json({ error: 'Elder not found.' });

  // REQ-F-48/51: validate BEFORE storing; invalid input → 400 with a message (and per-field detail).
  const { errors, values } = validateHealthRecord(req.body);
  const messages = Object.values(errors);
  if (messages.length) return res.status(400).json({ error: messages.join(' '), errors });
  const type = values.record_type;

  const info = db.prepare(
    `INSERT INTO health_records (elder_id, doctor_id, record_type, title, description) VALUES (?,?,?,?,?)`
  ).run(elder.id, req.user.id, type, values.title, values.description);

  notify(elder.id, 'HEALTH_RECORD', 'New health record added',
    `Dr. ${req.user.name} added a ${type.toLowerCase()} record: "${values.title}".`);
  notifyCaregiversOfElder(elder.id, 'HEALTH_RECORD', `New health record: ${elder.name}`,
    `Dr. ${req.user.name} added a ${type.toLowerCase()} record for ${elder.name}: "${values.title}".`);
  logActivity(req.user.id, req.user.name, 'HEALTH_RECORD_CREATED',
    `${type} record "${values.title}" added for ${elder.name}.`);

  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/health-records/:id', (req, res) => {
  const record = db.prepare(`SELECT * FROM health_records WHERE id=?`).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Health record not found.' });
  // Resource-level authorization: only the doctor who wrote the record may edit it.
  if (record.doctor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the doctor who created this record can edit it.' });
  }

  const { errors, values } = validateHealthRecord(req.body, record);
  const messages = Object.values(errors);
  if (messages.length) return res.status(400).json({ error: messages.join(' '), errors });

  db.prepare(
    `UPDATE health_records SET record_type=?, title=?, description=?, updated_at=datetime('now') WHERE id=?`
  ).run(values.record_type, values.title, values.description, record.id);

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(record.elder_id).name;
  notify(record.elder_id, 'HEALTH_RECORD', 'Health record updated',
    `Dr. ${req.user.name} updated your record: "${values.title}".`);
  notifyCaregiversOfElder(record.elder_id, 'HEALTH_RECORD', `Health record updated: ${elderName}`,
    `Dr. ${req.user.name} updated a record for ${elderName}: "${values.title}".`);
  logActivity(req.user.id, req.user.name, 'HEALTH_RECORD_UPDATED',
    `Record "${values.title}" updated for ${elderName}.`);

  res.json({ ok: true });
});

// Shared by create and edit: validate a medications array. Returns { meds } or { error }.
function validateMedicationList(list, { allowId }) {
  if (!Array.isArray(list) || list.length === 0) return { error: 'At least one medication is required.' };
  if (list.length > 20) return { error: 'A prescription can contain at most 20 medications.' };
  const meds = [];
  for (let i = 0; i < list.length; i++) {
    const r = validateMedication(list[i], `Medicine ${i + 1}`, { allowId });
    if (r.error) return { error: r.error };
    meds.push(r.value);
  }
  return { meds };
}

router.post('/prescriptions', (req, res) => {
  const { elder_id, notes, medications } = req.body || {};
  if (!elder_id || !Array.isArray(medications) || medications.length === 0) {
    return res.status(400).json({ error: 'An elder and at least one medication are required.' });
  }
  const elder = db.prepare(`SELECT id FROM users WHERE id=? AND role='ELDER'`).get(elder_id);
  if (!elder) return res.status(400).json({ error: 'Selected elder was not found.' });

  const n = validatePrescriptionNotes(notes);
  if (n.error) return res.status(400).json({ error: n.error });
  const v = validateMedicationList(medications, { allowId: false });
  if (v.error) return res.status(400).json({ error: v.error });

  const scheduleFrom = dateTimeStr(new Date());
  const create = db.transaction(() => {
    const rxId = db.prepare(`INSERT INTO prescriptions (elder_id, doctor_id, notes) VALUES (?,?,?)`)
      .run(elder_id, req.user.id, n.value).lastInsertRowid;
    const insertMed = db.prepare(
      `INSERT INTO medications (prescription_id,name,dosage,frequency,time_slot,instructions,schedule_from) VALUES (?,?,?,?,?,?,?)`
    );
    for (const m of v.meds) insertMed.run(rxId, m.name, m.dosage, m.frequency, m.time_slot, m.instructions, scheduleFrom);
    return rxId;
  });
  const rxId = create();

  // REQ-F-23: generate the scheduled doses from the new prescription.
  generateOccurrences({ elderId: elder.id });

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(elder_id).name;
  notify(elder_id, 'PRESCRIPTION', 'New prescription added',
    `Dr. ${req.user.name} prescribed ${v.meds.length} medication(s) for you. Reminders are sent before each scheduled dose; see "Medication schedule" for times.`);
  notifyCaregiversOfElder(elder.id, 'PRESCRIPTION', `New prescription: ${elderName}`,
    `Dr. ${req.user.name} prescribed ${v.meds.length} medication(s) for ${elderName}: ${v.meds.map(m => `${m.name} ${m.dosage} (${m.time_slot})`).join(', ')}.`);
  logActivity(req.user.id, req.user.name, 'PRESCRIPTION_CREATED',
    `Prescription with ${v.meds.length} medication(s) created for ${elderName}.`);

  res.status(201).json({ id: rxId });
});

// REQ-F-20: modify an existing prescription.
// Body: { notes?, medications?: [{ id?, name, dosage, frequency, time_slot, instructions }] }
//  - entries WITH an id update that medicine (it must belong to this prescription)
//  - entries WITHOUT an id are added to the prescription
//  - existing medicines not mentioned are left untouched (never deleted → adherence history is kept)
// Authorization: only the doctor who created the prescription may modify it (same rule as health records).
router.put('/prescriptions/:id', (req, res) => {
  const rxId = Number(req.params.id);
  if (!Number.isInteger(rxId) || rxId < 1) return res.status(400).json({ error: 'Invalid prescription id.' });

  const rx = db.prepare(`SELECT * FROM prescriptions WHERE id=?`).get(rxId);
  if (!rx) return res.status(404).json({ error: 'Prescription not found.' });
  if (rx.doctor_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the doctor who created this prescription can modify it.' });
  }

  const body = req.body || {};
  if (body.notes === undefined && body.medications === undefined) {
    return res.status(400).json({ error: 'Nothing to update: provide notes and/or medications.' });
  }

  let newNotes = rx.notes || '';
  if (body.notes !== undefined) {
    const n = validatePrescriptionNotes(body.notes);
    if (n.error) return res.status(400).json({ error: n.error });
    newNotes = n.value;
  }

  let meds = [];
  if (body.medications !== undefined) {
    const v = validateMedicationList(body.medications, { allowId: true });
    if (v.error) return res.status(400).json({ error: v.error });
    meds = v.meds;
  }

  const existing = new Map(db.prepare(`SELECT * FROM medications WHERE prescription_id=?`).all(rxId).map(m => [m.id, m]));
  const seen = new Set();
  for (let i = 0; i < meds.length; i++) {
    const id = meds[i].id;
    if (id === undefined) continue;
    if (!existing.has(id)) return res.status(400).json({ error: `Medicine ${i + 1} does not belong to this prescription.` });
    if (seen.has(id)) return res.status(400).json({ error: `Medicine ${i + 1} is listed more than once.` });
    seen.add(id);
  }

  const changes = [];
  const FIELDS = [['name', 'name'], ['dosage', 'dosage'], ['frequency', 'frequency'], ['time_slot', 'time'], ['instructions', 'instructions']];
  const now = dateTimeStr(new Date());

  const apply = db.transaction(() => {
    if (newNotes !== (rx.notes || '')) changes.push('notes');

    for (const m of meds) {
      if (m.id === undefined) {
        db.prepare(`INSERT INTO medications (prescription_id,name,dosage,frequency,time_slot,instructions,schedule_from) VALUES (?,?,?,?,?,?,?)`)
          .run(rxId, m.name, m.dosage, m.frequency, m.time_slot, m.instructions, now);
        changes.push(`added ${m.name}`);
        continue;
      }
      const cur = existing.get(m.id);
      const diffs = FIELDS.filter(([k]) => (cur[k] || '') !== (m[k] || ''));
      if (diffs.length === 0) continue;
      db.prepare(`UPDATE medications SET name=?, dosage=?, frequency=?, time_slot=?, instructions=? WHERE id=?`)
        .run(m.name, m.dosage, m.frequency, m.time_slot, m.instructions, m.id);
      changes.push(`${cur.name}: ` + diffs.map(([k, label]) => `${label} ${cur[k] || '—'} → ${m[k] || '—'}`).join(', '));

      // A timing change re-plans the schedule: future doses are due from now on, and today's
      // still-Pending (or system-auto-missed) dose is regenerated for the new time. Doses the elder
      // confirmed (Taken, or Missed by their own choice) are never deleted.
      if (diffs.some(([k]) => k === 'time_slot' || k === 'frequency')) {
        db.prepare(`UPDATE medications SET schedule_from=? WHERE id=?`).run(now, m.id);
        db.prepare(`DELETE FROM medication_logs WHERE medication_id=? AND log_date>=? AND (status='Pending' OR (status='Missed' AND auto_missed=1))`).run(m.id, today());
      }
    }

    if (changes.length > 0) {
      db.prepare(`UPDATE prescriptions SET notes=?, updated_at=datetime('now') WHERE id=?`).run(newNotes, rxId);
    }
  });
  apply();

  if (changes.length === 0) return res.json({ ok: true, changed: false, message: 'No changes were made.' });

  generateOccurrences({ elderId: rx.elder_id });

  const elderName = db.prepare('SELECT name FROM users WHERE id=?').get(rx.elder_id).name;
  notify(rx.elder_id, 'PRESCRIPTION', 'Prescription updated',
    `Dr. ${req.user.name} updated your prescription: ${changes.join('; ')}.`);
  notifyCaregiversOfElder(rx.elder_id, 'PRESCRIPTION', `Prescription updated: ${elderName}`,
    `Dr. ${req.user.name} updated ${elderName}'s prescription: ${changes.join('; ')}.`);
  logActivity(req.user.id, req.user.name, 'PRESCRIPTION_UPDATED',
    `Prescription #${rxId} for ${elderName} updated (${changes.join('; ')}).`);

  const medsOut = db.prepare(`SELECT id,name,dosage,frequency,time_slot,instructions FROM medications WHERE prescription_id=?`).all(rxId);
  res.json({ ok: true, changed: true, changes, prescription: { id: rxId, notes: newNotes, medications: medsOut } });
});

router.get('/appointments', (req, res) => {
  const appts = db.prepare(`
    SELECT a.*, u.name as elder_name FROM appointments a
    JOIN users u ON u.id = a.elder_id
    WHERE a.doctor_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC
  `).all(req.user.id);
  res.json(appts);
});

router.put('/appointments/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['Confirmed', 'Cancelled', 'Completed', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const appt = db.prepare(`
    SELECT a.*, u.name AS elder_name FROM appointments a JOIN users u ON u.id=a.elder_id
    WHERE a.id=? AND a.doctor_id=?
  `).get(req.params.id, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (appt.status === status) return res.json({ ok: true });
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, req.params.id);

  // Notify the elder of the appointment update/cancellation.
  const type = status === 'Cancelled' ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_UPDATE';
  const title = status === 'Cancelled' ? 'Appointment cancelled'
    : status === 'Confirmed' ? 'Appointment confirmed'
    : status === 'Completed' ? 'Appointment completed' : 'Appointment updated';
  notify(appt.elder_id, type, title,
    `Your appointment with Dr. ${req.user.name} on ${appt.appt_date} at ${appt.appt_time} is now ${status}.`);
  if (['Confirmed', 'Cancelled'].includes(status)) {
    notifyCaregiversOfElder(appt.elder_id, type, `Appointment ${status.toLowerCase()}: ${appt.elder_name}`,
      `${appt.elder_name}'s appointment with Dr. ${req.user.name} on ${appt.appt_date} at ${appt.appt_time} is now ${status}.`);
  }
  logActivity(req.user.id, req.user.name, `APPOINTMENT_${status.toUpperCase()}`,
    `Appointment with ${appt.elder_name} on ${appt.appt_date} at ${appt.appt_time} → ${status}.`);

  res.json({ ok: true });
});

// REQ-F-35: doctor moves one of their own appointments (Pending/Confirmed). Status is kept.
router.put('/appointments/:id/reschedule', (req, res) => {
  const appt = db.prepare(`
    SELECT a.*, u.name AS elder_name FROM appointments a JOIN users u ON u.id=a.elder_id
    WHERE a.id=? AND a.doctor_id=?
  `).get(req.params.id, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (!['Pending', 'Confirmed'].includes(appt.status)) {
    return res.status(400).json({ error: `A ${appt.status.toLowerCase()} appointment cannot be rescheduled.` });
  }
  const body = req.body || {};
  const slot = validateAppointmentSlot(body.appt_date, body.appt_time);
  if (slot.error) return res.status(400).json({ error: slot.error });
  const { date, time } = slot.value;
  if (date === appt.appt_date && time === appt.appt_time) {
    return res.status(400).json({ error: 'The new date and time are the same as the current appointment.' });
  }
  const clash = slotConflict(appt.elder_id, req.user.id, date, time, appt.id);
  if (clash) return res.status(409).json({ error: clash.replace('You already have', 'The elder already has') });

  db.prepare(`UPDATE appointments SET appt_date=?, appt_time=?, rescheduled_at=datetime('now') WHERE id=?`).run(date, time, appt.id);

  notify(appt.elder_id, 'APPOINTMENT_UPDATE', 'Appointment rescheduled',
    `Dr. ${req.user.name} moved your appointment from ${appt.appt_date} ${appt.appt_time} to ${date} ${time}.`);
  notifyCaregiversOfElder(appt.elder_id, 'APPOINTMENT_UPDATE', `Appointment rescheduled: ${appt.elder_name}`,
    `Dr. ${req.user.name} moved ${appt.elder_name}'s appointment from ${appt.appt_date} ${appt.appt_time} to ${date} ${time}.`);
  logActivity(req.user.id, req.user.name, 'APPOINTMENT_RESCHEDULED',
    `Appointment #${appt.id} with ${appt.elder_name}: ${appt.appt_date} ${appt.appt_time} → ${date} ${time} (by doctor).`);
  res.json({ ok: true, appt_date: date, appt_time: time, status: appt.status });
});

router.get('/dashboard', (req, res) => {
  const user = db.prepare('SELECT id,name,email FROM users WHERE id=?').get(req.user.id);
  const profile = db.prepare('SELECT specialization FROM doctor_profiles WHERE user_id=?').get(req.user.id);
  const elderCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='ELDER'`).get().c;
  const apptCount = db.prepare(`SELECT COUNT(*) c FROM appointments WHERE doctor_id=?`).get(req.user.id).c;
  const upcoming = db.prepare(`
    SELECT a.*, u.name as elder_name FROM appointments a
    JOIN users u ON u.id = a.elder_id
    WHERE a.doctor_id=? AND a.appt_date >= ? AND a.status NOT IN ('Cancelled','Completed')
    ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 5
  `).all(req.user.id, today());

  res.json({ user, specialization: profile?.specialization || '', elderCount, apptCount, upcoming });
});

module.exports = router;
