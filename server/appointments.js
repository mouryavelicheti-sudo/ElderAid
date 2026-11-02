// Small shared helper for appointment booking / rescheduling (REQ-F-31, REQ-F-35).
const db = require('./db');

// Returns an error string if the elder or the doctor already has a live (non-cancelled,
// non-completed) appointment at that slot, ignoring `excludeId` (the appointment being moved).
function slotConflict(elderId, doctorId, date, time, excludeId = 0) {
  const live = `status IN ('Pending','Confirmed') AND id <> ? AND appt_date=? AND appt_time=?`;
  if (db.prepare(`SELECT id FROM appointments WHERE elder_id=? AND ${live}`).get(elderId, excludeId, date, time)) {
    return 'You already have an appointment at that date and time.';
  }
  if (db.prepare(`SELECT id FROM appointments WHERE doctor_id=? AND ${live}`).get(doctorId, excludeId, date, time)) {
    return 'The doctor already has an appointment at that date and time. Please choose another slot.';
  }
  return null;
}

module.exports = { slotConflict };
