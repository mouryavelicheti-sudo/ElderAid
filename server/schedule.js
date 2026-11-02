// Medication schedule generation (REQ-F-23) and shared local-time helpers.
//
// Design: the existing `medication_logs` table (one row per medicine per day,
// UNIQUE(medication_id, log_date)) IS the list of scheduled occurrences. This module
// generates those rows from prescription data (time slot + frequency) instead of
// introducing a calendar system.
//
// All schedule logic uses the SERVER'S LOCAL TIME. Set the TZ environment variable
// (e.g. TZ=Asia/Kolkata) if the server host is not already in the users' time zone.
const db = require('./db');

// Time of day each slot is "due". Override with env if the care team prefers other times.
const SLOT_TIMES = {
  Morning:   process.env.SLOT_MORNING   || '08:00',
  Afternoon: process.env.SLOT_AFTERNOON || '13:00',
  Evening:   process.env.SLOT_EVENING   || '18:00',
  Night:     process.env.SLOT_NIGHT     || '21:00',
};

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateTimeStr = (d) => `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const todayStr = (now = new Date()) => dateStr(now);

// 'YYYY-MM-DD' + 'HH:MM[:SS]' -> Date in server-local time
function parseLocal(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, ss || 0, 0);
}
// 'YYYY-MM-DD HH:MM:SS' (local) -> Date
function parseLocalDateTime(s) {
  const [d, t] = s.split(/[ T]/);
  return parseLocal(d, t || '00:00');
}

// Free-text frequency -> how often (in days) a dose is due. 0 = no fixed schedule.
// "Twice daily" is modelled by the doctor adding one row per time of day (existing design),
// so every daily-style frequency is one occurrence per day for that row.
function frequencyIntervalDays(freq = '') {
  const f = String(freq).toLowerCase();
  if (/\b(as needed|prn|when required|if needed|sos)\b/.test(f)) return 0;
  if (/\b(weekly|once a week|once per week|every week)\b/.test(f)) return 7;
  if (/\b(alternate|every other day|every 2 days|every second day)\b/.test(f)) return 2;
  return 1;
}

const daysBetween = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 86400000);

// Is this medication due on `date` (YYYY-MM-DD)?
function isDueOn(med, date) {
  const interval = frequencyIntervalDays(med.frequency);
  if (interval === 0) return false;
  if (interval === 1) return true;
  const anchor = med.schedule_from ? med.schedule_from.slice(0, 10) : date;
  const diff = daysBetween(anchor, date);
  return diff >= 0 && diff % interval === 0;
}

const slotTime = (slot) => SLOT_TIMES[slot] || SLOT_TIMES.Night;

// Is a dose on `date` for this medication a valid scheduled occurrence?
function occurrenceValid(med, date) {
  if (!isDueOn(med, date)) return false;
  if (med.schedule_from) {
    const sched = parseLocal(date, slotTime(med.time_slot));
    if (sched < parseLocalDateTime(med.schedule_from)) return false; // dose time was before prescribing
  }
  return true;
}

const insertLog = db.prepare(
  `INSERT OR IGNORE INTO medication_logs (medication_id, log_date, status, scheduled_time) VALUES (?,?,'Pending',?)`
);

// Generate the scheduled occurrences (medication_logs rows) for one day.
// Idempotent: UNIQUE(medication_id, log_date) + INSERT OR IGNORE. Never touches existing rows,
// so a Taken/Missed row can never be reset by regeneration.
function generateOccurrences({ elderId = null, date = null, now = new Date() } = {}) {
  const day = date || todayStr(now);
  const meds = db.prepare(`
    SELECT m.id, m.time_slot, m.frequency, m.schedule_from
    FROM medications m JOIN prescriptions p ON p.id = m.prescription_id
    ${elderId ? 'WHERE p.elder_id = ?' : ''}
  `).all(...(elderId ? [elderId] : []));
  let created = 0;
  for (const m of meds) {
    if (!occurrenceValid(m, day)) continue;
    created += insertLog.run(m.id, day, slotTime(m.time_slot)).changes;
  }
  return created;
}

// Read-only preview of upcoming occurrences (not persisted) merged with any existing log status.
function upcomingOccurrences(elderId, days = 7, now = new Date()) {
  const meds = db.prepare(`
    SELECT m.id AS medication_id, m.name, m.dosage, m.frequency, m.time_slot, m.instructions, m.schedule_from
    FROM medications m JOIN prescriptions p ON p.id = m.prescription_id WHERE p.elder_id = ?
  `).all(elderId);
  const getLog = db.prepare(
    `SELECT status, auto_missed FROM medication_logs WHERE medication_id=? AND log_date=?`
  );
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const day = dateStr(d);
    for (const m of meds) {
      const existing = getLog.get(m.medication_id, day);
      if (!existing && !occurrenceValid(m, day)) continue;
      out.push({
        date: day, time: slotTime(m.time_slot), medication_id: m.medication_id,
        name: m.name, dosage: m.dosage, frequency: m.frequency, time_slot: m.time_slot,
        instructions: m.instructions,
        status: existing ? existing.status : 'Scheduled',
        auto_missed: existing ? existing.auto_missed : 0,
      });
    }
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

module.exports = {
  SLOT_TIMES, slotTime, pad, dateStr, dateTimeStr, todayStr,
  parseLocal, parseLocalDateTime, frequencyIntervalDays, isDueOn, occurrenceValid,
  generateOccurrences, upcomingOccurrences,
};
