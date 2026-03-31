const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('DOCTOR'));

const today = () => new Date().toISOString().slice(0, 10);

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
    SELECT p.id, p.notes, p.created_at FROM prescriptions p WHERE p.elder_id=? ORDER BY p.created_at DESC
  `).all(req.params.id);
  const getMeds = db.prepare(`SELECT id,name,dosage,frequency,time_slot,instructions FROM medications WHERE prescription_id=?`);
  elder.prescriptions = prescriptions.map(p => ({ ...p, medications: getMeds.all(p.id) }));

  elder.appointments = db.prepare(`
    SELECT * FROM appointments WHERE elder_id=? ORDER BY appt_date DESC, appt_time DESC
  `).all(req.params.id);

  res.json(elder);
});

router.post('/prescriptions', (req, res) => {
  const { elder_id, notes, medications } = req.body;
  if (!elder_id || !Array.isArray(medications) || medications.length === 0) {
    return res.status(400).json({ error: 'An elder and at least one medication are required.' });
  }
  const elder = db.prepare(`SELECT id FROM users WHERE id=? AND role='ELDER'`).get(elder_id);
  if (!elder) return res.status(400).json({ error: 'Selected elder was not found.' });

  const validSlots = ['Morning', 'Afternoon', 'Evening', 'Night'];
  for (const m of medications) {
    if (!m.name || !m.dosage || !m.frequency || !validSlots.includes(m.time_slot)) {
      return res.status(400).json({ error: 'Each medication needs a name, dosage, frequency, and valid time slot.' });
    }
  }

  const rxId = db.prepare(`INSERT INTO prescriptions (elder_id, doctor_id, notes) VALUES (?,?,?)`)
    .run(elder_id, req.user.id, notes || '').lastInsertRowid;

  const insertMed = db.prepare(
    `INSERT INTO medications (prescription_id,name,dosage,frequency,time_slot,instructions) VALUES (?,?,?,?,?,?)`
  );
  const insertLog = db.prepare(`INSERT OR IGNORE INTO medication_logs (medication_id, log_date, status) VALUES (?,?,'Pending')`);

  for (const m of medications) {
    const medId = insertMed.run(rxId, m.name, m.dosage, m.frequency, m.time_slot, m.instructions || '').lastInsertRowid;
    insertLog.run(medId, today());
  }

  res.status(201).json({ id: rxId });
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
  const appt = db.prepare('SELECT id FROM appointments WHERE id=? AND doctor_id=?').get(req.params.id, req.user.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
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
