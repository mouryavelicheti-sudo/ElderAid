// Lightweight in-process background scheduler (no external services, no new dependencies).
//
// Every TICK it runs these jobs, each isolated in its own try/catch so one failure can never
// stop the others or crash the Node process:
//   1. generateOccurrences   – REQ-F-23  create today's scheduled doses from prescriptions
//   2. medicationReminders   – REQ-F-64/65 remind the elder shortly before a dose is due
//   3. autoMissedMedication  – REQ-F-66  mark overdue, unconfirmed doses Missed + alert caregivers
//   4. appointmentReminders  – REQ-F-39/67 remind elder & doctor before an appointment
//   5. retryPendingDeliveries– REQ-F-75  retry external (SMS) messages that are still PENDING
//
// Duplicate protection: every reminder uses a notifications.dedupe_key (UNIQUE index), and the
// Missed transition is a conditional UPDATE (... WHERE status='Pending'), so re-running a tick
// any number of times produces exactly one notification per event.
//
// The scheduler NEVER sets a dose to Taken. Only the elder can confirm a dose.
const db = require('./db');
const { notify, notifyCaregiversOfElder, logActivity } = require('./notify');
const { retryPendingDeliveries } = require('./delivery');
const S = require('./schedule');

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
const CFG = {
  tickMs: num(process.env.SCHEDULER_TICK_SECONDS, 60) * 1000,
  medReminderLeadMin: num(process.env.MED_REMINDER_LEAD_MINUTES, 15),   // remind this long before the dose
  missedGraceMin: num(process.env.MED_MISSED_GRACE_MINUTES, 30),        // "scheduled period" after the dose time
  apptReminderTiers: [                                                  // appointment reminder windows
    { key: '24h', hours: num(process.env.APPT_REMINDER_HOURS_1, 24) },
    { key: '1h',  hours: num(process.env.APPT_REMINDER_HOURS_2, 1) },
  ],
  catchUpDays: 7,            // how far back overdue-dose detection looks
  staleMissedHours: 24,      // older overdue doses are marked Missed but caregivers are not alerted
};

const MIN = 60000;
const HOUR = 3600000;
const fmtTime = (hhmm) => hhmm.slice(0, 5);

// ---- 2. Medication reminders (REQ-F-64, REQ-F-65) ----
function medicationReminders(now) {
  const today = S.todayStr(now);
  const rows = db.prepare(`
    SELECT ml.id AS log_id, ml.scheduled_time, ml.log_date,
           m.name, m.dosage, m.time_slot, m.instructions, m.schedule_from, p.elder_id
    FROM medication_logs ml
    JOIN medications m ON m.id = ml.medication_id
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN users u ON u.id = p.elder_id AND u.is_active = 1
    WHERE ml.status = 'Pending' AND ml.log_date = ?
  `).all(today);

  let sent = 0;
  for (const r of rows) {
    const sched = S.parseLocal(r.log_date, r.scheduled_time || S.slotTime(r.time_slot));
    if (r.schedule_from && sched < S.parseLocalDateTime(r.schedule_from)) continue;
    const windowStart = new Date(sched.getTime() - CFG.medReminderLeadMin * MIN);
    const windowEnd = new Date(sched.getTime() + CFG.missedGraceMin * MIN); // after this it is auto-missed instead
    if (now < windowStart || now >= windowEnd) continue;

    const mins = Math.round((sched - now) / MIN);
    const when = mins > 0 ? `in ${mins} minute${mins === 1 ? '' : 's'}` : 'now';
    const ok = notify(
      r.elder_id, 'MEDICATION_REMINDER',
      `Medication reminder: ${r.name}`,
      `Time to take ${r.name} ${r.dosage} (${r.time_slot}, ${fmtTime(sched.toTimeString())}) — due ${when}.` +
        (r.instructions ? ` ${r.instructions}` : ''),
      { dedupeKey: `medrem:${r.log_id}` }
    );
    if (ok) sent++;
  }
  return sent;
}

// ---- 3. Automatic missed medication (REQ-F-66, also feeds REQ-F-28/83) ----
function autoMissedMedication(now) {
  const today = S.todayStr(now);
  const since = S.dateStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() - CFG.catchUpDays));
  const rows = db.prepare(`
    SELECT ml.id AS log_id, ml.scheduled_time, ml.log_date,
           m.name, m.dosage, m.time_slot, m.schedule_from,
           p.elder_id, u.name AS elder_name
    FROM medication_logs ml
    JOIN medications m ON m.id = ml.medication_id
    JOIN prescriptions p ON p.id = m.prescription_id
    JOIN users u ON u.id = p.elder_id
    WHERE ml.status = 'Pending' AND ml.log_date BETWEEN ? AND ?
  `).all(since, today);

  const markMissed = db.prepare(
    `UPDATE medication_logs SET status='Missed', auto_missed=1, updated_at=datetime('now') WHERE id=? AND status='Pending'`
  );
  let marked = 0;
  for (const r of rows) {
    const sched = S.parseLocal(r.log_date, r.scheduled_time || S.slotTime(r.time_slot));
    if (r.schedule_from && sched < S.parseLocalDateTime(r.schedule_from)) continue; // never due
    if (now.getTime() < sched.getTime() + CFG.missedGraceMin * MIN) continue;        // still inside the window

    // Conditional update: only a still-Pending dose can become Missed. Taken is never touched,
    // and if two ticks race, only one sees changes === 1.
    if (markMissed.run(r.log_id).changes !== 1) continue;
    marked++;

    const timeLabel = `${r.time_slot}, ${fmtTime(sched.toTimeString())}${r.log_date !== today ? ` on ${r.log_date}` : ''}`;
    logActivity(r.elder_id, r.elder_name, 'MEDICATION_AUTO_MISSED', `${r.name} ${r.dosage} (${timeLabel}) was not confirmed — marked Missed automatically.`);

    if (now.getTime() - sched.getTime() <= CFG.staleMissedHours * HOUR) {
      notifyCaregiversOfElder(
        r.elder_id, 'MISSED_MEDICATION',
        `Missed medication: ${r.elder_name}`,
        `${r.elder_name} did not confirm ${r.name} ${r.dosage} (${timeLabel}) within ${CFG.missedGraceMin} minutes. It was marked as missed automatically.`,
        { dedupePrefix: `medmiss:${r.log_id}` }
      );
      notify(
        r.elder_id, 'MISSED_MEDICATION',
        `You missed a dose: ${r.name}`,
        `${r.name} ${r.dosage} (${timeLabel}) was not confirmed in time. If you have taken it, open Today's medications and press Taken.`,
        { dedupeKey: `medmiss-elder:${r.log_id}` }
      );
    }
  }
  return marked;
}

// ---- 4. Appointment reminders (REQ-F-39, REQ-F-67) ----
function appointmentReminders(now) {
  const rows = db.prepare(`
    SELECT a.id, a.elder_id, a.doctor_id, a.appt_date, a.appt_time, a.reason, a.status, a.created_at, a.rescheduled_at,
           e.name AS elder_name, d.name AS doctor_name
    FROM appointments a
    JOIN users e ON e.id = a.elder_id JOIN users d ON d.id = a.doctor_id
    WHERE a.status IN ('Pending','Confirmed') AND a.appt_date >= ?
  `).all(S.todayStr(new Date(now.getTime() - 24 * HOUR)));

  let sent = 0;
  for (const a of rows) {
    const at = S.parseLocal(a.appt_date, (a.appt_time || '00:00').slice(0, 5));
    if (now >= at) continue; // already started / past — no reminder
    const booked = a.rescheduled_at || a.created_at;                  // a reschedule restarts the clock
    const created = new Date(booked.replace(' ', 'T') + 'Z');       // stored as UTC

    // Use the earliest tier that has opened but skip tiers whose window opened BEFORE the
    // appointment was booked (a "reminder" sent the instant you book is just noise).
    const tiers = CFG.apptReminderTiers
      .filter((t) => now.getTime() >= at.getTime() - t.hours * HOUR)
      .filter((t) => created.getTime() <= at.getTime() - t.hours * HOUR);
    if (tiers.length === 0) continue;
    const tier = tiers[tiers.length - 1]; // most imminent applicable tier (one reminder per cycle)

    const mins = Math.round((at - now) / MIN);
    const leadText = mins >= 120 ? `in about ${Math.round(mins / 60)} hours`
      : mins >= 60 ? 'in about 1 hour' : `in ${Math.max(mins, 1)} minute(s)`;
    const key = `apptrem:${a.id}:${a.appt_date}T${a.appt_time}:${tier.key}`;
    const pending = a.status === 'Pending';

    if (notify(a.elder_id, 'APPOINTMENT_REMINDER', 'Appointment reminder',
        `You have an appointment with Dr. ${a.doctor_name} on ${a.appt_date} at ${a.appt_time} (${leadText}).` +
        (pending ? ' It is still awaiting the doctor\'s confirmation.' : ''),
        { dedupeKey: `${key}:elder` })) sent++;

    if (notify(a.doctor_id, 'APPOINTMENT_REMINDER', 'Appointment reminder',
        `${pending ? 'Unconfirmed appointment' : 'Appointment'} with ${a.elder_name} on ${a.appt_date} at ${a.appt_time} (${leadText}).` +
        (pending ? ' Please confirm or cancel it.' : '') + (a.reason ? ` Reason: ${a.reason}` : ''),
        { dedupeKey: `${key}:doctor` })) sent++;

    // REQ-F-83: assigned caregivers also hear about the elder's upcoming appointment.
    sent += notifyCaregiversOfElder(a.elder_id, 'APPOINTMENT_REMINDER', `Appointment reminder: ${a.elder_name}`,
      `${a.elder_name} has an appointment with Dr. ${a.doctor_name} on ${a.appt_date} at ${a.appt_time} (${leadText}).`,
      { dedupePrefix: `${key}:cg` });
  }
  return sent;
}

// ---- runner ----
const lastRun = { at: null, results: {}, errors: {} };

function runJob(name, fn, now) {
  try {
    lastRun.results[name] = fn(now);
    delete lastRun.errors[name];
  } catch (err) {
    lastRun.errors[name] = err.message;
    console.error(`[scheduler] job "${name}" failed (continuing):`, err.message);
  }
}

let running = false;
// `now` is injectable so behaviour can be tested deterministically.
function tick(now = new Date()) {
  if (running) return lastRun; // never overlap
  running = true;
  try {
    runJob('generateOccurrences', (n) => S.generateOccurrences({ now: n }), now);
    runJob('medicationReminders', medicationReminders, now);
    runJob('autoMissedMedication', autoMissedMedication, now);
    runJob('appointmentReminders', appointmentReminders, now);
    runJob('retryPendingDeliveries', () => retryPendingDeliveries(), now);
    lastRun.at = now.toISOString();
  } finally {
    running = false;
  }
  return lastRun;
}

let timer = null;
function start() {
  if (timer || process.env.DISABLE_SCHEDULER === '1') return;
  tick(); // run once immediately so a restart catches up on overdue doses
  timer = setInterval(() => { try { tick(); } catch (e) { console.error('[scheduler] tick error', e.message); } }, CFG.tickMs);
  console.log(`ElderAid scheduler running every ${CFG.tickMs / 1000}s ` +
    `(med reminder ${CFG.medReminderLeadMin}m before, auto-missed ${CFG.missedGraceMin}m after).`);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }

module.exports = { start, stop, tick, CFG, lastRun, medicationReminders, autoMissedMedication, appointmentReminders };
