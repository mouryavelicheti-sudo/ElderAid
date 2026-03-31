# ElderAid — Neighborhood Elder Check-In System

Review 1 build (~40% scope). React + Node/Express + SQLite.

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

## Deferred to next review

Emergency/SOS alerts, real SMS/notifications, advanced caregiver monitoring, advanced admin reporting, health-record management beyond profile notes, voice features.
