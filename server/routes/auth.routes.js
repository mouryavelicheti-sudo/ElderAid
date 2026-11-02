const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, SECRET } = require('../middleware/auth');

const router = express.Router();

const REGISTERABLE_ROLES = ['ELDER', 'DOCTOR', 'CAREGIVER', 'ADMINISTRATOR'];

router.post('/register', (req, res) => {
  const { name, email, password, role, phone } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are required.' });
  }
  if (!REGISTERABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role selected.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Only allow self-registering as ADMINISTRATOR when no administrator exists yet
  // (first-run bootstrap). After that, new admins must be created by an existing admin.
  if (role === 'ADMINISTRATOR') {
    const adminCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='ADMINISTRATOR'`).get().c;
    if (adminCount > 0) {
      return res.status(403).json({ error: 'An administrator already exists. Ask an existing administrator to create your account from the Admin dashboard.' });
    }
  }

  const cleanEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, phone) VALUES (?,?,?,?,?)'
  ).run(name.trim(), cleanEmail, passwordHash, role, phone || null);

  if (role === 'DOCTOR') {
    db.prepare('INSERT INTO doctor_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  } else if (role === 'ELDER') {
    db.prepare('INSERT INTO elder_profiles (user_id) VALUES (?)').run(info.lastInsertRowid);
  }

  const user = { id: info.lastInsertRowid, name: name.trim(), role, email: cleanEmail };
  const token = jwt.sign(user, SECRET, { expiresIn: '12h' });
  res.status(201).json({ token, user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'This account has been disabled. Contact an administrator.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, role: user.role, email: user.email },
    SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, email: user.email } });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
