# ElderAid — Requirements Status (official SRS numbering)

Numbering is **exactly** `REQ-F-01 … REQ-F-100` from the official `SRS_Document.docx`
(01–09 Authentication · 10–17 Elder · 18–30 Prescription & Medication · 31–41 Appointments ·
42–51 Health Records · 52–63 Emergency · 64–76 Notifications · 77–88 Caregiver · 89–100 Administrator).
The earlier, inferred numbering has been discarded.

**Legend** — DONE: implemented end to end (UI → API → DB → response → UI) and exercised by a test ·
PARTIAL: works with a stated limitation · NOT IMPLEMENTED.

## Totals

| Status | Count |
|---|---|
| DONE | **98** |
| PARTIAL | **2** |
| NOT IMPLEMENTED | **0** |

This is **not 100 %**: REQ-F-58 and REQ-F-70 are PARTIAL (see below).

How verified: `cd server && npm test` (255 automated API/security/scheduler checks on a throw-away DB;
passes under TZ=UTC and Asia/Kolkata) plus headless-browser passes (21 + 13 checks) over the profile,
edit-prescription, SOS, notification, reschedule and health-record screens. DONE judgements are the author's reading of the SRS text.

## 1. Authentication

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-01 | Login facility for registered users | DONE | `POST /api/auth/login`, Login page |
| REQ-F-02 | Authenticate with valid credentials | DONE | bcrypt compare + JWT (12 h) |
| REQ-F-03 | Determine role of authenticated user | DONE | role embedded in JWT and returned by login / `GET /api/auth/me` |
| REQ-F-04 | Role-based access for Elder/Doctor/Caregiver/Admin | DONE | `requireRole` on every router; `ProtectedRoute` + role home redirect. Cross-role matrix tested (every role → every other role's GET endpoints = 403) |
| REQ-F-05 | Reject invalid credentials | DONE | 401 on bad password/email; 403 for disabled account. Tested |
| REQ-F-06 | Block unauthorized users from restricted functions | DONE | 401 without token on every protected GET (tested), 403 wrong role, forged token → 401 |
| REQ-F-07 | Logout | DONE | `AuthContext.logout`, Layout "Log out" button (client-side session clear; JWT is stateless) |
| REQ-F-08 | Error message for invalid credentials | DONE | Login page shows server message |
| REQ-F-09 | Maintain account info for authN/authZ | DONE | `users` table (hash, role, is_active); `is_active` re-checked on every request |

## 2. Elder Management

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-10 | Store registered elders' profiles | DONE | `elder_profiles` row created at registration / admin creation |
| REQ-F-11 | Elder views own profile | DONE | `GET /api/elder/profile`, My Profile page |
| REQ-F-12 | Elder updates permitted profile info | DONE | `PUT /api/elder/profile` (always the JWT user; body ids ignored — tested) |
| REQ-F-13 | Validate elder info before storing update | DONE | `validators.validateElderProfile` runs BEFORE any write; the update is one transaction. 21 invalid-input cases tested; DB verified unchanged after rejections |
| REQ-F-14 | Authorized doctors view elders' info | DONE | `GET /api/doctor/elders[/:id]` (role-based: every doctor can see every elder; there is no per-doctor assignment in the SRS) |
| REQ-F-15 | Authorized caregivers view elders' info | DONE | `GET /api/caregiver/elders[/:id]`, assignment-checked |
| REQ-F-16 | Prevent unauthorized viewing of elder info | DONE | unassigned caregiver → 404 (tested); elder/admin/other-role routes → 403 |
| REQ-F-17 | Error message on invalid elder submission | DONE | HTTP 400 `{error, errors{field}}`; ElderProfile shows banner + per-field messages + scrolls to top. Verified in a real browser |

## 3. Prescription & Medication

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-18 | Doctors prescribe medicines | DONE | `POST /api/doctor/prescriptions` (multi-medicine) + form |
| REQ-F-19 | Store prescription with elder and doctor | DONE | `prescriptions.elder_id/doctor_id`, `medications` |
| REQ-F-20 | Doctors modify prescription details | DONE | NEW `PUT /api/doctor/prescriptions/:id` (notes + per-medicine name/dosage/frequency/time/instructions, add medicines). Only the creating doctor (403 otherwise). "Edit prescription" reuses the existing form. Elder notified; activity logged. Tested incl. other doctor / elder / caregiver / admin / unauthenticated |
| REQ-F-21 | Elders access prescription details | DONE | `GET /api/elder/prescriptions`, Prescriptions page (shows "edited") |
| REQ-F-22 | Maintain medicine name, dosage, frequency, medication time | DONE | `medications.name/dosage/frequency/time_slot` |
| REQ-F-23 | Auto-generate medication schedule from prescription | DONE | NEW `schedule.js`: occurrences (`medication_logs` rows with `scheduled_time`) generated from time slot + frequency (daily / alternate-day / weekly / as-needed = none). Generated on prescribe/edit, by the scheduler, and lazily on read. Elder sees today + 7-day schedule. Limits: see Remaining gaps |
| REQ-F-24 | Elders access medication schedule | DONE | `GET /api/elder/medications/today` and NEW `/medications/schedule`; dashboard + Prescriptions page |
| REQ-F-25 | Elders confirm medicine taken | DONE | `PUT /api/elder/medications/:id/status` |
| REQ-F-26 | Record confirmation status and time | DONE | `medication_logs.status` + `updated_at`; UI shows "Confirmed taken at …" |
| REQ-F-27 | Taking/missing status | DONE | Taken / Missed / Pending; Missed is set manually by the elder OR automatically (`auto_missed` flag) |
| REQ-F-28 | Notification when medication is missed | DONE | Manual Missed and automatic Missed both notify assigned caregivers (de-duplicated); automatic also notifies the elder |
| REQ-F-29 | Limit prescription/medication access to authorized persons | DONE | elder = own only (404 otherwise, tested); doctor/admin by role; caregiver assigned elders only; edit = creating doctor only |
| REQ-F-30 | Error message for invalid prescription/medication info | DONE | shared validators on create and edit (400 + specific message); shown inside the form (page no longer replaced by the error). Verified in browser |

## 4. Appointments

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-31 | Elders make/schedule appointments | DONE | `POST /api/elder/appointments` |
| REQ-F-32 | Save elder, doctor, date, time, status | DONE | `appointments` table |
| REQ-F-33 | Elders see their appointments | DONE | `GET /api/elder/appointments` |
| REQ-F-34 | Doctors see their appointments | DONE | `GET /api/doctor/appointments` |
| REQ-F-35 | Authorized users modify appointment information | DONE | NEW reschedule: elder `PUT /api/elder/appointments/:id/reschedule` (Confirmed → back to Pending so the doctor reconfirms) and doctor `PUT /api/doctor/appointments/:id/reschedule` (status kept). Validates real date/time, future only, ≤ 1 year ahead, reason ≤ 255, rejects "same as current", and 409 on a clash for the elder OR the doctor. Only the owning elder / owning doctor (others 404, caregiver/admin 403). Notifies the other party + caregivers, logged old → new. Reminder clock restarts on reschedule (`rescheduled_at`). Reschedule buttons + inline form on both appointment pages. Status changes and cancellation remain |
| REQ-F-36 | Authorized users cancel appointments | DONE | elder, doctor and admin cancel paths |
| REQ-F-37 | Track current appointment status | DONE | Pending/Confirmed/Cancelled/Completed with CHECK constraint |
| REQ-F-38 | Inform relevant users on create/modify/cancel | DONE | booking → doctor; confirm/complete/cancel → elder; elder cancel → doctor; admin override → both |
| REQ-F-39 | Send appointment reminders | DONE | NEW scheduler job: reminders 24 h and 1 h before to elder AND doctor (`APPOINTMENT_REMINDER`); Pending appointments also prompt the doctor to confirm; not for cancelled/past/far-future; de-duplicated by `dedupe_key`. Tested with injected clock |
| REQ-F-40 | Prevent unauthorized appointment modification | DONE | doctor only own appointments, elder only own (404 otherwise, tested), admin route role-guarded |
| REQ-F-41 | Error message for invalid appointment info | DONE | 400 messages (missing fields, bad format, past date, double booking) shown in UI |

## 5. Health Records

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-42 | Maintain elders' health records | DONE | `health_records` |
| REQ-F-43 | Match each record to its elder | DONE | `elder_id` FK |
| REQ-F-44 | Physicians create health records | DONE | `POST /api/doctor/elders/:id/health-records` |
| REQ-F-45 | Physicians update health records | DONE | `PUT /api/doctor/health-records/:id` |
| REQ-F-46 | Elders view their health records | DONE | `GET /api/elder/health-records` |
| REQ-F-47 | Physicians view elders' health records | DONE | embedded in `GET /api/doctor/elders/:id` |
| REQ-F-48 | Validate health record info before store/update | DONE | NEW `validateHealthRecord` runs before any write on create and update: title required, 2–150 chars, text only, must contain a letter/number, no control/HTML characters; description ≤ 2000; `record_type` must be one of the 6 types (invalid is now a 400 — no more silent coercion to "General"; defaults to General only when omitted on create; omitted on update keeps the current value). Authorization order unchanged (404 → 403 → 400). Tested with 11 invalid cases + nothing stored |
| REQ-F-49 | Only authorized users access health records | DONE | elder own; doctors; assigned caregivers read-only; admin elder view |
| REQ-F-50 | Prevent unauthorized health-record updates | DONE | only the authoring doctor (other doctor → 403, tested) |
| REQ-F-51 | Error message for invalid health record | DONE | HTTP 400 `{error, errors{field}}`; the doctor form shows a banner, per-field messages, outlined fields and a live character counter, and no longer wipes the page. All problems are reported together. Verified in a real browser |

## 6. Emergency

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-52 | Emergency SOS for elders | DONE | `SosPanel`, `POST /api/elder/sos` |
| REQ-F-53 | Ask for confirmation before alert | DONE | confirmation modal |
| REQ-F-54 | Generate and save alert on confirmation | DONE | `emergency_alerts` row, ACTIVE |
| REQ-F-55 | Connect alert to the elder | DONE | `elder_id` |
| REQ-F-56 | Save alert time and status | DONE | `created_at`, `updated_at`, `status` |
| REQ-F-57 | Determine elder's emergency contacts | DONE | read from existing `elder_profiles.emergency_contact_name/phone` (no duplicate fields); a missing contact is recorded explicitly as a FAILED delivery |
| REQ-F-58 | Notify emergency contacts on alert | PARTIAL | An emergency-contact notification record is created and a delivery attempt made through a gateway abstraction (`delivery.js`, optional `SMS_WEBHOOK_URL`). No SMS/e-mail service ships with the project, so by default the status is FAILED ("message was NOT sent") and the UI says so; DELIVERED only if a real gateway returns 2xx (tested against a mock gateway only) |
| REQ-F-59 | Notify the proper caregiver | DONE | assigned, active caregivers only (tested) |
| REQ-F-60 | Authorized users access alert info | DONE | elder own; assigned caregivers; admins receive in-app escalation |
| REQ-F-61 | Authorized users change alert status | DONE | caregiver acknowledge/resolve, elder cancel; unassigned caregiver → 404 |
| REQ-F-62 | Protect alert info from unauthorized users | DONE | assignment/ownership checks (tested) |
| REQ-F-63 | Error message if alert cannot be generated | DONE | 409 duplicate and 500 with "call your emergency contact directly" message; shown in SosPanel |

## 7. Notifications

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-64 | Medication reminders per schedule | DONE | NEW scheduler job `medicationReminders`: `MEDICATION_REMINDER` 15 min before each scheduled dose (configurable) |
| REQ-F-65 | Alert elder about upcoming medication | DONE | same notification, addressed to the elder, shown in inbox + bell badge |
| REQ-F-66 | Missed-medication alert if not confirmed in period | DONE | NEW `autoMissedMedication`: unconfirmed dose + 30 min grace (configurable) → status Missed (`auto_missed=1`), caregivers + elder notified once. Never sets Taken; Taken is never overwritten. Tested |
| REQ-F-67 | Reminders about scheduled appointments | DONE | see REQ-F-39 |
| REQ-F-68 | Notifications for appointment create/update/cancel | DONE | see REQ-F-38 |
| REQ-F-69 | Emergency alerts on SOS creation | DONE | caregivers + admins in-app, plus emergency-contact record |
| REQ-F-70 | Send emergency alerts to pre-designated emergency contacts | PARTIAL | see REQ-F-58 — attempted and tracked, but not actually deliverable without a configured gateway |
| REQ-F-71 | Emergency alerts to associated caregivers | DONE | in-app `EMERGENCY` notification |
| REQ-F-72 | Keep notification type, recipient, timing, status | DONE | `notifications`: type, user_id / recipient_name+contact, created_at, is_read, delivery_status/attempts/error/delivered_at, channel |
| REQ-F-73 | Authorized users see their notifications | DONE | `/notifications` inbox, bell badge |
| REQ-F-74 | Classify notification types | DONE | 10 types incl. MEDICATION_REMINDER, MISSED_MEDICATION, APPOINTMENT_*, EMERGENCY; labelled in UI |
| REQ-F-75 | Handle notification delivery failure | DONE | PENDING/DELIVERED/FAILED states; in-app `notify()` never throws and logs failures; external deliveries retried (max 3) then FAILED; failures don't block the alert or other recipients; all tested |
| REQ-F-76 | Prevent access to another user's notifications | DONE | queries scoped by `user_id`; emergency-contact rows have NULL user_id; cross-user mark-read → 404 (tested) |

## 8. Caregiver

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-77 | Caregiver login | DONE | JWT login, role CAREGIVER |
| REQ-F-78 | Associate caregivers with assigned elders | DONE | `caregiver_elders`; admin assignments page |
| REQ-F-79 | Caregivers view elder details | DONE | `GET /api/caregiver/elders/:id` |
| REQ-F-80 | Caregivers view medicine status | DONE | today's scheduled doses + 7-day history |
| REQ-F-81 | Distinguish taken vs not taken | DONE | Taken / Missed / Pending badges and counts (tested) |
| REQ-F-82 | Caregivers view health information | DONE | profile + health records (read-only) |
| REQ-F-83 | Notify caregivers of important events | DONE | Assigned caregivers (and only them — tested against an unassigned caregiver) are now notified of: missed medication (manual + automatic), SOS and SOS cancel, new appointment request, appointment confirmed / cancelled (by elder, doctor or admin), appointment rescheduled, upcoming-appointment reminders, new prescription (with medicine details), prescription edited, health record added / updated. Routine "Completed" is deliberately not sent |
| REQ-F-84 | Notify caregivers on elder emergency alert | DONE | see REQ-F-59/71 |
| REQ-F-85 | Caregivers view emergency alert info | DONE | Emergency alerts page incl. contact + external delivery status |
| REQ-F-86 | Caregivers view notifications for assigned elders | DONE | shared inbox; notifications are generated for assigned elders only |
| REQ-F-87 | Prevent viewing unauthorized elders | DONE | 404 for unassigned (tested) |
| REQ-F-88 | Error message when caregiver info cannot be retrieved | DONE | caregiver pages render API error banners |

## 9. Administrator

| Req | Requirement (SRS) | Status | Implementation / evidence |
|---|---|---|---|
| REQ-F-89 | Admin dashboard | DONE | `/admin`, `GET /api/admin/stats` |
| REQ-F-90 | View registered accounts | DONE | Users page |
| REQ-F-91 | Manage Elder accounts | DONE | create/edit/enable/disable + Elders pages |
| REQ-F-92 | Manage Doctor accounts | DONE | create/edit/enable/disable (Users page) |
| REQ-F-93 | Manage Caregiver accounts | DONE | create/edit/enable/disable + assignments |
| REQ-F-94 | Update permissible user information | DONE | `PUT /api/admin/users/:id` |
| REQ-F-95 | Enable/disable accounts | DONE | `is_active`; disabled users locked out immediately (tested) |
| REQ-F-96 | Limit admin functions to administrators | DONE | `requireRole(ADMINISTRATOR)`; elder/doctor/caregiver → 403 (tested) |
| REQ-F-97 | View system activity | DONE | Activity log page (now also records prescription edits, auto-missed doses, SOS delivery) |
| REQ-F-98 | Validate admin activities before changes | DONE | duplicate email, invalid role, cannot disable/demote self, duplicate assignment |
| REQ-F-99 | Success message after admin activity | DONE | success banners on Users / Assignments / Elder detail |
| REQ-F-100 | Error message on failed admin activity | DONE | error banners from API messages |

## Remaining gaps (why the 2 PARTIALs are partial)

1. **REQ-F-58 / 70 – emergency contact delivery.** No SMS/e-mail provider is bundled and none is faked. Without
   `SMS_WEBHOOK_URL` the contact notification is recorded as FAILED with the reason, and the elder/caregiver UI says
   "No text message was sent — call this person". The webhook path (PENDING → DELIVERED / retry → FAILED) was tested only
   against a local mock gateway, not a real SMS provider. This is a deliberate, honest design decision, not a bug.

Known limitations of items marked DONE (not SRS violations, but worth knowing):
- Reschedule is available to the elder and the doctor (the administrator can still override status/cancel, but not move a time).
- Schedule has no course length / end date and no "discontinue medicine" action; edits cannot delete a medicine (history is preserved on purpose).
- "Twice daily" is modelled as one row per time of day (existing design); frequency text is only interpreted as daily / alternate-day / weekly / as-needed.
- Scheduler runs inside the API process (every 60 s); reminders pause if the server is stopped and catch up on restart (overdue doses are marked Missed, caregivers are alerted only for doses overdue < 24 h).
- All schedule times use the **server's local time zone** — set `TZ` (e.g. `TZ=Asia/Kolkata`) on the host.
