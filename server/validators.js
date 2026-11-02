// Server-side input validation (REQ-F-13/17 elder profile, REQ-F-20/30 prescriptions).
// Validators never touch the database; routes call them BEFORE writing anything.
const { todayStr, parseLocal, dateStr } = require('./schedule');

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const TIME_SLOTS = ['Morning', 'Afternoon', 'Evening', 'Night'];

const RECORD_TYPES = ['General', 'Diagnosis', 'Lab Result', 'Vital Signs', 'Treatment', 'Other'];

const LIMITS = {
  recordTitle: 150, recordDescription: 2000, apptReason: 255,
  name: 100, address: 300, notes: 1000, contactName: 100,
  medName: 100, dosage: 50, frequency: 60, instructions: 255, rxNotes: 1000,
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/;

const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Returns { value } or { error }. Optional text -> value '' when blank.
function textField(raw, label, { required = false, min = 0, max, multiline = false }) {
  if (isBlank(raw)) return required ? { error: `${label} is required.` } : { value: '' };
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  const value = multiline
    ? raw.trim().replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ')
    : raw.trim().replace(/\s+/g, ' ');
  if (CONTROL_CHARS.test(value)) return { error: `${label} contains characters that are not allowed.` };
  if (value.length < min) return { error: `${label} must be at least ${min} characters.` };
  if (value.length > max) return { error: `${label} must be at most ${max} characters (currently ${value.length}).` };
  return { value };
}

function personName(raw, label, required) {
  const r = textField(raw, label, { required, min: 2, max: LIMITS.name });
  if (r.error || r.value === '') return r;
  if (!/\p{L}/u.test(r.value)) return { error: `${label} must contain letters.` };
  return r;
}

// Accepts +91 98765 43210, (044) 2345-6789, 9876543210 ... Stored as +?digits.
function phoneNumber(raw, label) {
  if (isBlank(raw)) return { value: '' };
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  const compact = raw.trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact)) return { error: `${label} may only contain digits, spaces, dashes, brackets and a leading +.` };
  const digits = compact.replace('+', '');
  if (compact.indexOf('+') > 0) return { error: `${label} is not a valid phone number.` };
  if (digits.length < 7 || digits.length > 15) return { error: `${label} must have 7 to 15 digits.` };
  if (/^(\d)\1+$/.test(digits)) return { error: `${label} is not a valid phone number.` };
  return { value: compact };
}

function dateOfBirth(raw) {
  if (isBlank(raw)) return { value: '' };
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return { error: 'Date of birth must be a valid date (YYYY-MM-DD).' };
  }
  const v = raw.trim();
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { error: 'Date of birth is not a real calendar date.' };
  }
  if (v > todayStr()) return { error: 'Date of birth cannot be in the future.' };
  if (y < new Date().getFullYear() - 130) return { error: 'Date of birth is not realistic (over 130 years ago).' };
  return { value: v };
}

function bloodGroup(raw) {
  if (isBlank(raw)) return { value: '' };
  if (typeof raw !== 'string') return { error: 'Blood group must be text.' };
  const v = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!BLOOD_GROUPS.includes(v)) return { error: `Blood group must be one of ${BLOOD_GROUPS.join(', ')}.` };
  return { value: v };
}

// body: request JSON. Returns { errors: {field: msg}, values: {...normalised} }.
// PUT semantics: `name` is required; other fields not present in the body keep `current`.
function validateElderProfile(body, current = {}) {
  const errors = {};
  const values = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: { _form: 'Invalid request body.' }, values };
  }
  const pick = (k) => (Object.prototype.hasOwnProperty.call(body, k) ? body[k] : current[k]);
  const take = (field, r) => { if (r.error) errors[field] = r.error; else values[field] = r.value; };

  take('name', personName(body.name, 'Full name', true));
  take('phone', phoneNumber(pick('phone'), 'Phone number'));
  take('dob', dateOfBirth(pick('dob')));
  take('blood_group', bloodGroup(pick('blood_group')));
  take('address', textField(pick('address'), 'Address', { max: LIMITS.address, multiline: true }));
  take('notes', textField(pick('notes'), 'Health notes', { max: LIMITS.notes, multiline: true }));
  take('emergency_contact_name', personName(pick('emergency_contact_name'), 'Emergency contact name', false));
  take('emergency_contact_phone', phoneNumber(pick('emergency_contact_phone'), 'Emergency contact phone'));

  // Emergency contact must be usable: a name needs a number and vice versa.
  if (!errors.emergency_contact_name && !errors.emergency_contact_phone) {
    if (values.emergency_contact_name && !values.emergency_contact_phone) {
      errors.emergency_contact_phone = 'Emergency contact phone is required when a contact name is given.';
    } else if (values.emergency_contact_phone && !values.emergency_contact_name) {
      errors.emergency_contact_name = 'Emergency contact name is required when a contact phone is given.';
    }
  }
  return { errors, values };
}

// One medication row (create or edit). `label` is used in messages, e.g. "Medicine 2".
function validateMedication(m, label, { allowId = false } = {}) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { error: `${label}: invalid medication entry.` };
  const out = {};
  const checks = [
    ['name', textField(m.name, `${label}: medicine name`, { required: true, max: LIMITS.medName })],
    ['dosage', textField(m.dosage, `${label}: dosage`, { required: true, max: LIMITS.dosage })],
    ['frequency', textField(m.frequency, `${label}: frequency`, { required: true, max: LIMITS.frequency })],
    ['instructions', textField(m.instructions, `${label}: instructions`, { max: LIMITS.instructions })],
  ];
  for (const [k, r] of checks) { if (r.error) return { error: r.error }; out[k] = r.value; }
  if (!TIME_SLOTS.includes(m.time_slot)) {
    return { error: `${label}: time of day must be one of ${TIME_SLOTS.join(', ')}.` };
  }
  out.time_slot = m.time_slot;
  if (allowId && m.id !== undefined && m.id !== null && m.id !== '') {
    const id = Number(m.id);
    if (!Number.isInteger(id) || id < 1) return { error: `${label}: invalid medication id.` };
    out.id = id;
  }
  return { value: out };
}

function validatePrescriptionNotes(raw) {
  return textField(raw, 'Prescription notes', { max: LIMITS.rxNotes, multiline: true });
}


// ---- Health records (REQ-F-48 / 51) ----
// Create: record_type optional (defaults to General) but if given it must be valid — it is
// never silently coerced. Update: absent fields keep `current`; present fields are validated.
function validateHealthRecord(body, current = null) {
  const errors = {}; const values = {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors: { _form: 'Invalid request body.' }, values };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  const t = textField(has('title') ? body.title : (current && current.title), 'Title', { required: true, min: 2, max: LIMITS.recordTitle });
  if (t.error) errors.title = t.error; else if (!/\p{L}|\p{N}/u.test(t.value)) errors.title = 'Title must contain letters or numbers.'; else values.title = t.value;

  const rawType = has('record_type') && !isBlank(body.record_type) ? body.record_type : (current ? current.record_type : 'General');
  if (typeof rawType !== 'string' || !RECORD_TYPES.includes(rawType)) errors.record_type = `Record type must be one of: ${RECORD_TYPES.join(', ')}.`;
  else values.record_type = rawType;

  const d = textField(has('description') ? body.description : (current && current.description), 'Description', { max: LIMITS.recordDescription, multiline: true });
  if (d.error) errors.description = d.error; else values.description = d.value;
  return { errors, values };
}

// ---- Appointments (REQ-F-31 / 35 / 41) ----
// Returns { value: { date, time } } or { error }. Rejects impossible dates/times and any slot
// that is not in the future (server local time).
function validateAppointmentSlot(date, time, now = new Date()) {
  if (isBlank(date) || isBlank(time)) return { error: 'Date and time are required.' };
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return { error: 'Please provide a valid date (YYYY-MM-DD).' };
  if (typeof time !== 'string' || !/^\d{2}:\d{2}(:\d{2})?$/.test(time.trim())) return { error: 'Please provide a valid time (HH:MM, 24-hour).' };
  const d = date.trim(); const tm = time.trim().slice(0, 5);
  const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = tm.split(':').map(Number);
  const cal = new Date(Date.UTC(y, m - 1, dd));
  if (cal.getUTCFullYear() !== y || cal.getUTCMonth() !== m - 1 || cal.getUTCDate() !== dd) return { error: 'That date does not exist.' };
  if (hh > 23 || mm > 59) return { error: 'That time is not valid.' };
  const when = parseLocal(d, tm);
  if (when <= now) return { error: 'The appointment must be in the future.' };
  const limit = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  if (d > dateStr(limit)) return { error: 'Appointments can be booked at most one year ahead.' };
  return { value: { date: d, time: tm } };
}

function validateAppointmentReason(raw) {
  return textField(raw, 'Reason', { max: LIMITS.apptReason });
}

module.exports = {
  RECORD_TYPES, validateHealthRecord, validateAppointmentSlot, validateAppointmentReason,
  BLOOD_GROUPS, TIME_SLOTS, LIMITS,
  validateElderProfile, validateMedication, validatePrescriptionNotes, phoneNumber,
};
