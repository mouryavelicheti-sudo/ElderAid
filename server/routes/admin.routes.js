const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('ADMINISTRATOR'));

const ROLES = ['ELDER', 'DOCTOR', 'CAREGIVER', 'ADMINISTRATOR'];

router.get('/stats', (req, res) => {
  const count = (role) => db.prepare('SELECT COUNT(*) c FROM users WHERE role=?').get(role).c;
  res.json({
    totalUsers: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    elders: count('ELDER'),
    doctors: count('DOCTOR'),
    caregivers: count('CAREGIVER'),
    administrators: count('ADMINISTRATOR'),
    totalAppointments: db.prepare('SELECT COUNT(*) c FROM appointments').get().c,
    totalPrescriptions: db.prepare('SELECT COUNT(*) c FROM prescriptions').get().c,
  });
});

// ---- User management (REQ-F-90 .. REQ-F-96) ----

router.get('/users', (req, res) => {
  const users = db.prepare(
    'SELECT id,name,email,role,phone,is_active,created_at FROM users ORDER BY created_at DESC'
  ).all();
  res.json(users);
});

router.post('/users', (req, res) => {
  const { name, email, password, role, phone } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are required.' });
  }
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (name,email,password_hash,role,phone) VALUES (?,?,?,?,?)'
  ).run(name.trim(), cleanEmail, passwordHash, role, phone || null);

  if (role === 'DOCTOR') {
    db.prepare('INSERT INTO doctor_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  } else if (role === 'ELDER') {
    db.prepare('INSERT INTO elder_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  }

  const user = db.prepare('SELECT id,name,email,role,phone,is_active,created_at FROM users WHERE id=?')
    .get(info.lastInsertRowid);
  res.status(201).json(user);
});

router.put('/users/:id', (req, res) => {
  const targetId = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(targetId);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const { name, email, phone, role, is_active } = req.body;

  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });

  // Safety: an administrator cannot demote or disable their own account
  // (prevents accidentally locking every admin out of the system).
  if (targetId === req.user.id) {
    if (role && role !== 'ADMINISTRATOR') {
      return res.status(400).json({ error: 'You cannot change your own role away from Administrator.' });
    }
    if (is_active === false || is_active === 0) {
      return res.status(400).json({ error: 'You cannot disable your own account.' });
    }
  }

  let cleanEmail = target.email;
  if (email && email.trim().toLowerCase() !== target.email) {
    cleanEmail = email.trim().toLowerCase();
    const dupe = db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(cleanEmail, targetId);
    if (dupe) return res.status(409).json({ error: 'Another account already uses that email.' });
  }

  db.prepare(`
    UPDATE users SET name=?, email=?, phone=?, role=?, is_active=?
    WHERE id=?
  `).run(
    name?.trim() || target.name,
    cleanEmail,
    phone !== undefined ? phone : target.phone,
    role || target.role,
    is_active !== undefined ? (is_active ? 1 : 0) : target.is_active,
    targetId
  );

  // Keep role-specific profile rows in sync if role changed
  const finalRole = role || target.role;
  if (finalRole === 'DOCTOR') {
    db.prepare('INSERT OR IGNORE INTO doctor_profiles (user_id) VALUES (?)').run(targetId);
  } else if (finalRole === 'ELDER') {
    db.prepare('INSERT OR IGNORE INTO elder_profiles (user_id) VALUES (?)').run(targetId);
  }

  const updated = db.prepare('SELECT id,name,email,role,phone,is_active,created_at FROM users WHERE id=?').get(targetId);
  res.json(updated);
});

// ---- Elder oversight (admin can view everything) ----

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
    SELECT p.id, p.notes, p.created_at, d.name as doctor_name
    FROM prescriptions p JOIN users d ON d.id = p.doctor_id
    WHERE p.elder_id=? ORDER BY p.created_at DESC
  `).all(req.params.id);
  const getMeds = db.prepare(`SELECT id,name,dosage,frequency,time_slot,instructions FROM medications WHERE prescription_id=?`);
  elder.prescriptions = prescriptions.map(p => ({ ...p, medications: getMeds.all(p.id) }));

  elder.appointments = db.prepare(`
    SELECT a.*, d.name as doctor_name FROM appointments a
    JOIN users d ON d.id = a.doctor_id
    WHERE a.elder_id=? ORDER BY a.appt_date DESC, a.appt_time DESC
  `).all(req.params.id);

  res.json(elder);
});

// Admin can override any appointment's status system-wide (REQ-F-97/98)
router.put('/appointments/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['Confirmed', 'Cancelled', 'Completed', 'Pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const appt = db.prepare('SELECT id FROM appointments WHERE id=?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

module.exports = router;
