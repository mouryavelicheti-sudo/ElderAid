const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify, notifyCaregiversOfElder, logActivity } = require('../notify');

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
    totalHealthRecords: db.prepare('SELECT COUNT(*) c FROM health_records').get().c,
    totalAlerts: db.prepare('SELECT COUNT(*) c FROM emergency_alerts').get().c,
    activeAlerts: db.prepare(`SELECT COUNT(*) c FROM emergency_alerts WHERE status='ACTIVE'`).get().c,
    medicationsTakenToday: db.prepare(`SELECT COUNT(*) c FROM medication_logs WHERE log_date=date('now','localtime') AND status='Taken'`).get().c,
    medicationsMissedToday: db.prepare(`SELECT COUNT(*) c FROM medication_logs WHERE log_date=date('now','localtime') AND status='Missed'`).get().c,
    disabledUsers: db.prepare('SELECT COUNT(*) c FROM users WHERE is_active=0').get().c,
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
  logActivity(req.user.id, req.user.name, 'USER_CREATED', `Created ${role} account for ${user.name} (${user.email}).`);
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

  const changes = [];
  if (role && role !== target.role) changes.push(`role ${target.role} → ${role}`);
  if (is_active !== undefined && (is_active ? 1 : 0) !== target.is_active) {
    changes.push(is_active ? 'account enabled' : 'account disabled');
  }
  if (name && name.trim() !== target.name) changes.push('name updated');
  if (cleanEmail !== target.email) changes.push('email updated');
  logActivity(req.user.id, req.user.name, 'USER_UPDATED',
    `${updated.name} (${updated.email}): ${changes.join(', ') || 'details updated'}.`);

  res.json(updated);
});

// ---- System activity log (REQ-F: admin activity monitoring) ----
router.get('/activity', (req, res) => {
  const rows = db.prepare(`
    SELECT id, actor_name, action, details, created_at
    FROM activity_logs ORDER BY created_at DESC, id DESC LIMIT 200
  `).all();
  res.json(rows);
});

// ---- Caregiver ↔ elder assignments ----
router.get('/assignments', (req, res) => {
  const rows = db.prepare(`
    SELECT ce.id, ce.caregiver_id, ce.elder_id,
           c.name AS caregiver_name, c.email AS caregiver_email,
           e.name AS elder_name, e.email AS elder_email
    FROM caregiver_elders ce
    JOIN users c ON c.id = ce.caregiver_id
    JOIN users e ON e.id = ce.elder_id
    ORDER BY c.name, e.name
  `).all();
  res.json(rows);
});

router.post('/assignments', (req, res) => {
  const { caregiver_id, elder_id } = req.body;
  const caregiver = db.prepare(`SELECT id, name FROM users WHERE id=? AND role='CAREGIVER' AND is_active=1`).get(caregiver_id);
  const elder = db.prepare(`SELECT id, name FROM users WHERE id=? AND role='ELDER'`).get(elder_id);
  if (!caregiver) return res.status(400).json({ error: 'Selected caregiver was not found.' });
  if (!elder) return res.status(400).json({ error: 'Selected elder was not found.' });

  const existing = db.prepare('SELECT id FROM caregiver_elders WHERE caregiver_id=? AND elder_id=?')
    .get(caregiver_id, elder_id);
  if (existing) return res.status(409).json({ error: 'That caregiver is already assigned to that elder.' });

  const info = db.prepare('INSERT INTO caregiver_elders (caregiver_id, elder_id) VALUES (?,?)')
    .run(caregiver_id, elder_id);
  notify(caregiver_id, 'GENERAL', 'New elder assigned',
    `You have been assigned to monitor ${elder.name}. Their medication, appointment and alert status is now visible on your dashboard.`);
  logActivity(req.user.id, req.user.name, 'CAREGIVER_ASSIGNED',
    `${caregiver.name} assigned to ${elder.name}.`);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.delete('/assignments/:id', (req, res) => {
  const row = db.prepare(`
    SELECT ce.id, c.name AS caregiver_name, c.id AS caregiver_id, e.name AS elder_name
    FROM caregiver_elders ce
    JOIN users c ON c.id=ce.caregiver_id JOIN users e ON e.id=ce.elder_id
    WHERE ce.id=?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assignment not found.' });
  db.prepare('DELETE FROM caregiver_elders WHERE id=?').run(row.id);
  notify(row.caregiver_id, 'GENERAL', 'Assignment removed',
    `You are no longer assigned to monitor ${row.elder_name}.`);
  logActivity(req.user.id, req.user.name, 'CAREGIVER_UNASSIGNED',
    `${row.caregiver_name} unassigned from ${row.elder_name}.`);
  res.json({ ok: true });
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
    SELECT p.id, p.notes, p.created_at, p.updated_at, d.name as doctor_name
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
  const appt = db.prepare(`
    SELECT a.*, e.name AS elder_name, d.name AS doctor_name FROM appointments a
    JOIN users e ON e.id=a.elder_id JOIN users d ON d.id=a.doctor_id WHERE a.id=?
  `).get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (appt.status === status) return res.json({ ok: true });
  db.prepare('UPDATE appointments SET status=? WHERE id=?').run(status, req.params.id);

  const type = status === 'Cancelled' ? 'APPOINTMENT_CANCELLED' : 'APPOINTMENT_UPDATE';
  notify(appt.elder_id, type, `Appointment ${status.toLowerCase()} by administrator`,
    `Your appointment with Dr. ${appt.doctor_name} on ${appt.appt_date} at ${appt.appt_time} was set to ${status} by an administrator.`);
  notify(appt.doctor_id, type, `Appointment ${status.toLowerCase()} by administrator`,
    `The appointment with ${appt.elder_name} on ${appt.appt_date} at ${appt.appt_time} was set to ${status} by an administrator.`);
  if (['Confirmed', 'Cancelled'].includes(status)) {
    notifyCaregiversOfElder(appt.elder_id, type, `Appointment ${status.toLowerCase()}: ${appt.elder_name}`,
      `${appt.elder_name}'s appointment with Dr. ${appt.doctor_name} on ${appt.appt_date} at ${appt.appt_time} was set to ${status} by an administrator.`);
  }
  logActivity(req.user.id, req.user.name, 'APPOINTMENT_OVERRIDE',
    `Appointment #${appt.id} (${appt.elder_name} / Dr. ${appt.doctor_name}) → ${status}.`);
  res.json({ ok: true });
});

module.exports = router;
