const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ELDER'));

const today = () => new Date().toISOString().slice(0, 10);

// ---- Profile ----
router.get('/profile', (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone FROM users WHERE id=?').get(req.user.id);
  const profile = db.prepare('SELECT * FROM elder_profiles WHERE user_id=?').get(req.user.id) || {};
  res.json({ ...user, ...profile });
});

router.put('/profile', (req, res) => {
  const { name, phone, dob, address, blood_group, emergency_contact_name, emergency_contact_phone, notes } = req.body;

  if (name) db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone=? WHERE id=?').run(phone, req.user.id);

  const exists = db.prepare('SELECT user_id FROM elder_profiles WHERE user_id=?').get(req.user.id);
  if (exists) {
    db.prepare(`UPDATE elder_profiles SET dob=?, address=?, blood_group=?, emergency_contact_name=?, emergency_contact_phone=?, notes=? WHERE user_id=?`)
      .run(dob, address, blood_group, emergency_contact_name, emergency_contact_phone, notes, req.user.id);
  } else {
    db.prepare(`INSERT INTO elder_profiles (user_id,dob,address,blood_group,emergency_contact_name,emergency_contact_phone,notes) VALUES (?,?,?,?,?,?,?)`)
      .run(req.user.id, dob, address, blood_group, emergency_contact_name, emergency_contact_phone, notes);
  }
  res.json({ ok: true });
});

// ---- Medications (today's schedule, ensures log rows exist) ----
function getTodaysMeds(elderId) {
  const meds = db.prepare(`
    SELECT m.id, m.name, m.dosage, m.frequency, m.time_slot, m.instructions, p.doctor_id, u.name as doctor_name
    FROM medications m
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN users u ON u.id = p.doctor_id
    WHERE p.elder_id = ?
    ORDER BY CASE m.time_slot WHEN 'Morning' THEN 1 WHEN 'Afternoon' THEN 2 WHEN 'Evening' THEN 3 ELSE 4 END
  `).all(elderId);

  const insertLog = db.prepare(`INSERT OR IGNORE INTO medication_logs (medication_id, log_date, status) VALUES (?,?,'Pending')`);
  const getLog = db.prepare(`SELECT status FROM medication_logs WHERE medication_id=? AND log_date=?`);

  return meds.map(m => {
    insertLog.run(m.id, today());
    const log = getLog.get(m.id, today());
    return { ...m, status: log.status };
  });
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

  db.prepare(`INSERT OR IGNORE INTO medication_logs (medication_id, log_date, status) VALUES (?,?,'Pending')`)
    .run(med.id, today());
  db.prepare(`UPDATE medication_logs SET status=?, updated_at=datetime('now') WHERE medication_id=? AND log_date=?`)
    .run(status, med.id, today());
  res.json({ ok: true });
});

// ---- Prescriptions ----
router.get('/prescriptions', (req, res) => {
  const rx = db.prepare(`
    SELECT p.id, p.notes, p.created_at, u.name as doctor_name, d.specialization
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
  const { doctor_id, appt_date, appt_time, reason } = req.body;
  if (!doctor_id || !appt_date || !appt_time) {
    return res.status(400).json({ error: 'Doctor, date, and time are required.' });
  }
  const doctor = db.prepare(`SELECT id FROM users WHERE id=? AND role='DOCTOR'`).get(doctor_id);
  if (!doctor) return res.status(400).json({ error: 'Selected doctor was not found.' });

  const info = db.prepare(`INSERT INTO appointments (elder_id,doctor_id,appt_date,appt_time,reason,status) VALUES (?,?,?,?,?,'Pending')`)
    .run(req.user.id, doctor_id, appt_date, appt_time, reason || '');
  res.status(201).json({ id: info.lastInsertRowid });
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
  res.json({ user, medicationsToday: meds, upcomingAppointments: upcoming });
});

module.exports = router;
