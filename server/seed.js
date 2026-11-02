const bcrypt = require('bcryptjs');
const db = require('./db');
const { generateOccurrences, todayStr } = require('./schedule');

const hash = (pw) => bcrypt.hashSync(pw, 8);
const today = () => todayStr();

function upsertUser(name, email, role, phone) {
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (existing) return existing.id;
  const info = db.prepare(
    `INSERT INTO users (name,email,password_hash,role,phone) VALUES (?,?,?,?,?)`
  ).run(name, email, hash('password123'), role, phone);
  return info.lastInsertRowid;
}

const adminId = upsertUser('Kavitha Menon', 'admin@elderaid.com', 'ADMINISTRATOR', '9000000001');
const doctorId = upsertUser('Dr. Ananya Rao', 'doctor@elderaid.com', 'DOCTOR', '9000000002');
const caregiverId = upsertUser('Priya Sharma', 'caregiver@elderaid.com', 'CAREGIVER', '9000000003');
const elderId = upsertUser('Rajesh Kumar', 'elder@elderaid.com', 'ELDER', '9000000004');
const elder2Id = upsertUser('Lakshmi Iyer', 'elder2@elderaid.com', 'ELDER', '9000000005');

db.prepare(`INSERT OR IGNORE INTO doctor_profiles (user_id, specialization, license_no) VALUES (?,?,?)`)
  .run(doctorId, 'General Medicine', 'TN-MED-4471');

db.prepare(`INSERT OR IGNORE INTO elder_profiles
  (user_id, dob, address, blood_group, emergency_contact_name, emergency_contact_phone, notes)
  VALUES (?,?,?,?,?,?,?)`)
  .run(elderId, '1954-03-12', '14 Lake View Street, Chennai', 'B+', 'Meena Kumar (Daughter)', '9123456780', 'Mild hypertension.');

db.prepare(`INSERT OR IGNORE INTO elder_profiles
  (user_id, dob, address, blood_group, emergency_contact_name, emergency_contact_phone, notes)
  VALUES (?,?,?,?,?,?,?)`)
  .run(elder2Id, '1958-07-22', '22 Anna Nagar, Chennai', 'O+', 'Suresh Iyer (Son)', '9123456781', 'Type-2 diabetes.');

db.prepare(`INSERT OR IGNORE INTO caregiver_elders (caregiver_id, elder_id) VALUES (?,?)`)
  .run(caregiverId, elderId);

// Prescription + medications for elder 1
const rxExisting = db.prepare('SELECT id FROM prescriptions WHERE elder_id=?').get(elderId);
let rxId;
if (!rxExisting) {
  rxId = db.prepare(`INSERT INTO prescriptions (elder_id, doctor_id, notes) VALUES (?,?,?)`)
    .run(elderId, doctorId, 'Routine hypertension management. Recheck BP in 2 weeks.').lastInsertRowid;

  const meds = [
    ['Amlodipine', '5mg', 'Once daily', 'Morning', 'Take after breakfast.'],
    ['Metformin', '500mg', 'Twice daily', 'Morning', 'Take with food.'],
    ['Metformin', '500mg', 'Twice daily', 'Evening', 'Take with food.'],
  ];
  const insertMed = db.prepare(
    `INSERT INTO medications (prescription_id,name,dosage,frequency,time_slot,instructions,schedule_from) VALUES (?,?,?,?,?,?,?)`
  );
  // Demo data: treat the prescription as active from the start of today so the demo elder has
  // doses to confirm immediately (a real prescription starts from the moment it is written).
  const scheduleFrom = `${today()} 00:00:00`;
  meds.forEach(m => insertMed.run(rxId, ...m, scheduleFrom));

  // Doses are generated from the prescription (REQ-F-23); the scheduler keeps doing this daily.
  generateOccurrences({ elderId });
}

// Appointment for elder 1
const apptExisting = db.prepare('SELECT id FROM appointments WHERE elder_id=?').get(elderId);
if (!apptExisting) {
  db.prepare(
    `INSERT INTO appointments (elder_id, doctor_id, appt_date, appt_time, reason, status) VALUES (?,?,?,?,?,?)`
  ).run(elderId, doctorId, today(), '11:00', 'Routine blood pressure check-up', 'Pending');
}

console.log('Seed complete.');
console.log('Demo accounts (password: password123):');
console.log('  admin@elderaid.com      ADMINISTRATOR');
console.log('  doctor@elderaid.com     DOCTOR');
console.log('  caregiver@elderaid.com  CAREGIVER');
console.log('  elder@elderaid.com      ELDER (has prescription, meds, appointment)');
console.log('  elder2@elderaid.com     ELDER (no data yet, for testing empty states)');
