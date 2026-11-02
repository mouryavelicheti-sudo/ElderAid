const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// List my notifications (newest first) + unread count.
// Only rows addressed to the logged-in user are ever returned (REQ-F-76); external-channel
// delivery records for emergency contacts have user_id NULL and never appear in any inbox.
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, type, title, message, is_read, created_at,
           channel, delivery_status, delivery_error
    FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100
  `).all(req.user.id);
  const unread = db.prepare(
    `SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0`
  ).get(req.user.id).c;
  res.json({ notifications: rows, unreadCount: unread });
});

// Lightweight endpoint for the navbar badge.
router.get('/unread-count', (req, res) => {
  const unread = db.prepare(
    `SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0`
  ).get(req.user.id).c;
  res.json({ unreadCount: unread });
});

// Mark one of my notifications as read.
router.put('/:id/read', (req, res) => {
  const info = db.prepare(
    `UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`
  ).run(req.params.id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ ok: true });
});

// Mark all of my notifications as read.
router.put('/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
