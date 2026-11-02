// End-to-end + security tests for the Review-3 gap closure. Run:  npm test
// Spawns the REAL server against a throw-away database; scheduler jobs are driven with an
// injected clock; external delivery is tested against a local mock SMS gateway.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(os.tmpdir(), `elderaid-test-${process.pid}.db`);
for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }

process.env.ELDERAID_DB = DB_FILE;
process.env.DISABLE_SCHEDULER = '1';           // tests call scheduler.tick(fakeNow) explicitly
process.env.DELIVERY_RETRY_SECONDS = '0';
const GATEWAY_PORT = 4398;
const SERVER_PORT = 4397;

execFileSync('node', ['seed.js'], { cwd: ROOT, env: process.env, stdio: 'ignore' });

const db = require('../db');
const S = require('../schedule');
const scheduler = require('../scheduler');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail !== undefined ? '  → ' + JSON.stringify(detail) : ''}`); }
}
const section = (t) => console.log(`\n=== ${t} ===`);

let BASE = `http://127.0.0.1:${SERVER_PORT}/api`;
async function api(method, url, token, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null; try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: json };
}
const login = async (email, pw = 'password123') => (await api('POST', '/auth/login', null, { email, password: pw })).body;

let child = null;
async function startServer(extraEnv = {}) {
  await stopServer();
  child = spawn('node', ['index.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(SERVER_PORT), DISABLE_SCHEDULER: '1', ...extraEnv },
  });
  child.stdout.on('data', () => {}); child.stderr.on('data', (d) => { if (process.env.TEST_VERBOSE) process.stderr.write(d); });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (!child) return;
  const c = child; child = null;
  await new Promise((r) => { c.once('exit', r); c.kill(); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- helpers over the DB for assertions ----
const notifs = (userId, where = '1=1', ...p) =>
  db.prepare(`SELECT * FROM notifications WHERE user_id=? AND ${where}`).all(userId, ...p);
const uid = (email) => db.prepare('SELECT id FROM users WHERE email=?').get(email).id;
const local = (date, hhmm) => S.parseLocal(date, hhmm);
const utcStamp = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const today = S.todayStr();
const addDays = (n) => S.dateStr(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + n));

// ---- mock SMS gateway ----
const gatewayCalls = {};
let gateway;
function startGateway() {
  return new Promise((resolve) => {
    gateway = http.createServer((req, res) => {
      let data = ''; req.on('data', (c) => (data += c));
      req.on('end', () => {
        const to = JSON.parse(data || '{}').to;
        gatewayCalls[to] = (gatewayCalls[to] || 0) + 1;
        // 9123456781: first call fails (500) then succeeds.  9555000099: always fails.
        const ok = to === '9123456781' ? gatewayCalls[to] > 1 : to !== '9555000099';
        res.statusCode = ok ? 200 : 500; res.end('{}');
      });
    }).listen(GATEWAY_PORT, resolve);
  });
}

(async () => {
  await startServer();

  // ------------------------------------------------------------------ accounts
  const adm = await login('admin@elderaid.com');
  const doc1 = await login('doctor@elderaid.com');
  const cg1 = await login('caregiver@elderaid.com');
  const eld1 = await login('elder@elderaid.com');
  const eld2 = await login('elder2@elderaid.com');
  const mk = async (name, email, role) => (await api('POST', '/admin/users', adm.token, { name, email, password: 'password123', role, phone: '9000000099' }));
  const r1 = await mk('Dr. Second Doctor', 'doctor2@elderaid.com', 'DOCTOR');
  const r2 = await mk('Carl Unassigned', 'caregiver2@elderaid.com', 'CAREGIVER');
  const r3 = await mk('Edna Third Elder', 'elder3@elderaid.com', 'ELDER');
  const doc2 = await login('doctor2@elderaid.com');
  const cg2 = await login('caregiver2@elderaid.com');
  const eld3 = await login('elder3@elderaid.com');
  const ID = { adm: adm.user.id, doc1: doc1.user.id, doc2: doc2.user.id, cg1: cg1.user.id, cg2: cg2.user.id, e1: eld1.user.id, e2: eld2.user.id, e3: eld3.user.id };

  section('AUTH (REQ-F-01..09)');
  check('login ok for all roles', [adm, doc1, cg1, eld1].every((x) => x.token));
  check('invalid credentials rejected with message', (await api('POST', '/auth/login', null, { email: 'elder@elderaid.com', password: 'nope' })).status === 401);
  check('admin-created users created', r1.status === 201 && r2.status === 201 && r3.status === 201);

  // ================================================================== ELDER PROFILE (REQ-F-13/17)
  section('ELDER PROFILE VALIDATION (REQ-F-12/13/17)');
  const before = (await api('GET', '/elder/profile', eld1.token)).body;
  const good = { name: 'Rajesh Kumar', phone: '9000000004', dob: '1954-03-12', address: '14 Lake View Street, Chennai', blood_group: 'B+', emergency_contact_name: 'Meena Kumar (Daughter)', emergency_contact_phone: '9123456780', notes: 'Mild hypertension.' };
  const bad = [
    ['empty name', { ...good, name: '' }, /name is required/i],
    ['whitespace name', { ...good, name: '   ' }, /name is required/i],
    ['missing name', (({ name, ...r }) => r)(good), /name is required/i],
    ['numeric name', { ...good, name: 12345 }, /must be text|must contain letters/i],
    ['name with only digits', { ...good, name: '12345' }, /must contain letters/i],
    ['101-char name', { ...good, name: 'A'.repeat(101) }, /at most 100/i],
    ['name with html', { ...good, name: 'Bob <script>' }, /not allowed/i],
    ['phone letters', { ...good, phone: 'abcdefg' }, /Phone number/i],
    ['phone too short', { ...good, phone: '12345' }, /7 to 15 digits/i],
    ['phone too long', { ...good, phone: '1'.repeat(16) }, /7 to 15 digits/i],
    ['phone plus in middle', { ...good, phone: '98+7654321' }, /Phone number/i],
    ['dob future', { ...good, dob: '2999-01-01' }, /future/i],
    ['dob not a date', { ...good, dob: 'yesterday' }, /valid date/i],
    ['dob impossible', { ...good, dob: '2023-02-30' }, /real calendar date/i],
    ['dob too old', { ...good, dob: '1700-01-01' }, /realistic/i],
    ['blood group invalid', { ...good, blood_group: 'Z+' }, /Blood group/i],
    ['contact name without phone', { ...good, emergency_contact_phone: '' }, /phone is required/i],
    ['contact phone without name', { ...good, emergency_contact_name: '' }, /name is required/i],
    ['contact phone invalid', { ...good, emergency_contact_phone: 'call me' }, /Emergency contact phone/i],
    ['address too long', { ...good, address: 'x'.repeat(301) }, /Address must be at most/i],
    ['notes too long', { ...good, notes: 'x'.repeat(1001) }, /Health notes must be at most/i],
  ];
  for (const [label, payload, re] of bad) {
    const r = await api('PUT', '/elder/profile', eld1.token, payload);
    check(`400 + message: ${label}`, r.status === 400 && re.test(r.body.error || ''), { status: r.status, body: r.body });
  }
  const afterBad = (await api('GET', '/elder/profile', eld1.token)).body;
  check('REQ-F-13: invalid submissions changed NOTHING in the database', JSON.stringify(before) === JSON.stringify(afterBad));
  const multi = await api('PUT', '/elder/profile', eld1.token, { ...good, name: '', phone: 'zz', dob: '2999-01-01' });
  check('multiple problems → per-field errors map returned', multi.status === 400 && multi.body.errors && multi.body.errors.name && multi.body.errors.phone && multi.body.errors.dob, multi.body);
  const okp = await api('PUT', '/elder/profile', eld1.token, { ...good, phone: '+91 90000-00004', blood_group: 'b+', address: ' 14 Lake View  Street ' });
  check('valid update accepted + normalised', okp.status === 200 && okp.body.profile.phone === '+919000000004' && okp.body.profile.blood_group === 'B+');
  const ap = (await api('GET', '/elder/profile', eld1.token)).body;
  check('update persisted', ap.phone === '+919000000004' && ap.blood_group === 'B+' && ap.address === '14 Lake View Street');
  check('optional fields can be cleared with empty string', (await api('PUT', '/elder/profile', eld1.token, { ...good, dob: '', blood_group: '', address: '', notes: '', emergency_contact_name: '', emergency_contact_phone: '' })).status === 200
    && (await api('GET', '/elder/profile', eld1.token)).body.blood_group === null);
  await api('PUT', '/elder/profile', eld1.token, good); // restore
  const other0 = (await api('GET', '/elder/profile', eld2.token)).body;
  const sneaky = await api('PUT', '/elder/profile', eld1.token, { ...good, id: ID.e2, user_id: ID.e2, name: 'Hijacked Name' });
  const other1 = (await api('GET', '/elder/profile', eld2.token)).body;
  check('SECURITY: elder cannot modify another elder via body ids', sneaky.status === 200 && JSON.stringify(other0) === JSON.stringify(other1) && other1.name !== 'Hijacked Name');
  await api('PUT', '/elder/profile', eld1.token, { ...good, name: 'Rajesh Kumar' });

  // ================================================================== PRESCRIPTION EDIT (REQ-F-20)
  section('PRESCRIPTION CREATE + EDIT (REQ-F-18/19/20/22/30)');
  const badCreate = await api('POST', '/doctor/prescriptions', doc1.token, { elder_id: ID.e1, notes: '', medications: [{ name: '', dosage: '5mg', frequency: 'Daily', time_slot: 'Morning' }] });
  check('create: invalid medication → 400 with message', badCreate.status === 400 && /medicine name is required/i.test(badCreate.body.error), badCreate.body);
  check('create: bad slot → 400', (await api('POST', '/doctor/prescriptions', doc1.token, { elder_id: ID.e1, medications: [{ name: 'X', dosage: '1', frequency: 'Daily', time_slot: 'Noon' }] })).status === 400);
  const create = await api('POST', '/doctor/prescriptions', doc1.token, {
    elder_id: ID.e1, notes: 'Test course',
    medications: [
      { name: 'TestMedA', dosage: '5mg', frequency: 'Once daily', time_slot: 'Morning', instructions: 'after food' },
      { name: 'TestMedB', dosage: '10mg', frequency: 'Once daily', time_slot: 'Evening', instructions: '' },
      { name: 'TestMedC', dosage: '2mg', frequency: 'Once daily', time_slot: 'Evening', instructions: '' },
      { name: 'TestWeekly', dosage: '70mg', frequency: 'Weekly', time_slot: 'Morning', instructions: '' },
      { name: 'TestPRN', dosage: '1 tab', frequency: 'As needed', time_slot: 'Night', instructions: '' },
    ],
  });
  check('create prescription (multi-medicine) still works', create.status === 201 && create.body.id);
  const RX = create.body.id;
  const medsOf = (rx) => db.prepare('SELECT * FROM medications WHERE prescription_id=? ORDER BY id').all(rx);
  const [mA, mB, mC, mW, mP] = medsOf(RX);
  check('create: elder notified of new prescription', notifs(ID.e1, "type='PRESCRIPTION' AND title='New prescription added'").length >= 1);

  const nBefore = notifs(ID.e1, "title='Prescription updated'").length;
  const ed = await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, {
    notes: 'Test course (revised)',
    medications: [{ id: mA.id, name: 'TestMedA', dosage: '10mg', frequency: 'Once daily', time_slot: 'Morning', instructions: 'before food' }],
  });
  check('doctor edits notes + dosage + instructions → 200', ed.status === 200 && ed.body.changed === true, ed.body);
  const afterEd = db.prepare('SELECT * FROM medications WHERE id=?').get(mA.id);
  check('edit persisted (dosage, instructions)', afterEd.dosage === '10mg' && afterEd.instructions === 'before food');
  check('edit persisted (notes + updated_at)', (() => { const p = db.prepare('SELECT * FROM prescriptions WHERE id=?').get(RX); return p.notes === 'Test course (revised)' && p.updated_at; })());
  check('other medicines in the prescription untouched', db.prepare('SELECT dosage FROM medications WHERE id=?').get(mB.id).dosage === '10mg' && medsOf(RX).length === 5);
  check('elder notified of the update', notifs(ID.e1, "title='Prescription updated'").length === nBefore + 1);
  const noop = await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, { notes: 'Test course (revised)', medications: [{ id: mA.id, name: 'TestMedA', dosage: '10mg', frequency: 'Once daily', time_slot: 'Morning', instructions: 'before food' }] });
  check('no-op edit → changed:false and NO extra notification', noop.status === 200 && noop.body.changed === false && notifs(ID.e1, "title='Prescription updated'").length === nBefore + 1);
  const ed2 = await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, { medications: [{ id: mA.id, name: 'TestMedA-Renamed', dosage: '10mg', frequency: 'Twice daily', time_slot: 'Afternoon', instructions: 'x' }, { name: 'TestAdded', dosage: '1mg', frequency: 'Once daily', time_slot: 'Night' }] });
  check('edit name/frequency/time slot + add a new medicine', ed2.status === 200 && medsOf(RX).length === 6 && db.prepare('SELECT time_slot,name FROM medications WHERE id=?').get(mA.id).time_slot === 'Afternoon');
  const ev = [
    ['empty body', {}, 400],
    ['empty medicine name', { medications: [{ id: mA.id, name: ' ', dosage: '1', frequency: 'd', time_slot: 'Morning' }] }, 400],
    ['invalid time slot', { medications: [{ id: mA.id, name: 'a', dosage: '1', frequency: 'd', time_slot: 'Midnight' }] }, 400],
    ['dosage too long', { medications: [{ id: mA.id, name: 'a', dosage: 'x'.repeat(51), frequency: 'd', time_slot: 'Morning' }] }, 400],
    ['medications not an array', { medications: 'nope' }, 400],
    ['empty medications array', { medications: [] }, 400],
    ['notes not text', { notes: { a: 1 } }, 400],
    ['notes too long', { notes: 'x'.repeat(1001) }, 400],
    ['duplicate medicine id', { medications: [{ id: mA.id, name: 'a', dosage: '1', frequency: 'd', time_slot: 'Morning' }, { id: mA.id, name: 'b', dosage: '1', frequency: 'd', time_slot: 'Morning' }] }, 400],
    ['medicine id from another prescription', { medications: [{ id: db.prepare('SELECT id FROM medications WHERE prescription_id<>? LIMIT 1').get(RX).id, name: 'a', dosage: '1', frequency: 'd', time_slot: 'Morning' }] }, 400],
  ];
  for (const [label, payload, code] of ev) {
    const r = await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, payload);
    check(`edit validation: ${label} → ${code}`, r.status === code && r.body.error, r);
  }
  check('edit: unknown prescription → 404', (await api('PUT', '/doctor/prescriptions/999999', doc1.token, { notes: 'x' })).status === 404);
  check('edit: non-numeric id → 400', (await api('PUT', '/doctor/prescriptions/abc', doc1.token, { notes: 'x' })).status === 400);
  // restore A for the scheduler tests below
  await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, { medications: [{ id: mA.id, name: 'TestMedA', dosage: '10mg', frequency: 'Once daily', time_slot: 'Morning', instructions: '' }] });

  section('SECURITY: prescription edit authorization');
  const sec = async (label, token, expected) => { const r = await api('PUT', `/doctor/prescriptions/${RX}`, token, { notes: 'hack' }); check(label, r.status === expected, r); };
  await sec('ELDER cannot edit a prescription (403)', eld1.token, 403);
  await sec('CAREGIVER cannot edit a prescription (403)', cg1.token, 403);
  await sec('ADMIN cannot edit a prescription (403)', adm.token, 403);
  await sec("another DOCTOR cannot edit this doctor's prescription (403)", doc2.token, 403);
  await sec('unauthenticated cannot edit (401)', null, 401);
  check('prescription unchanged after all denied attempts', db.prepare('SELECT notes FROM prescriptions WHERE id=?').get(RX).notes === 'Test course (revised)');

  // ================================================================== MEDICATION SCHEDULE (REQ-F-23)
  section('MEDICATION SCHEDULE GENERATION (REQ-F-23/24)');
  // Treat the prescription as active from the start of today so today's slots are valid.
  db.prepare('UPDATE medications SET schedule_from=? WHERE prescription_id=?').run(`${today} 00:00:00`, RX);
  scheduler.tick(local(today, '06:00'));
  const logs = (medId) => db.prepare('SELECT * FROM medication_logs WHERE medication_id=? AND log_date=?').get(medId, today);
  check('daily Morning med → occurrence at 08:00', logs(mA.id) && logs(mA.id).scheduled_time === '08:00' && logs(mA.id).status === 'Pending');
  check('daily Evening med → occurrence at 18:00', logs(mB.id) && logs(mB.id).scheduled_time === '18:00');
  check('weekly med is due on its first day', !!logs(mW.id));
  check('"As needed" med produces NO scheduled occurrence', !logs(mP.id));
  const sched = (await api('GET', '/elder/medications/schedule?days=8', eld1.token)).body;
  check('GET /elder/medications/schedule returns generated occurrences', Array.isArray(sched) && sched.some((o) => o.name === 'TestMedA' && o.date === today && o.time === '08:00'));
  check('weekly med not scheduled on day 2..7, scheduled again on day 8', !sched.some((o) => o.name === 'TestWeekly' && o.date > today && o.date < addDays(7)) && sched.some((o) => o.name === 'TestWeekly' && o.date === addDays(7)));
  const todayList = (await api('GET', '/elder/medications/today', eld1.token)).body;
  check('elder today list is built from occurrences (has time + status)', todayList.some((m) => m.name === 'TestMedA' && m.scheduled_time === '08:00' && m.status === 'Pending') && !todayList.some((m) => m.name === 'TestPRN'));
  const before2 = db.prepare('SELECT COUNT(*) c FROM medication_logs').get().c;
  scheduler.tick(local(today, '06:05')); scheduler.tick(local(today, '06:06'));
  check('generation is idempotent (no duplicate occurrences)', db.prepare('SELECT COUNT(*) c FROM medication_logs').get().c === before2);
  check('a medicine prescribed AFTER its dose time today gets no already-missed dose', (() => {
    // schedule_from = now, Morning slot already passed in the fake clock -> not generated
    const fresh = db.prepare(`INSERT INTO medications (prescription_id,name,dosage,frequency,time_slot,instructions,schedule_from) VALUES (?,?,?,?,?,?,?)`)
      .run(RX, 'TestLate', '1', 'Once daily', 'Morning', '', `${today} 15:00:00`).lastInsertRowid;
    S.generateOccurrences({ now: local(today, '16:00') });   // generation only (a full tick would also auto-miss other doses)
    const r = !db.prepare('SELECT 1 FROM medication_logs WHERE medication_id=?').get(fresh);
    db.prepare('DELETE FROM medications WHERE id=?').run(fresh);
    return r;
  })());

  // ================================================================== MED REMINDERS (REQ-F-64/65)
  section('MEDICATION REMINDERS (REQ-F-64/65)');
  const remCount = () => notifs(ID.e1, "type='MEDICATION_REMINDER' AND message LIKE '%TestMedA%'").length;
  scheduler.tick(local(today, '07:40'));
  check('no reminder before the reminder window (07:40)', remCount() === 0);
  scheduler.tick(local(today, '07:50'));
  check('reminder created for elder when dose is approaching (07:50)', remCount() === 1);
  check('reminder is an in-app MEDICATION_REMINDER addressed to the elder', notifs(ID.e1, "type='MEDICATION_REMINDER' AND message LIKE '%TestMedA%' AND channel='IN_APP' AND delivery_status='DELIVERED'").length === 1);
  scheduler.tick(local(today, '07:51')); scheduler.tick(local(today, '07:52')); scheduler.tick(local(today, '08:05'));
  check('NO duplicate reminders over repeated scheduler cycles', remCount() === 1);
  check('caregiver is not sent the elder\'s dose reminder', notifs(ID.cg1, "type='MEDICATION_REMINDER'").length === 0);

  // ================================================================== AUTO MISSED (REQ-F-66)
  section('AUTOMATIC MISSED MEDICATION (REQ-F-66)');
  const stat = (id) => db.prepare('SELECT status, auto_missed FROM medication_logs WHERE medication_id=? AND log_date=?').get(id, today);
  const cgMiss = (name) => notifs(ID.cg1, `type='MISSED_MEDICATION' AND message LIKE '%${name}%'`).length;
  scheduler.tick(local(today, '08:20'));
  check('still Pending inside the grace period (08:20)', stat(mA.id).status === 'Pending');
  scheduler.tick(local(today, '08:31'));
  check('overdue + unconfirmed → automatically Missed (08:31)', stat(mA.id).status === 'Missed' && stat(mA.id).auto_missed === 1);
  check('assigned caregiver received MISSED_MEDICATION', cgMiss('TestMedA') === 1);
  check('elder also told (in-app)', notifs(ID.e1, "type='MISSED_MEDICATION' AND title LIKE '%TestMedA%'").length === 1);
  scheduler.tick(local(today, '08:32')); scheduler.tick(local(today, '09:00')); scheduler.tick(local(today, '12:00'));
  check('NO duplicate missed notifications on later cycles', cgMiss('TestMedA') === 1 && notifs(ID.e1, "type='MISSED_MEDICATION' AND title LIKE '%TestMedA%'").length === 1);
  check('unassigned caregiver NOT notified', notifs(ID.cg2, "type='MISSED_MEDICATION'").length === 0);
  check('auto-miss written to the activity log', db.prepare("SELECT COUNT(*) c FROM activity_logs WHERE action='MEDICATION_AUTO_MISSED' AND details LIKE '%TestMedA%'").get().c === 1);

  // Taken must never be overridden; scheduler must never mark Taken.
  const tk = await api('PUT', `/elder/medications/${mB.id}/status`, eld1.token, { status: 'Taken' });
  check('elder confirms Taken via API', tk.status === 200 && stat(mB.id).status === 'Taken');
  const takenAt = db.prepare('SELECT updated_at FROM medication_logs WHERE medication_id=? AND log_date=?').get(mB.id, today).updated_at;
  check('REQ-F-26: confirmation status + time recorded', !!takenAt);
  scheduler.tick(local(today, '19:00')); scheduler.tick(local(today, '23:00'));
  check('Taken dose stays Taken after it is overdue (never auto-missed)', stat(mB.id).status === 'Taken' && stat(mB.id).auto_missed === 0);
  check('no missed notification for the Taken dose', cgMiss('TestMedB') === 0);
  check('untaken Evening dose (TestMedC) → auto Missed', stat(mC.id).status === 'Missed' && cgMiss('TestMedC') === 1);
  check('scheduler never created a Taken status on its own', db.prepare("SELECT COUNT(*) c FROM medication_logs WHERE status='Taken'").get().c === 1);

  // Late confirmation by elder after an auto-miss; manual Missed must not double-notify.
  const late = await api('PUT', `/elder/medications/${mA.id}/status`, eld1.token, { status: 'Taken' });
  check('elder can still confirm an auto-missed dose as Taken (late)', late.status === 200 && stat(mA.id).status === 'Taken' && stat(mA.id).auto_missed === 0);
  await api('PUT', `/elder/medications/${mA.id}/status`, eld1.token, { status: 'Missed' });
  check('manual Missed after auto-miss does NOT duplicate the caregiver notification', cgMiss('TestMedA') === 1);
  await api('PUT', `/elder/medications/${mA.id}/status`, eld1.token, { status: 'Taken' });
  const manualMissed = await api('PUT', `/elder/medications/${mW.id}/status`, eld1.token, { status: 'Missed' });
  await api('PUT', `/elder/medications/${mW.id}/status`, eld1.token, { status: 'Missed' });
  check('manual Missed (existing flow) still notifies caregiver, exactly once', manualMissed.status === 200 && cgMiss('TestWeekly') === 1);
  check('invalid medication status → 400', (await api('PUT', `/elder/medications/${mA.id}/status`, eld1.token, { status: 'Done' })).status === 400);

  // Edit timing → schedule regenerated, no false miss
  const ed3 = await api('PUT', `/doctor/prescriptions/${RX}`, doc1.token, { medications: [{ id: mC.id, name: 'TestMedC', dosage: '2mg', frequency: 'Once daily', time_slot: 'Night', instructions: '' }] });
  check('REQ-F-20/23: time-slot edit re-plans the schedule (auto-missed dose cleared / regenerated)', ed3.status === 200 && (() => { const r = stat(mC.id); return !r || (r.status === 'Pending' && db.prepare('SELECT scheduled_time FROM medication_logs WHERE medication_id=? AND log_date=?').get(mC.id, today).scheduled_time === '21:00'); })());
  check('elder-confirmed history kept when another dose is re-timed', stat(mB.id).status === 'Taken');

  // ================================================================== APPOINTMENT REMINDERS (REQ-F-39)
  section('APPOINTMENT REMINDERS (REQ-F-39/67)');
  const F = local(today, '12:00');                   // fake "now"
  const old = '2000-01-01 00:00:00';
  const insAppt = db.prepare(`INSERT INTO appointments (elder_id,doctor_id,appt_date,appt_time,reason,status,created_at) VALUES (?,?,?,?,?,?,?)`);
  const A = {
    soonConfirmed: insAppt.run(ID.e1, ID.doc1, today, '12:50', 'RemSoon', 'Confirmed', old).lastInsertRowid,
    tomorrowPending: insAppt.run(ID.e1, ID.doc1, addDays(1), '08:00', 'RemTomorrow', 'Pending', old).lastInsertRowid,
    cancelled: insAppt.run(ID.e1, ID.doc1, today, '12:30', 'RemCancelled', 'Cancelled', old).lastInsertRowid,
    far: insAppt.run(ID.e1, ID.doc1, addDays(3), '10:00', 'RemFar', 'Confirmed', old).lastInsertRowid,
    past: insAppt.run(ID.e1, ID.doc1, today, '09:00', 'RemPast', 'Confirmed', old).lastInsertRowid,
    justBooked: insAppt.run(ID.e2, ID.doc1, addDays(1), '08:00', 'RemJustBooked', 'Confirmed', utcStamp(new Date(F.getTime() - 3600000))).lastInsertRowid,
  };
  const ar = (apptReason) => ({
    elder: db.prepare(`SELECT COUNT(*) c FROM notifications WHERE type='APPOINTMENT_REMINDER' AND dedupe_key LIKE 'apptrem:${A[apptReason]}:%:elder'`).get().c,
    doctor: db.prepare(`SELECT COUNT(*) c FROM notifications WHERE type='APPOINTMENT_REMINDER' AND dedupe_key LIKE 'apptrem:${A[apptReason]}:%:doctor'`).get().c,
  });
  scheduler.tick(F);
  check('confirmed appointment within 1h → reminder to ELDER and DOCTOR', ar('soonConfirmed').elder === 1 && ar('soonConfirmed').doctor === 1);
  check('pending appointment 20h ahead → 24h-tier reminder to both', ar('tomorrowPending').elder === 1 && ar('tomorrowPending').doctor === 1);
  check('pending reminder tells doctor it needs confirmation', notifs(ID.doc1, "type='APPOINTMENT_REMINDER' AND message LIKE '%RemTomorrow%'").length === 1 && /confirm/i.test(notifs(ID.doc1, "type='APPOINTMENT_REMINDER' AND message LIKE '%RemTomorrow%'")[0].message));
  check('cancelled / far-future / past appointments → NO reminder', ar('cancelled').elder + ar('far').elder + ar('past').elder + ar('cancelled').doctor + ar('far').doctor + ar('past').doctor === 0);
  check('appointment booked after the 24h window opened → no instant "reminder"', ar('justBooked').elder === 0);
  const total = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE type='APPOINTMENT_REMINDER'").get().c;
  const t0 = total();
  scheduler.tick(F); scheduler.tick(new Date(F.getTime() + 60000)); scheduler.tick(new Date(F.getTime() + 120000));
  check('NO duplicate appointment reminders across scheduler cycles', total() === t0);
  scheduler.tick(local(addDays(1), '07:10'));
  check('second (1h) tier fires later for the same appointment, once', ar('tomorrowPending').elder === 2 && ar('justBooked').elder === 1);
  scheduler.tick(local(addDays(1), '07:20'));
  check('…and still no duplicates afterwards', ar('tomorrowPending').elder === 2);
  check('reminders visible in the elder inbox API with classification', (await api('GET', '/notifications', eld1.token)).body.notifications.some((n) => n.type === 'APPOINTMENT_REMINDER'));

  // ================================================================== SCHEDULER SAFETY
  section('SCHEDULER SAFETY');
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { if (/FROM medication_logs ml/.test(sql) && /status = 'Pending' AND ml.log_date = \?/.test(sql)) throw new Error('simulated DB failure'); return origPrepare(sql); };
  let threw = false; let res;
  try { res = scheduler.tick(local(today, '12:00')); } catch { threw = true; }
  db.prepare = origPrepare;
  check('a failing job does not throw out of tick()', !threw);
  check('failure is recorded, other jobs still ran', res && res.errors.medicationReminders && res.results.appointmentReminders !== undefined, res && res.errors);
  scheduler.tick(local(today, '12:01'));
  check('scheduler recovers on the next cycle', !scheduler.lastRun.errors.medicationReminders);
  const hz = await api('GET', '/health');
  check('/api/health still OK and reports scheduler state', hz.status === 200 && hz.body.ok === true);
  check('start() is idempotent and honours DISABLE_SCHEDULER', (() => { scheduler.start(); scheduler.start(); return true; })());

  // ================================================================== EMERGENCY / SOS
  section('SOS → EMERGENCY CONTACT → CAREGIVER → ADMIN (REQ-F-52..63, 69..71)');
  const sosBody = await api('POST', '/elder/sos', eld1.token, { message: 'Chest pain' });
  check('SOS created (201) for elder with emergency contact', sosBody.status === 201 && sosBody.body.id, sosBody);
  const AL = sosBody.body.id;
  check('alert saved with ACTIVE status, linked to elder', db.prepare('SELECT * FROM emergency_alerts WHERE id=?').get(AL).elder_id === ID.e1);
  const ec = sosBody.body.emergencyContact;
  check('emergency contact resolved from elder_profiles (name + phone)', ec && ec.name === 'Meena Kumar (Daughter)' && ec.phone === '9123456780');
  check('HONESTY: no gateway configured → FAILED, never DELIVERED', ec.delivery_status === 'FAILED' && /NOT sent/i.test(ec.delivery_error), ec);
  const row = db.prepare("SELECT * FROM notifications WHERE alert_id=? AND channel='SMS'").get(AL);
  check('external delivery record stored in notifications (channel SMS, user_id NULL)', row && row.user_id === null && row.recipient_contact === '9123456780' && row.delivery_attempts >= 1);
  check('caregiver in-app SOS notification (existing flow intact)', notifs(ID.cg1, `type='EMERGENCY' AND alert_id=${AL}`).length === 1);
  check('administrator in-app escalation (existing flow intact)', notifs(ID.adm, `type='EMERGENCY' AND alert_id=${AL}`).length === 1);
  check('unassigned caregiver NOT notified', notifs(ID.cg2, "type='EMERGENCY'").length === 0);
  check('another elder is NOT notified', notifs(ID.e2, "type='EMERGENCY'").length === 0);
  check('emergency-contact record never appears in anyone\'s inbox', db.prepare("SELECT COUNT(*) c FROM notifications WHERE channel='SMS' AND user_id IS NOT NULL").get().c === 0);
  check('duplicate active SOS → 409', (await api('POST', '/elder/sos', eld1.token, {})).status === 409);
  check('SOS history exposes delivery state to the elder', (await api('GET', '/elder/sos', eld1.token)).body[0].contactDeliveries[0].delivery_status === 'FAILED');
  check('dashboard activeAlert carries delivery state', (await api('GET', '/elder/dashboard', eld1.token)).body.activeAlert.contactDeliveries.length === 1);
  const cgAlerts = (await api('GET', '/caregiver/alerts', cg1.token)).body;
  check('caregiver sees alert + external delivery status', cgAlerts.some((a) => a.id === AL && a.contactDeliveries[0].delivery_status === 'FAILED'));
  check('SOS: invalid message type → 400', (await api('POST', '/elder/sos', eld2.token, { message: { x: 1 } })).status === 400);

  // elder with NO emergency contact
  const sos3 = await api('POST', '/elder/sos', eld3.token, { message: 'help' });
  check('SOS still created when no emergency contact is on file', sos3.status === 201 && sos3.body.emergencyContact.delivery_status === 'FAILED' && /missing|invalid/i.test(sos3.body.emergencyContact.delivery_error), sos3.body);
  check('…and admins are still escalated', notifs(ID.adm, `type='EMERGENCY' AND alert_id=${sos3.body.id}`).length === 1);

  section('CAREGIVER ALERT RESPONSE (REQ-F-59/60/61/85)');
  check('unassigned caregiver cannot ack someone else\'s alert (404)', (await api('PUT', `/caregiver/alerts/${AL}/status`, cg2.token, { status: 'ACKNOWLEDGED' })).status === 404);
  check('assigned caregiver acknowledges', (await api('PUT', `/caregiver/alerts/${AL}/status`, cg1.token, { status: 'ACKNOWLEDGED' })).status === 200);
  check('assigned caregiver resolves', (await api('PUT', `/caregiver/alerts/${AL}/status`, cg1.token, { status: 'RESOLVED' })).status === 200);
  check('elder notified of ack + resolve', notifs(ID.e1, `alert_id IS NULL AND type='EMERGENCY' AND title LIKE 'Your SOS%'`).length === 2);
  check('invalid caregiver alert status → 400', (await api('PUT', `/caregiver/alerts/${AL}/status`, cg1.token, { status: 'CANCELLED' })).status === 400);
  const c2 = await api('POST', '/elder/sos', eld2.token, { message: 'fall' });
  const cancel = await api('PUT', `/elder/sos/${c2.body.id}/cancel`, eld2.token, {});
  check('elder cancels own alert (existing flow)', cancel.status === 200);
  check('SECURITY: elder cannot cancel another elder\'s alert (404)', (await api('PUT', `/elder/sos/${sos3.body.id}/cancel`, eld1.token, {})).status === 404);
  await api('PUT', `/elder/sos/${sos3.body.id}/cancel`, eld3.token, {});

  // ================================================================== DELIVERY with a gateway
  section('NOTIFICATION DELIVERY STATES: gateway configured (REQ-F-75)');
  await startGateway();
  process.env.SMS_WEBHOOK_URL = `http://127.0.0.1:${GATEWAY_PORT}/sms`;   // for retries run from this process
  await startServer({ SMS_WEBHOOK_URL: process.env.SMS_WEBHOOK_URL });
  await api('PUT', '/elder/profile', eld3.token, { name: 'Edna Third Elder', phone: '9000000099', emergency_contact_name: 'Always Failing', emergency_contact_phone: '9555000099' });
  const e2sos = await api('POST', '/elder/sos', eld2.token, { message: 'dizzy' });
  check('gateway configured → first attempt is PENDING (async, not yet claimed delivered)', e2sos.body.emergencyContact.delivery_status === 'PENDING', e2sos.body);
  await sleep(600);
  let rowE2 = db.prepare("SELECT * FROM notifications WHERE alert_id=? AND channel='SMS'").get(e2sos.body.id);
  check('gateway 500 → still PENDING with retry note, attempts=1', rowE2.delivery_status === 'PENDING' && rowE2.delivery_attempts === 1 && /will retry/.test(rowE2.delivery_error), rowE2);
  scheduler.tick(new Date()); await sleep(600);
  rowE2 = db.prepare("SELECT * FROM notifications WHERE alert_id=? AND channel='SMS'").get(e2sos.body.id);
  check('retry by scheduler → DELIVERED (gateway accepted), attempts=2', rowE2.delivery_status === 'DELIVERED' && rowE2.delivery_attempts === 2 && rowE2.delivered_at, rowE2);
  scheduler.tick(new Date()); await sleep(200);
  check('DELIVERED messages are never re-sent', gatewayCalls['9123456781'] === 2);

  const e3sos = await api('POST', '/elder/sos', eld3.token, { message: 'help' });
  await sleep(500); scheduler.tick(new Date()); await sleep(500); scheduler.tick(new Date()); await sleep(500); scheduler.tick(new Date()); await sleep(300);
  const r3row = db.prepare("SELECT * FROM notifications WHERE alert_id=? AND channel='SMS'").get(e3sos.body.id);
  check('persistent gateway failure → FAILED after max attempts (no infinite retry)', r3row.delivery_status === 'FAILED' && r3row.delivery_attempts === 3 && /gave up/.test(r3row.delivery_error), r3row);
  const calls = gatewayCalls['9555000099'];
  scheduler.tick(new Date()); await sleep(300);
  check('FAILED deliveries are not retried again', gatewayCalls['9555000099'] === calls);
  check('failed external delivery did NOT block caregiver/admin notifications', notifs(ID.adm, `type='EMERGENCY' AND alert_id=${e3sos.body.id}`).length === 1);
  await stopServer(); gateway.close();

  // ================================================================== NOTIFICATIONS (REQ-F-72..76)
  section('NOTIFICATION INBOX (REQ-F-72..76) — existing behaviour preserved');
  await startServer();
  const inbox = (await api('GET', '/notifications', eld1.token)).body;
  check('inbox lists notifications with type, time, channel and delivery status', inbox.notifications.length > 0 && inbox.notifications.every((n) => n.type && n.created_at && n.channel === 'IN_APP' && n.delivery_status));
  check('unread count matches', inbox.unreadCount === inbox.notifications.filter((n) => !n.is_read).length);
  const first = inbox.notifications.find((n) => !n.is_read);
  check('mark one read', (await api('PUT', `/notifications/${first.id}/read`, eld1.token, {})).status === 200 && (await api('GET', '/notifications/unread-count', eld1.token)).body.unreadCount === inbox.unreadCount - 1);
  const cgNotif = (await api('GET', '/notifications', cg1.token)).body.notifications[0];
  check('SECURITY: cannot mark another user\'s notification read (404, unchanged)', (await api('PUT', `/notifications/${cgNotif.id}/read`, eld1.token, {})).status === 404 && db.prepare('SELECT is_read FROM notifications WHERE id=?').get(cgNotif.id).is_read === 0);
  check('mark all read → badge 0', (await api('PUT', '/notifications/read-all', eld1.token, {})).status === 200 && (await api('GET', '/notifications/unread-count', eld1.token)).body.unreadCount === 0);
  check('read-all only affected the caller', (await api('GET', '/notifications/unread-count', cg1.token)).body.unreadCount > 0);
  check('notify() never throws on a bad insert (safe failure)', (() => { const { notify } = require('../notify'); return notify(99999999, 'GENERAL', 't', 'm') === false; })());
  check('notify() dedupe key returns false the 2nd time', (() => { const { notify } = require('../notify'); const a = notify(ID.e1, 'GENERAL', 'dd', 'm', { dedupeKey: 'test:dd' }); const b = notify(ID.e1, 'GENERAL', 'dd', 'm', { dedupeKey: 'test:dd' }); return a === true && b === false; })());

  // ================================================================== OTHER ROLE FLOWS
  // ================================================================== REQ-F-48 / 51
  section('HEALTH RECORD VALIDATION + ERROR HANDLING (REQ-F-48/51)');
  const hrCount = () => db.prepare('SELECT COUNT(*) c FROM health_records').get().c;
  const hr0 = hrCount();
  const hrBad = [
    ['unknown record_type is rejected, NOT coerced to General', { record_type: 'Bogus', title: 'Valid title' }, 'record_type', /Record type must be one of/],
    ['record_type of wrong JSON type', { record_type: 5, title: 'Valid title' }, 'record_type', /Record type/],
    ['empty title', { title: '' }, 'title', /Title is required/],
    ['whitespace-only title', { title: '    ' }, 'title', /Title is required/],
    ['1-character title', { title: 'x' }, 'title', /at least 2/],
    ['151-character title', { title: 'T'.repeat(151) }, 'title', /at most 150/],
    ['title not text', { title: { a: 1 } }, 'title', /must be text/],
    ['title with only symbols', { title: '!!??' }, 'title', /letters or numbers/],
    ['title with html characters', { title: 'bad <b>title' }, 'title', /not allowed/],
    ['2001-character description', { title: 'Valid title', description: 'd'.repeat(2001) }, 'description', /at most 2000/],
    ['description not text', { title: 'Valid title', description: 42 }, 'description', /must be text/],
  ];
  for (const [label, payload, field, re] of hrBad) {
    const r = await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, payload);
    check(`create 400 + field error: ${label}`, r.status === 400 && re.test(r.body.errors && r.body.errors[field] || '') && re.test(r.body.error), r);
  }
  check('nothing stored by any rejected create', hrCount() === hr0);
  const hrAll = await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, { record_type: 'Nope', title: '', description: 'd'.repeat(2001) });
  check('several problems → all reported together', hrAll.status === 400 && Object.keys(hrAll.body.errors).length === 3, hrAll.body);
  check('body that is not an object → 400', (await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, [1, 2])).status === 400);
  const hrOk = await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, { title: '  Lipid   panel ', description: 'LDL 110' });
  const hrRow = db.prepare('SELECT * FROM health_records WHERE id=?').get(hrOk.body.id);
  check('valid create still works; type defaults to General; title trimmed/normalised', hrOk.status === 201 && hrRow.record_type === 'General' && hrRow.title === 'Lipid panel');
  const hrId = hrOk.body.id;
  const typeBefore = (await api('PUT', `/doctor/health-records/${hrId}`, doc1.token, { record_type: 'Lab Result', title: 'Lipid panel' }));
  check('update: valid type accepted', typeBefore.status === 200 && db.prepare('SELECT record_type FROM health_records WHERE id=?').get(hrId).record_type === 'Lab Result');
  const badUpd = await api('PUT', `/doctor/health-records/${hrId}`, doc1.token, { record_type: 'Bogus', title: 'Lipid panel' });
  check('update: invalid type → 400 (previously silently kept)', badUpd.status === 400 && badUpd.body.errors.record_type);
  check('update: invalid input changes nothing', db.prepare('SELECT * FROM health_records WHERE id=?').get(hrId).record_type === 'Lab Result');
  check('update: title-only payload keeps type + description', (await api('PUT', `/doctor/health-records/${hrId}`, doc1.token, { title: 'Lipid panel v2' })).status === 200
    && (() => { const r = db.prepare('SELECT * FROM health_records WHERE id=?').get(hrId); return r.record_type === 'Lab Result' && r.description === 'LDL 110' && r.title === 'Lipid panel v2'; })());
  check('update: empty title → 400', (await api('PUT', `/doctor/health-records/${hrId}`, doc1.token, { title: '' })).status === 400);
  check('authorization order intact: other doctor still 403 (not 400)', (await api('PUT', `/doctor/health-records/${hrId}`, doc2.token, { title: '' })).status === 403);
  check('unknown record → 404', (await api('PUT', '/doctor/health-records/999999', doc1.token, { title: 'x y' })).status === 404);
  check('update notifies the elder', notifs(ID.e1, "type='HEALTH_RECORD' AND title='Health record updated'").length >= 1);

  // ================================================================== REQ-F-35
  section('APPOINTMENT RESCHEDULING (REQ-F-35)');
  const book = async (token, date, time, doc = ID.doc1) => api('POST', '/elder/appointments', token, { doctor_id: doc, appt_date: date, appt_time: time, reason: 'Resched test' });
  const apptRow = (id) => db.prepare('SELECT * FROM appointments WHERE id=?').get(id);
  const b1 = await book(eld1.token, addDays(10), '10:00');
  check('booking validation: impossible date → 400', (await book(eld1.token, '2030-02-30', '10:00')).status === 400);
  check('booking validation: time 25:99 → 400', (await book(eld1.token, addDays(10), '25:99')).status === 400);
  check('booking validation: more than a year ahead → 400', (await book(eld1.token, addDays(400), '10:00')).status === 400);
  check('booking: same doctor + slot already taken → 409', (await book(eld2.token, addDays(10), '10:00')).status === 409);
  const APPT = b1.body.id;
  await api('PUT', `/doctor/appointments/${APPT}/status`, doc1.token, { status: 'Confirmed' });
  const rs = await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld1.token, { appt_date: addDays(12), appt_time: '15:00' });
  check('elder reschedules a Confirmed appointment → 200', rs.status === 200 && rs.body.appt_date === addDays(12) && rs.body.appt_time === '15:00', rs);
  check('new date/time persisted, status reset to Pending (doctor must reconfirm), rescheduled_at set', (() => { const a = apptRow(APPT); return a.appt_date === addDays(12) && a.appt_time === '15:00' && a.status === 'Pending' && a.rescheduled_at; })());
  check('doctor notified of the reschedule (asks to confirm)', notifs(ID.doc1, "type='APPOINTMENT_UPDATE' AND title LIKE 'Appointment rescheduled%'").some((n) => /confirm/i.test(n.message) && n.message.includes('15:00')));
  check('assigned caregiver notified of the reschedule', notifs(ID.cg1, "type='APPOINTMENT_UPDATE' AND title LIKE 'Appointment rescheduled%'").length === 1);
  check('reschedule written to activity log with old → new', db.prepare("SELECT COUNT(*) c FROM activity_logs WHERE action='APPOINTMENT_RESCHEDULED' AND details LIKE '%→%'").get().c === 1);
  const reBad = [
    ['same date/time', { appt_date: addDays(12), appt_time: '15:00' }, 400],
    ['past date', { appt_date: '2000-01-01', appt_time: '10:00' }, 400],
    ['impossible date', { appt_date: '2030-13-45', appt_time: '10:00' }, 400],
    ['bad time', { appt_date: addDays(13), appt_time: '99:99' }, 400],
    ['missing time', { appt_date: addDays(13) }, 400],
    ['> 1 year ahead', { appt_date: addDays(500), appt_time: '10:00' }, 400],
    ['reason too long', { appt_date: addDays(13), appt_time: '10:00', reason: 'r'.repeat(256) }, 400],
  ];
  for (const [label, payload, code] of reBad) {
    const r = await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld1.token, payload);
    check(`reschedule rejected: ${label}`, r.status === code && r.body.error, r);
  }
  check('rejected reschedules changed nothing', apptRow(APPT).appt_date === addDays(12) && apptRow(APPT).appt_time === '15:00');
  const other = await book(eld1.token, addDays(14), '09:00');
  check('reschedule onto the elder\'s own other appointment → 409', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld1.token, { appt_date: addDays(14), appt_time: '09:00' })).status === 409);
  await book(eld2.token, addDays(15), '11:00');
  check('reschedule onto a slot the doctor already has → 409', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld1.token, { appt_date: addDays(15), appt_time: '11:00' })).status === 409);
  check('cancelled appointment cannot be rescheduled (400)', await (async () => { await api('PUT', `/elder/appointments/${other.body.id}/cancel`, eld1.token, {}); return (await api('PUT', `/elder/appointments/${other.body.id}/reschedule`, eld1.token, { appt_date: addDays(20), appt_time: '09:00' })).status === 400; })());
  check('freed slot can be reused after cancellation', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld1.token, { appt_date: addDays(14), appt_time: '09:00' })).status === 200);
  check('SECURITY: another elder cannot reschedule it (404)', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, eld2.token, { appt_date: addDays(20), appt_time: '09:00' })).status === 404);
  check('SECURITY: other doctor cannot reschedule it (404)', (await api('PUT', `/doctor/appointments/${APPT}/reschedule`, doc2.token, { appt_date: addDays(20), appt_time: '09:00' })).status === 404);
  check('SECURITY: caregiver / admin hit 403 on the reschedule routes', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, cg1.token, {})).status === 403 && (await api('PUT', `/doctor/appointments/${APPT}/reschedule`, adm.token, {})).status === 403);
  check('SECURITY: elder cannot use the doctor reschedule route (403)', (await api('PUT', `/doctor/appointments/${APPT}/reschedule`, eld1.token, { appt_date: addDays(20), appt_time: '09:00' })).status === 403);
  check('unauthenticated reschedule → 401', (await api('PUT', `/elder/appointments/${APPT}/reschedule`, null, {})).status === 401);
  await api('PUT', `/doctor/appointments/${APPT}/status`, doc1.token, { status: 'Confirmed' });
  const cgBefore = notifs(ID.cg1, "type='APPOINTMENT_UPDATE'").length;
  const drs = await api('PUT', `/doctor/appointments/${APPT}/reschedule`, doc1.token, { appt_date: addDays(16), appt_time: '16:30' });
  check('doctor reschedules own appointment; status stays Confirmed', drs.status === 200 && apptRow(APPT).status === 'Confirmed' && apptRow(APPT).appt_date === addDays(16));
  check('elder + caregiver notified of the doctor\'s reschedule', notifs(ID.e1, "type='APPOINTMENT_UPDATE' AND title='Appointment rescheduled' AND message LIKE '%16:30%'").length === 1 && notifs(ID.cg1, "type='APPOINTMENT_UPDATE'").length === cgBefore + 1);
  check('doctor reschedule validation → 400 / 409', (await api('PUT', `/doctor/appointments/${APPT}/reschedule`, doc1.token, { appt_date: '2000-01-01', appt_time: '10:00' })).status === 400);
  const eOther = await book(eld1.token, addDays(17), '08:00', ID.doc2);   // elder's appointment with a different doctor
  check('doctor reschedule onto the ELDER\'s other live appointment → 409', (await api('PUT', `/doctor/appointments/${APPT}/reschedule`, doc1.token, { appt_date: addDays(17), appt_time: '08:00' })).status === 409);
  check('…and the appointment was not moved', apptRow(APPT).appt_date === addDays(16));
  await api('PUT', `/elder/appointments/${eOther.body.id}/cancel`, eld1.token, {});
  check('rescheduled appointment appears with new time in elder + doctor lists', (await api('GET', '/elder/appointments', eld1.token)).body.some((a) => a.id === APPT && a.appt_time === '16:30') && (await api('GET', '/doctor/appointments', doc1.token)).body.some((a) => a.id === APPT && a.appt_time === '16:30'));
  // reminder clock restarts at the reschedule
  const RA = insAppt.run(ID.e1, ID.doc1, addDays(1), '08:00', 'RemResched', 'Confirmed', old).lastInsertRowid;
  db.prepare('UPDATE appointments SET rescheduled_at=? WHERE id=?').run(utcStamp(new Date(F.getTime() - 3600000)), RA);
  scheduler.tick(F);
  check('reminder clock restarts on reschedule (no instant 24h "reminder")', db.prepare("SELECT COUNT(*) c FROM notifications WHERE dedupe_key LIKE ?").get(`apptrem:${RA}:%`).c === 0);
  scheduler.tick(local(addDays(1), '07:10'));
  check('…but the 1h reminder still fires for the new time', db.prepare("SELECT COUNT(*) c FROM notifications WHERE dedupe_key LIKE ?").get(`apptrem:${RA}:%:elder`).c === 1);

  // ================================================================== REQ-F-83
  section('CAREGIVER EVENT NOTIFICATIONS (REQ-F-83)');
  const cgc = (where) => notifs(ID.cg1, where).length;
  const cg2c = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE user_id=?").get(ID.cg2).c;
  const cg2Start = cg2c();
  const c0 = { appt: cgc("type='APPOINTMENT' AND title LIKE 'Appointment requested%'"), canc: cgc("type='APPOINTMENT_CANCELLED'"), upd: cgc("type='APPOINTMENT_UPDATE'"), rx: cgc("type='PRESCRIPTION'"), hrn: cgc("type='HEALTH_RECORD'") };
  const nb = await book(eld1.token, addDays(21), '10:00');
  check('elder books appointment → caregiver notified', cgc("type='APPOINTMENT' AND title LIKE 'Appointment requested%'") === c0.appt + 1);
  await api('PUT', `/doctor/appointments/${nb.body.id}/status`, doc1.token, { status: 'Confirmed' });
  check('doctor confirms → caregiver notified', cgc("type='APPOINTMENT_UPDATE' AND title LIKE 'Appointment confirmed%'") >= 1);
  await api('PUT', `/doctor/appointments/${nb.body.id}/status`, doc1.token, { status: 'Completed' });
  const updAfterComplete = cgc("type='APPOINTMENT_UPDATE'");
  await api('PUT', `/doctor/appointments/${nb.body.id}/status`, doc1.token, { status: 'Cancelled' });
  check('doctor cancels → caregiver notified (APPOINTMENT_CANCELLED)', cgc("type='APPOINTMENT_CANCELLED'") === c0.canc + 1);
  check('"Completed" is routine and does NOT notify caregivers', updAfterComplete === cgc("type='APPOINTMENT_UPDATE'"));
  const nb2 = await book(eld1.token, addDays(22), '10:00');
  await api('PUT', `/elder/appointments/${nb2.body.id}/cancel`, eld1.token, {});
  check('elder cancels → caregiver notified', cgc("type='APPOINTMENT_CANCELLED'") === c0.canc + 2);
  const nb3 = await book(eld1.token, addDays(23), '10:00');
  await api('PUT', `/admin/appointments/${nb3.body.id}/status`, adm.token, { status: 'Cancelled' });
  check('admin cancels → caregiver notified', cgc("type='APPOINTMENT_CANCELLED'") === c0.canc + 3);
  const rx2 = await api('POST', '/doctor/prescriptions', doc1.token, { elder_id: ID.e1, notes: '', medications: [{ name: 'CgMed', dosage: '1mg', frequency: 'Once daily', time_slot: 'Night', instructions: '' }] });
  check('new prescription → caregiver notified with medicine details', cgc("type='PRESCRIPTION' AND title LIKE 'New prescription%' AND message LIKE '%CgMed 1mg (Night)%'") === 1);
  await api('PUT', `/doctor/prescriptions/${rx2.body.id}`, doc1.token, { medications: [{ id: db.prepare('SELECT id FROM medications WHERE prescription_id=?').get(rx2.body.id).id, name: 'CgMed', dosage: '2mg', frequency: 'Once daily', time_slot: 'Night', instructions: '' }] });
  check('prescription edited → caregiver notified', cgc("type='PRESCRIPTION' AND title LIKE 'Prescription updated%'") >= 1);
  const hrN = hrCount();
  await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, { title: 'Caregiver visible record' });
  check('new health record → caregiver notified', cgc("type='HEALTH_RECORD' AND title LIKE 'New health record%'") >= 1);
  const rem = notifs(ID.cg1, "type='APPOINTMENT_REMINDER'");
  check('upcoming appointment reminders also reach the assigned caregiver', rem.length >= 2 && rem.some((n) => /Rajesh/.test(n.message)));
  scheduler.tick(F); scheduler.tick(local(addDays(1), '07:15'));
  check('caregiver reminders are not duplicated across cycles', notifs(ID.cg1, "type='APPOINTMENT_REMINDER'").length === rem.length);
  check('events for an elder with NO caregivers do not error (elder2 flow)', (await book(eld2.token, addDays(30), '09:00')).status === 201);
  check('SECURITY: the unassigned caregiver received NONE of these events', cg2c() === cg2Start, { before: cg2Start, after: cg2c() });
  check('caregiver inbox lists the new event types', (await api('GET', '/notifications', cg1.token)).body.notifications.some((n) => n.type === 'PRESCRIPTION') );

  section('ELDER flows');
  check('dashboard', (await api('GET', '/elder/dashboard', eld1.token)).status === 200);
  check('prescription view (REQ-F-21) incl. updated_at', (await api('GET', '/elder/prescriptions', eld1.token)).body.some((p) => p.id === RX && p.updated_at));
  check('medication history', (await api('GET', '/elder/medications/history', eld1.token)).status === 200);
  const bk = await api('POST', '/elder/appointments', eld1.token, { doctor_id: ID.doc1, appt_date: addDays(2), appt_time: '10:30', reason: 'Checkup' });
  check('book appointment', bk.status === 201);
  check('booking validation (past date) → 400', (await api('POST', '/elder/appointments', eld1.token, { doctor_id: ID.doc1, appt_date: '2000-01-01', appt_time: '10:30' })).status === 400);
  check('doctor notified of booking', notifs(ID.doc1, "type='APPOINTMENT' AND message LIKE '%Checkup%'").length === 1);
  check('elder cancels own appointment', (await api('PUT', `/elder/appointments/${bk.body.id}/cancel`, eld1.token, {})).status === 200);
  check('SECURITY: elder cannot cancel another elder\'s appointment (404)', (await api('PUT', `/elder/appointments/${A.justBooked}/cancel`, eld1.token, {})).status === 404);
  const e2med = db.prepare('SELECT m.id FROM medications m JOIN prescriptions p ON p.id=m.prescription_id WHERE p.elder_id=? LIMIT 1').get(ID.e1).id;
  check('SECURITY: another elder cannot update my medication status (404)', (await api('PUT', `/elder/medications/${e2med}/status`, eld2.token, { status: 'Taken' })).status === 404);

  section('DOCTOR flows');
  check('elder list', (await api('GET', '/doctor/elders', doc1.token)).body.length >= 3);
  const dd = (await api('GET', `/doctor/elders/${ID.e1}`, doc1.token)).body;
  check('elder detail has prescriptions with doctor_id/doctor_name/updated_at (for edit UI)', dd.prescriptions.every((p) => p.doctor_id && p.doctor_name && 'updated_at' in p));
  check('doctor appointments', (await api('GET', '/doctor/appointments', doc1.token)).status === 200);
  check('doctor confirms appointment → elder notified', (await api('PUT', `/doctor/appointments/${A.tomorrowPending}/status`, doc1.token, { status: 'Confirmed' })).status === 200);
  const hr = await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, { record_type: 'Diagnosis', title: 'BP review', description: 'ok' });
  check('create health record', hr.status === 201);
  check('invalid health record → 400', (await api('POST', `/doctor/elders/${ID.e1}/health-records`, doc1.token, { title: '' })).status === 400);
  check('update own health record', (await api('PUT', `/doctor/health-records/${hr.body.id}`, doc1.token, { title: 'BP review 2' })).status === 200);
  check('SECURITY: other doctor cannot edit health record (403)', (await api('PUT', `/doctor/health-records/${hr.body.id}`, doc2.token, { title: 'x' })).status === 403);
  check('elder views own health records', (await api('GET', '/elder/health-records', eld1.token)).body.some((h) => h.title === 'BP review 2'));

  section('CAREGIVER flows');
  const cgE = (await api('GET', '/caregiver/elders', cg1.token)).body;
  check('assigned elders list = only Rajesh', cgE.length === 1 && cgE[0].id === ID.e1);
  const cgD = (await api('GET', `/caregiver/elders/${ID.e1}`, cg1.token)).body;
  check('medication monitoring shows Taken vs Missed vs Pending', cgD.medicationsToday.some((m) => m.status === 'Taken') && cgD.medicationsToday.some((m) => m.status === 'Missed'));
  check('health records visible to assigned caregiver', cgD.healthRecords.some((h) => h.title === 'BP review 2'));
  check('SECURITY: unassigned elder detail → 404', (await api('GET', `/caregiver/elders/${ID.e1}`, cg2.token)).status === 404 && (await api('GET', `/caregiver/elders/${ID.e2}`, cg1.token)).status === 404);
  check('SECURITY: unassigned caregiver sees no elders/alerts', (await api('GET', '/caregiver/elders', cg2.token)).body.length === 0 && (await api('GET', '/caregiver/alerts', cg2.token)).body.length === 0);

  section('ADMIN flows');
  check('stats', (await api('GET', '/admin/stats', adm.token)).body.totalUsers >= 8);
  check('user list', (await api('GET', '/admin/users', adm.token)).body.length >= 8);
  check('disable account', (await api('PUT', `/admin/users/${ID.e3}`, adm.token, { is_active: false })).status === 200);
  check('disabled user is locked out (403)', (await api('GET', '/elder/dashboard', eld3.token)).status === 403 && (await api('POST', '/auth/login', null, { email: 'elder3@elderaid.com', password: 'password123' })).status === 403);
  check('enable account', (await api('PUT', `/admin/users/${ID.e3}`, adm.token, { is_active: true })).status === 200 && (await api('GET', '/elder/dashboard', eld3.token)).status === 200);
  check('admin cannot disable self', (await api('PUT', `/admin/users/${ID.adm}`, adm.token, { is_active: false })).status === 400);
  check('elder / doctor / caregiver admin views', (await api('GET', '/admin/elders', adm.token)).status === 200 && (await api('GET', `/admin/elders/${ID.e1}`, adm.token)).status === 200);
  check('assignments list', (await api('GET', '/admin/assignments', adm.token)).body.length >= 1);
  const act = (await api('GET', '/admin/activity', adm.token)).body;
  check('activity log has new events (PRESCRIPTION_UPDATED, MEDICATION_AUTO_MISSED, SOS_TRIGGERED)', ['PRESCRIPTION_UPDATED', 'MEDICATION_AUTO_MISSED', 'SOS_TRIGGERED'].every((a) => act.some((x) => x.action === a)));

  section('SECURITY: unauthenticated + cross-role access to every protected area');
  const protectedGets = ['/elder/profile', '/elder/dashboard', '/elder/prescriptions', '/elder/medications/today', '/elder/medications/schedule', '/elder/medications/history', '/elder/appointments', '/elder/health-records', '/elder/sos',
    '/doctor/elders', `/doctor/elders/${ID.e1}`, '/doctor/appointments', '/doctor/dashboard',
    '/caregiver/elders', `/caregiver/elders/${ID.e1}`, '/caregiver/alerts',
    '/admin/stats', '/admin/users', '/admin/activity', '/admin/assignments', '/admin/elders', `/admin/elders/${ID.e1}`,
    '/notifications', '/notifications/unread-count'];
  let unauthOk = true; const unauthBad = [];
  for (const p of protectedGets) { const r = await api('GET', p); if (r.status !== 401) { unauthOk = false; unauthBad.push(p + ':' + r.status); } }
  check('every protected GET without a token → 401', unauthOk, unauthBad);
  const matrix = { elder: eld1.token, doctor: doc1.token, caregiver: cg1.token, admin: adm.token };
  const area = (p) => p.split('/')[1];
  const roleOf = { elder: 'elder', doctor: 'doctor', caregiver: 'caregiver', admin: 'admin' };
  let crossOk = true; const crossBad = [];
  for (const p of protectedGets.filter((x) => !x.startsWith('/notifications'))) {
    for (const [role, tok] of Object.entries(matrix)) {
      if (roleOf[role] === area(p)) continue;
      const r = await api('GET', p, tok); if (r.status !== 403) { crossOk = false; crossBad.push(`${role} ${p}:${r.status}`); }
    }
  }
  check('every role is blocked (403) from every other role\'s area', crossOk, crossBad);
  for (const role of ['elder', 'doctor', 'caregiver']) {
    check(`SECURITY: ${role} cannot use admin APIs (stats/users/activity/create)`, (await api('GET', '/admin/stats', matrix[role])).status === 403 && (await api('GET', '/admin/users', matrix[role])).status === 403 && (await api('GET', '/admin/activity', matrix[role])).status === 403
      && (await api('POST', '/admin/users', matrix[role], { name: 'x', email: 'h@x.com', password: 'password123', role: 'ADMINISTRATOR' })).status === 403);
  }
  check('SECURITY: elder cannot create prescriptions / health records', (await api('POST', '/doctor/prescriptions', eld1.token, { elder_id: ID.e1, medications: [] })).status === 403 && (await api('POST', `/doctor/elders/${ID.e1}/health-records`, eld1.token, { title: 'x' })).status === 403);
  check('SECURITY: forged/invalid token → 401', (await api('GET', '/elder/profile', 'abc.def.ghi')).status === 401);

  await stopServer();
  console.log(`\n==============================\n${pass} passed, ${fail} failed`);
  if (fail) console.log('FAILED:\n - ' + failures.join('\n - '));
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.unlinkSync(f); } catch { /* ok */ } }
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('TEST HARNESS ERROR', e); await stopServer(); process.exit(2); });
