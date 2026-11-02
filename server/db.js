const Database = require('better-sqlite3');
const path = require('path');

// ELDERAID_DB lets tests/CI point at a throwaway copy; default is the normal file.
const db = new Database(process.env.ELDERAID_DB || path.join(__dirname, 'elderaid.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ELDER','DOCTOR','CAREGIVER','ADMINISTRATOR')),
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS elder_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dob TEXT,
  address TEXT,
  blood_group TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS doctor_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialization TEXT,
  license_no TEXT
);

CREATE TABLE IF NOT EXISTS caregiver_elders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caregiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(caregiver_id, elder_id)
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  time_slot TEXT NOT NULL CHECK(time_slot IN ('Morning','Afternoon','Evening','Night')),
  instructions TEXT
);

CREATE TABLE IF NOT EXISTS medication_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medication_id INTEGER NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
  log_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Taken','Missed')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(medication_id, log_date)
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  appt_date TEXT NOT NULL,
  appt_time TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Confirmed','Cancelled','Completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Review 2 additions: health records, emergency alerts, notifications, activity logs.
-- Emergency contact info is intentionally NOT duplicated here: it already lives in
-- elder_profiles (emergency_contact_name / emergency_contact_phone) and is reused.

CREATE TABLE IF NOT EXISTS health_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_type TEXT NOT NULL DEFAULT 'General' CHECK(record_type IN ('General','Diagnosis','Lab Result','Vital Signs','Treatment','Other')),
  title TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergency_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  elder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  acknowledged_by INTEGER REFERENCES users(id),
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('MEDICATION_REMINDER','MISSED_MEDICATION','APPOINTMENT','APPOINTMENT_UPDATE','APPOINTMENT_CANCELLED','APPOINTMENT_REMINDER','EMERGENCY','PRESCRIPTION','HEALTH_RECORD','GENERAL')),
  title TEXT NOT NULL,
  message TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK(channel IN ('IN_APP','SMS')),
  recipient_name TEXT,
  recipient_contact TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'DELIVERED' CHECK(delivery_status IN ('PENDING','DELIVERED','FAILED')),
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  delivery_error TEXT,
  delivered_at TEXT,
  last_attempt_at TEXT,
  alert_id INTEGER REFERENCES emergency_alerts(id) ON DELETE CASCADE,
  dedupe_key TEXT,
  CHECK(channel <> 'IN_APP' OR user_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migration: add is_active to existing databases created before this column existed
const userCols = db.prepare(`PRAGMA table_info(users)`).all().map(c => c.name);
if (!userCols.includes('is_active')) {
  db.exec(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
}

// ---------------------------------------------------------------------------
// Review 3 migrations (all additive / idempotent; safe on existing databases)
// ---------------------------------------------------------------------------
const colsOf = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
const addColumn = (table, col, ddl) => {
  if (!colsOf(table).includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
};

// REQ-F-20: track prescription edits.
addColumn('prescriptions', 'updated_at', 'TEXT');
// REQ-F-23: medication schedule. schedule_from = local time from which doses are due
// (so a medicine added at 3pm does not create an already-"missed" 8am dose).
addColumn('medications', 'schedule_from', 'TEXT');
addColumn('medication_logs', 'scheduled_time', 'TEXT');   // 'HH:MM' local
addColumn('medication_logs', 'auto_missed', 'INTEGER NOT NULL DEFAULT 0');
// REQ-F-35: appointment rescheduling. Reminders count from the later of created_at / rescheduled_at.
addColumn('appointments', 'rescheduled_at', 'TEXT');

db.exec(`
  UPDATE medications SET schedule_from = (
    SELECT datetime(p.created_at, 'localtime') FROM prescriptions p WHERE p.id = medications.prescription_id
  ) WHERE schedule_from IS NULL;

  UPDATE medication_logs SET scheduled_time = (
    SELECT CASE m.time_slot WHEN 'Morning' THEN '08:00' WHEN 'Afternoon' THEN '13:00'
                            WHEN 'Evening' THEN '18:00' ELSE '21:00' END
    FROM medications m WHERE m.id = medication_logs.medication_id
  ) WHERE scheduled_time IS NULL;
`);

// REQ-F-72/75: notifications gain delivery state, channel, recipient and a dedupe key.
// SQLite cannot alter a CHECK constraint or relax NOT NULL, so databases created before
// this milestone get a one-time table rebuild (existing rows and ids are preserved).
if (!colsOf('notifications').includes('delivery_status')) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`ALTER TABLE notifications RENAME TO notifications_old`);
      db.exec(`
        CREATE TABLE notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('MEDICATION_REMINDER','MISSED_MEDICATION','APPOINTMENT','APPOINTMENT_UPDATE','APPOINTMENT_CANCELLED','APPOINTMENT_REMINDER','EMERGENCY','PRESCRIPTION','HEALTH_RECORD','GENERAL')),
          title TEXT NOT NULL,
          message TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK(channel IN ('IN_APP','SMS')),
          recipient_name TEXT,
          recipient_contact TEXT,
          delivery_status TEXT NOT NULL DEFAULT 'DELIVERED' CHECK(delivery_status IN ('PENDING','DELIVERED','FAILED')),
          delivery_attempts INTEGER NOT NULL DEFAULT 0,
          delivery_error TEXT,
          delivered_at TEXT,
          last_attempt_at TEXT,
          alert_id INTEGER REFERENCES emergency_alerts(id) ON DELETE CASCADE,
          dedupe_key TEXT,
          CHECK(channel <> 'IN_APP' OR user_id IS NOT NULL)
        );
        INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at, delivery_attempts, delivered_at)
          SELECT id, user_id, type, title, message, is_read, created_at, 1, created_at FROM notifications_old;
        DROP TABLE notifications_old;
      `);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// Duplicate-reminder protection: a non-null dedupe_key can only exist once.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_alert ON notifications(alert_id) WHERE alert_id IS NOT NULL;
`);

module.exports = db;
