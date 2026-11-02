// Shared helpers for in-app notifications and the admin activity log.
// Built on the existing database — no external services.
//
// Backwards compatible: notify(userId, type, title, message) still works exactly as before.
// New (optional) 5th argument: { dedupeKey, alertId } — a dedupeKey can only ever produce one
// notification row, which is how scheduled reminders avoid duplicates (REQ-F-39/64/66).
const db = require('./db');

const insertInApp = db.prepare(`
  INSERT INTO notifications
    (user_id, type, title, message, channel, delivery_status, delivery_attempts, delivered_at, alert_id, dedupe_key)
  VALUES (?,?,?,?, 'IN_APP', 'DELIVERED', 1, datetime('now'), ?, ?)
`);

const insertLog = db.prepare(
  `INSERT INTO activity_logs (user_id, actor_name, action, details) VALUES (?,?,?,?)`
);

function logActivity(userId, actorName, action, details) {
  insertLog.run(userId || null, actorName || 'System', action, details || '');
}

// Returns true if a NEW in-app notification was created, false if it was a duplicate
// (same dedupeKey) or could not be stored. It never throws: a notification problem must not
// break the request or the scheduler that triggered it (REQ-F-75 safe failure handling).
function notify(userId, type, title, message, opts = {}) {
  try {
    insertInApp.run(userId, type, title, message || '', opts.alertId || null, opts.dedupeKey || null);
    return true;
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') return false; // already sent — expected
    console.error(`[notify] FAILED to store notification for user ${userId} (${type}):`, err.message);
    try {
      logActivity(null, 'System', 'NOTIFICATION_FAILED',
        `In-app notification "${title}" for user ${userId} could not be stored: ${err.message}`);
    } catch { /* logging must never throw either */ }
    return false;
  }
}

// Notify every caregiver assigned to a given elder. Returns number of NEW notifications.
// opts.dedupePrefix -> per-caregiver key `${prefix}:${caregiverId}`.
function notifyCaregiversOfElder(elderId, type, title, message, opts = {}) {
  const caregivers = db.prepare(
    `SELECT ce.caregiver_id FROM caregiver_elders ce JOIN users u ON u.id = ce.caregiver_id
     WHERE ce.elder_id=? AND u.is_active=1`
  ).all(elderId);
  let sent = 0;
  for (const c of caregivers) {
    const ok = notify(c.caregiver_id, type, title, message, {
      alertId: opts.alertId,
      dedupeKey: opts.dedupePrefix ? `${opts.dedupePrefix}:${c.caregiver_id}` : undefined,
    });
    if (ok) sent++;
  }
  return sent;
}

// Notify all administrators (used for SOS escalation).
function notifyAdmins(type, title, message, opts = {}) {
  const admins = db.prepare(
    `SELECT id FROM users WHERE role='ADMINISTRATOR' AND is_active=1`
  ).all();
  let sent = 0;
  for (const a of admins) if (notify(a.id, type, title, message, { alertId: opts.alertId })) sent++;
  return sent;
}

module.exports = { notify, notifyCaregiversOfElder, notifyAdmins, logActivity };
