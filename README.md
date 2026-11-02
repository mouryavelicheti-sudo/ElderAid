# ElderAid — Neighborhood Elder Check-In System

Review 2 build (~75% scope). React + Node/Express + SQLite.

## Structure

```
elderaid/
  server/   Node/Express API + SQLite database
  client/   React (Vite) frontend
```

## Run it

**1. Backend**
```bash
cd server
npm install
npm run seed     # creates elderaid.db with demo accounts + sample data
npm start         # runs on http://localhost:4000
```

**2. Frontend** (separate terminal)
```bash
cd client
npm install
npm run dev       # runs on http://localhost:5173, proxies /api to :4000
```

Open http://localhost:5173

## Demo accounts (password: `password123`)

| Role | Email | Notes |
|---|---|---|
| Elder | elder@elderaid.com | Has a prescription, 3 today's-meds, 1 appointment |
| Elder | elder2@elderaid.com | Empty — good for testing empty states |
| Doctor | doctor@elderaid.com | Dr. Ananya Rao, General Medicine |
| Caregiver | caregiver@elderaid.com | Assigned to elder@elderaid.com |
| Administrator | admin@elderaid.com | |

## Demo flow (matches Review 1 workflow)

1. Log in as **elder@elderaid.com** → dashboard shows today's medication check-in ribbon → mark a medicine Taken → refresh page → status persists → book an appointment.
2. Log out, log in as **doctor@elderaid.com** → My Elders → open an elder → write a new prescription → view Appointments → Confirm the elder's pending appointment.
3. Log in as **elder@elderaid.com** again → appointment now shows Confirmed.
4. Log in as **caregiver@elderaid.com** → see assigned elder's medication/appointment status (read-only).
5. Log in as **admin@elderaid.com** → see system stats and user list.
6. Try opening `/doctor` while logged in as an Elder → redirected to Unauthorized.

## What's implemented (Review 1 scope)

- JWT auth, 4 roles, protected routes, role-based redirect, unauthorized-access blocking
- Elder: profile view/edit, dashboard, prescriptions view, medication check-in (Taken/Missed, persists), appointment booking + history
- Doctor: dashboard, elder list, elder detail, prescription creation (multi-medicine), appointment management (Confirm/Cancel/Complete)
- Caregiver: dashboard showing assigned elder's meds + next appointment
- Administrator: dashboard with system stats + user list
- SQLite database, all workflows backed by real read/write (no hardcoded fake data)

## Added in Review 2 (~75% scope)

- **Health records**: doctors create/update health records per elder (typed: Diagnosis, Lab Result, Vital Signs, …); elders view their own; caregivers view permitted records of assigned elders
- **Emergency / SOS**: SOS button + confirmation dialog on the elder dashboard; alerts stored in `emergency_alerts` (ACTIVE → ACKNOWLEDGED → RESOLVED / CANCELLED); caregivers acknowledge/resolve alerts for assigned elders with emergency-contact details shown; elders can cancel a false alarm
- **In-app notifications**: notification bell with unread badge in the navbar, notifications inbox with read/unread + mark-as-read; triggered by missed medication, appointment booking/confirmation/cancellation/completion, new prescriptions, new health records, and SOS events
- **Medication management**: 30-day medication history for elders, missed-medication notifications to caregivers, per-day Taken/Missed/Pending counts on the caregiver dashboard
- **Appointments**: past-date and duplicate-slot validation, elders can cancel their own Pending/Confirmed appointments, status-change notifications to both parties
- **Caregiver monitoring**: elder detail page (today's meds, 7-day history, upcoming appointments, health records, alerts), emergency alerts page, active-alert banners — all restricted to assigned elders only
- **Administrator**: extended stats (SOS, health records, med adherence, disabled accounts), system activity log, caregiver↔elder care-team assignment management
- All new backend routes enforce the existing JWT auth, role checks, and resource-level authorization (caregivers can only reach assigned elders; doctors can only edit their own records)

## Still deferred (future reviews)

Real SMS/email/push notifications, automatic missed-medication detection (currently manual check-in), advanced admin reporting/analytics, voice features, mobile app, wearables integration.

## Review 3 additions: scheduler, reminders, emergency-contact delivery

A lightweight scheduler runs **inside the API process** (no extra services, no new dependencies). Every 60 s it:
generates today's scheduled doses from prescriptions, sends medication reminders, marks overdue unconfirmed doses
**Missed** (never Taken) and alerts caregivers, sends appointment reminders (24 h and 1 h before), and retries pending
external deliveries. Reminders are de-duplicated with a unique `notifications.dedupe_key`.

The database migrates itself on first start (additive; the `notifications` table is rebuilt once, keeping all rows).

**Time zone:** schedule times use the server's local time. Run with e.g. `TZ=Asia/Kolkata npm start`.

| Env var | Default | Meaning |
|---|---|---|
| `SCHEDULER_TICK_SECONDS` | 60 | scheduler interval |
| `MED_REMINDER_LEAD_MINUTES` | 15 | reminder this long before a dose |
| `MED_MISSED_GRACE_MINUTES` | 30 | dose is auto-Missed this long after its time |
| `SLOT_MORNING/AFTERNOON/EVENING/NIGHT` | 08:00 / 13:00 / 18:00 / 21:00 | dose time per slot |
| `APPT_REMINDER_HOURS_1` / `_2` | 24 / 1 | appointment reminder windows (fractions allowed, e.g. `0.1`) |
| `DISABLE_SCHEDULER` | – | set to `1` to turn the scheduler off |
| `SMS_WEBHOOK_URL` (+ optional `SMS_WEBHOOK_TOKEN`) | unset | HTTPS endpoint receiving `{to, message, notificationId}` for emergency-contact SMS |

**Emergency-contact messages:** ElderAid ships no SMS/e-mail service. Without `SMS_WEBHOOK_URL` the contact notification is
stored with status `FAILED` and the UI states that nothing was sent. With a gateway it goes `PENDING → DELIVERED`
(gateway returned 2xx) or is retried up to 3 times, then `FAILED`.

**Tests:** `cd server && npm test` (spawns the real server on a temporary database).

### Appointment rescheduling (REQ-F-35)
Elders and doctors can move a Pending/Confirmed appointment (`PUT /api/elder|doctor/appointments/:id/reschedule`).
A rescheduled Confirmed appointment returns to Pending when the elder moves it. Booking now also rejects impossible
dates/times, slots more than a year ahead, and double-booking of the elder or the doctor.
