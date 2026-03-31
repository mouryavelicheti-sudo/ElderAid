const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('CAREGIVER'));
const today = () => new Date().toISOString().slice(0, 10);

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
    LEFT JOIN medication_logs ml ON ml.medication_id = m.id AND ml.log_date = ?
    WHERE p.elder_id = ?
  `);
  const getNextAppt = db.prepare(`
    SELECT appt_date, appt_time, status FROM appointments
    WHERE elder_id = ? AND appt_date >= ? ORDER BY appt_date ASC, appt_time ASC LIMIT 1
  `);

  const result = elders.map(e => ({
    ...e,
    medicationsToday: getMeds.all(today(), e.id),
    nextAppointment: getNextAppt.get(e.id, today()) || null,
  }));
  res.json(result);
});

module.exports = router;
