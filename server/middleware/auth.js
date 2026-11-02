const jwt = require('jsonwebtoken');
const db = require('../db');
const SECRET = process.env.JWT_SECRET || 'elderaid-dev-secret-change-in-prod';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  try {
    const payload = jwt.verify(token, SECRET);
    const row = db.prepare('SELECT is_active FROM users WHERE id=?').get(payload.id);
    if (!row || !row.is_active) {
      return res.status(403).json({ error: 'This account has been disabled. Contact an administrator.' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this resource.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, SECRET };
