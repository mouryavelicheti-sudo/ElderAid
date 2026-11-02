const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify, logActivity } = require('../notify');
const { generateOccurrences, todayStr } = require('../schedule');
const { deliveriesForAlert } = require('../delivery');

const router = express.Router();
router.use(requireAuth, requireRole('CAREGIVER'));
const today = () => todayStr();

// Resource-level authorization: caregiver may only touch elders assigned to them.
function getAssignedElder(caregiverId, elderId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.phone, e.dob, e.address, e.blood_group,
           e.emergency_contact_name, e.emergency_contact_phone, e.notes
    FROM caregiver_elders ce
    JOIN users u ON u.id = ce.elder_id
    LEFT JOIN elder_profiles e ON e.user_id = u.id
    WHERE ce.caregiver_id = ? AND ce.elder_id = ?
  `).get(caregiverId, elderId);
}

router.get('/elders', (req, res) => {
  const elders = db.prepare(`
    SELECT u.id, u.name, u.phone, e.dob, e.blood_group
    FROM caregiver_elders ce
    JOIN users u ON u.id = ce.elder_id
    LEFT JOIN elder_profiles e ON e.user_id = u.id
    WHERE ce.caregiver_id = ?
  `).all(req.user.id);

  const getMeds = db.prepare(`
    SELECT m.name, m.time_slot, ml.status FROM medications m
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN medication_logs ml ON ml.medication_id = m.id AND ml.log_date = ?
    WHERE p.elder_id = ?
  `);
  const getNextAppt = db.prepare(`
    SELECT appt_date, appt_time, status FROM appointments
    WHERE elder_id = ? AND appt_date >= ? AND status != 'Cancelled'
    ORDER BY appt_date ASC, appt_time ASC LIMIT 1
  `);
  const getActiveAlerts = db.prepare(`
    SELECT COUNT(*) c FROM emergency_alerts WHERE elder_id=? AND status='ACTIVE'
  `);

  generateOccurrences(); // make sure today's scheduled doses exist for every elder
  const result = elders.map(e => {
    const meds = getMeds.all(today(), e.id);
    return {
      ...e,
      medicationsToday: meds,
      missedToday: meds.filter(m => m.status === 'Missed').length,
      takenToday: meds.filter(m => m.status === 'Taken').length,
      nextAppointment: getNextAppt.get(e.id, today()) || null,
      activeAlerts: getActiveAlerts.get(e.id).c,
    };
  });
  res.json(result);
});

// Full monitoring detail for one assigned elder.
router.get('/elders/:id', (req, res) => {
  const elder = getAssignedElder(req.user.id, req.params.id);
  if (!elder) return res.status(404).json({ error: 'Elder not found or not assigned to you.' });

  generateOccurrences({ elderId: elder.id });
  elder.medicationsToday = db.prepare(`
    SELECT m.id, m.name, m.dosage, m.frequency, m.time_slot, m.instructions,
           ml.status AS status, ml.scheduled_time, ml.auto_missed
    FROM medications m
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN medication_logs ml ON ml.medication_id = m.id AND ml.log_date = ?
    WHERE p.elder_id = ?
    ORDER BY CASE m.time_slot WHEN 'Morning' THEN 1 WHEN 'Afternoon' THEN 2 WHEN 'Evening' THEN 3 ELSE 4 END
  `).all(today(), elder.id);

  elder.medicationHistory = db.prepare(`
    SELECT ml.log_date, ml.status, ml.auto_missed, m.name, m.dosage, m.time_slot
    FROM medication_logs ml
    JOIN medications m ON m.id = ml.medication_id
    JOIN prescriptions p ON p.id = m.prescription_id
    WHERE p.elder_id = ? AND ml.log_date >= date('now', '-7 days')
    ORDER BY ml.log_date DESC,
      CASE m.time_slot WHEN 'Morning' THEN 1 WHEN 'Afternoon' THEN 2 WHEN 'Evening' THEN 3 ELSE 4 END
  `).all(elder.id);

  elder.upcomingAppointments = db.prepare(`
    SELECT a.appt_date, a.appt_time, a.reason, a.status, u.name AS doctor_name
    FROM appointments a JOIN users u ON u.id = a.doctor_id
    WHERE a.elder_id = ? AND a.appt_date >= ? AND a.status != 'Cancelled'
    ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 5
  `).all(elder.id, today());

  // Permitted health information for assigned elders (read-only).
  elder.healthRecords = db.prepare(`
    SELECT h.record_type, h.title, h.description, h.created_at, u.name AS doctor_name
    FROM health_records h JOIN users u ON u.id = h.doctor_id
    WHERE h.elder_id=? ORDER BY h.created_at DESC, h.id DESC LIMIT 10
  `).all(elder.id);

  elder.alerts = db.prepare(`
    SELECT id, message, status, created_at, updated_at
    FROM emergency_alerts WHERE elder_id=? ORDER BY created_at DESC, id DESC LIMIT 10
  `).all(elder.id);

  res.json(elder);
});

// Emergency alerts across all elders assigned to this caregiver (ACTIVE first).
router.get('/alerts', (req, res) => {
  const alerts = db.prepare(`
    SELECT a.id, a.elder_id, a.message, a.status, a.created_at, a.updated_at,
           u.name AS elder_name, u.phone AS elder_phone,
           e.emergency_contact_name, e.emergency_contact_phone, e.address,
           ack.name AS acknowledged_by_name, res.name AS resolved_by_name
    FROM emergency_alerts a
    JOIN caregiver_elders ce ON ce.elder_id = a.elder_id
    JOIN users u ON u.id = a.elder_id
    LEFT JOIN elder_profiles e ON e.user_id = a.elder_id
    LEFT JOIN users ack ON ack.id = a.acknowledged_by
    LEFT JOIN users res ON res.id = a.resolved_by
    WHERE ce.caregiver_id = ?
    ORDER BY CASE a.status WHEN 'ACTIVE' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END,
             a.created_at DESC, a.id DESC
  `).all(req.user.id);
  // External (emergency-contact) delivery state is shown separately from in-app notifications.
  res.json(alerts.map(a => ({ ...a, contactDeliveries: deliveriesForAlert(a.id) })));
});

// Caregiver acknowledges or resolves an alert for an assigned elder.
router.put('/alerts/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) {
    return res.status(400).json({ error: 'Caregivers can only acknowledge or resolve an alert.' });
  }
  const alert = db.prepare(`
    SELECT a.*, u.name AS elder_name FROM emergency_alerts a
    JOIN caregiver_elders ce ON ce.elder_id = a.elder_id
    JOIN users u ON u.id = a.elder_id
    WHERE a.id = ? AND ce.caregiver_id = ?
  `).get(req.params.id, req.user.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found or not assigned to you.' });
  if (['RESOLVED', 'CANCELLED'].includes(alert.status)) {
    return res.status(400).json({ error: `This alert is already ${alert.status.toLowerCase()}.` });
  }

  db.prepare(`
    UPDATE emergency_alerts SET status=?,
      acknowledged_by = CASE WHEN ?='ACKNOWLEDGED' THEN ? ELSE acknowledged_by END,
      resolved_by   = CASE WHEN ?='RESOLVED'   THEN ? ELSE resolved_by END,
      updated_at=datetime('now')
    WHERE id=?
  `).run(status, status, req.user.id, status, req.user.id, alert.id);

  notify(alert.elder_id, 'EMERGENCY',
    status === 'ACKNOWLEDGED' ? 'Your SOS was acknowledged' : 'Your SOS was resolved',
    status === 'ACKNOWLEDGED'
      ? `${req.user.name} (your caregiver) has seen your emergency alert and is responding.`
      : `${req.user.name} (your caregiver) marked your emergency alert as resolved.`);
  logActivity(req.user.id, req.user.name, `SOS_${status}`,
    `Alert #${alert.id} for ${alert.elder_name} ${status.toLowerCase()} by caregiver.`);

  res.json({ ok: true });
});

module.exports = router;
