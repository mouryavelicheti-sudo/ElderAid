// Notification delivery abstraction (REQ-F-57/58/70/75).
//
// In-app notifications are written straight to the `notifications` table with
// delivery_status = DELIVERED (that IS the delivery).
//
// EXTERNAL channels (currently SMS to an elder's emergency contact) go through here and
// are tracked in the same table with channel = 'SMS' and user_id = NULL:
//
//   PENDING   – queued / an attempt is in flight or will be retried
//   DELIVERED – the configured gateway accepted the message (HTTP 2xx)
//   FAILED    – permanently not sent (no gateway configured, bad number, or retries exhausted)
//
// IMPORTANT / HONESTY: no SMS or email infrastructure ships with ElderAid. Unless the
// operator sets SMS_WEBHOOK_URL (any HTTPS endpoint that accepts a JSON POST), external
// messages are recorded as FAILED with an explicit reason. The system never reports an
// SMS as DELIVERED unless a gateway actually accepted it.
const db = require('./db');
const { logActivity } = require('./notify');
const { phoneNumber } = require('./validators');

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_SECONDS = Number.isFinite(Number(process.env.DELIVERY_RETRY_SECONDS)) && process.env.DELIVERY_RETRY_SECONDS !== undefined
  ? Number(process.env.DELIVERY_RETRY_SECONDS) : 30;
const SEND_TIMEOUT_MS = 5000;
const inFlight = new Set();

const providers = {
  SMS: {
    name: 'sms-webhook',
    configured: () => !!process.env.SMS_WEBHOOK_URL,
    async send(n) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
      try {
        const res = await fetch(process.env.SMS_WEBHOOK_URL, {
          method: 'POST',
          signal: ctrl.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(process.env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_WEBHOOK_TOKEN}` } : {}),
          },
          body: JSON.stringify({ to: n.recipient_contact, message: `${n.title}. ${n.message || ''}`.trim(), notificationId: n.id }),
        });
        if (!res.ok) throw new Error(`Gateway responded with HTTP ${res.status}`);
      } finally {
        clearTimeout(timer);
      }
    },
  },
};

const maskPhone = (p) => (p ? String(p).replace(/.(?=.{3}$)/g, '•') : 'no number');
const getRow = (id) => db.prepare(`SELECT * FROM notifications WHERE id=?`).get(id);

// Queue an external notification. Returns the notification row id.
function queueExternal({ channel = 'SMS', type = 'EMERGENCY', title, message, recipientName, recipientContact, alertId, dedupeKey }) {
  const info = db.prepare(`
    INSERT INTO notifications
      (user_id, type, title, message, channel, recipient_name, recipient_contact, delivery_status, alert_id, dedupe_key)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(type, title, message || '', channel, recipientName || null, recipientContact || null, alertId || null, dedupeKey || null);
  return Number(info.lastInsertRowid);
}

function markFailed(id, reason, ownerId, ownerName) {
  db.prepare(`
    UPDATE notifications SET delivery_status='FAILED', delivery_error=?, delivery_attempts=delivery_attempts + CASE WHEN delivery_attempts=0 THEN 1 ELSE 0 END,
      last_attempt_at=datetime('now') WHERE id=? AND delivery_status<>'DELIVERED'
  `).run(reason, id);
  console.warn(`[delivery] #${id} FAILED: ${reason}`);
  try { logActivity(ownerId, ownerName, 'EMERGENCY_CONTACT_DELIVERY_FAILED', `Notification #${id}: ${reason}`); } catch { /* never throw */ }
}

// One delivery attempt. Synchronous for the cases that can be decided immediately
// (no gateway / bad number); asynchronous (fire-and-forget, errors contained) otherwise.
// Returns the notification row as it stands when this function returns.
function dispatchExternal(id, { ownerId = null, ownerName = 'System' } = {}) {
  const n = getRow(id);
  if (!n || n.channel === 'IN_APP' || n.delivery_status !== 'PENDING' || inFlight.has(id)) return n;

  const provider = providers[n.channel];
  const phone = phoneNumber(n.recipient_contact || '', 'Recipient phone');
  if (phone.error || !phone.value) {
    markFailed(id, 'Recipient phone number is missing or invalid — message was NOT sent.', ownerId, ownerName);
    return getRow(id);
  }
  if (!provider || !provider.configured()) {
    console.log(`[delivery] ${n.channel} to ${maskPhone(phone.value)} NOT sent: no gateway configured (set SMS_WEBHOOK_URL).`);
    markFailed(id, `No ${n.channel} gateway is configured on this server — message was NOT sent.`, ownerId, ownerName);
    return getRow(id);
  }

  inFlight.add(id);
  db.prepare(`UPDATE notifications SET delivery_attempts=delivery_attempts+1, last_attempt_at=datetime('now') WHERE id=?`).run(id);
  console.log(`[delivery] ${n.channel} to ${maskPhone(phone.value)} attempt ${n.delivery_attempts + 1}/${MAX_ATTEMPTS} (notification #${id})`);

  provider.send({ ...n, recipient_contact: phone.value })
    .then(() => {
      db.prepare(`UPDATE notifications SET delivery_status='DELIVERED', delivery_error=NULL, delivered_at=datetime('now') WHERE id=?`).run(id);
      console.log(`[delivery] #${id} DELIVERED via ${provider.name}`);
      try { logActivity(ownerId, ownerName, 'EMERGENCY_CONTACT_DELIVERED', `Notification #${id} accepted by ${provider.name}.`); } catch { /* ignore */ }
    })
    .catch((err) => {
      const attempts = (getRow(id) || {}).delivery_attempts || 0;
      const reason = `${err.name === 'AbortError' ? 'Gateway timed out' : err.message}`;
      if (attempts >= MAX_ATTEMPTS) markFailed(id, `${reason} (gave up after ${attempts} attempts).`, ownerId, ownerName);
      else {
        db.prepare(`UPDATE notifications SET delivery_error=? WHERE id=?`).run(`${reason} (will retry)`, id);
        console.warn(`[delivery] #${id} attempt ${attempts} failed: ${reason}; will retry`);
      }
    })
    .catch((e) => console.error('[delivery] unexpected error', e)) // belt and braces
    .finally(() => inFlight.delete(id));

  return getRow(id);
}

// Convenience: queue + first attempt.
function sendExternal(opts, owner) {
  const id = queueExternal(opts);
  return dispatchExternal(id, owner);
}

// Called by the scheduler: retry PENDING external messages that have not been tried recently.
function retryPendingDeliveries() {
  const rows = db.prepare(`
    SELECT id, alert_id FROM notifications
    WHERE channel <> 'IN_APP' AND delivery_status='PENDING'
      AND (last_attempt_at IS NULL OR last_attempt_at <= datetime('now', ?))
  `).all(`-${RETRY_AFTER_SECONDS} seconds`);
  for (const r of rows) {
    const owner = r.alert_id
      ? db.prepare(`SELECT a.elder_id AS id, u.name FROM emergency_alerts a JOIN users u ON u.id=a.elder_id WHERE a.id=?`).get(r.alert_id)
      : null;
    dispatchExternal(r.id, { ownerId: owner?.id, ownerName: owner?.name });
  }
  return rows.length;
}

// External delivery records attached to an emergency alert (for elder/caregiver UI).
function deliveriesForAlert(alertId) {
  return db.prepare(`
    SELECT id, channel, recipient_name, recipient_contact, delivery_status, delivery_attempts,
           delivery_error, delivered_at, created_at
    FROM notifications WHERE alert_id=? AND channel <> 'IN_APP' ORDER BY id
  `).all(alertId);
}

module.exports = { queueExternal, dispatchExternal, sendExternal, retryPendingDeliveries, deliveriesForAlert, MAX_ATTEMPTS };
