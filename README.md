# ElderAid — Neighborhood Elder Check-In System

**Review 2 — Completed Build**

A full-stack elder-care management system developed using **React, Node.js, Express.js, and SQLite**. ElderAid provides a centralized platform for elderly people, doctors, caregivers, and administrators to manage healthcare activities, medication check-ins, appointments, health records, emergency alerts, and notifications.

---

## 1. Project Overview

ElderAid is designed to improve elderly healthcare management through a role-based web application.

The system connects four types of users:

- **Elder:** Manages personal health information, medications, and appointments.
- **Doctor:** Manages assigned elders, prescriptions, appointments, and health records.
- **Caregiver:** Monitors assigned elders, medication status, appointments, and emergency alerts.
- **Administrator:** Manages users, care-team assignments, system statistics, and activity logs.

The application uses a centralized SQLite database to maintain persistent records and support real-time interactions between different user roles.

## 2. Technology Stack

| Component | Technology |
|---|---|
| Frontend | React 19 |
| Frontend build tool | Vite |
| Backend | Node.js |
| Backend framework | Express.js |
| Database | SQLite |
| Database library | better-sqlite3 |
| Authentication | JSON Web Token (JWT) |
| Password hashing | bcryptjs |
| API communication | REST API |
| Styling | CSS |

## 3. Project Structure

```text
ElderAid/
│
├── client/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── context/
│   │   ├── pages/
│   │   │   ├── admin/
│   │   │   ├── caregiver/
│   │   │   ├── doctor/
│   │   │   └── elder/
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
│
├── server/
│   ├── middleware/
│   ├── routes/
│   ├── tests/
│   ├── appointments.js
│   ├── db.js
│   ├── delivery.js
│   ├── index.js
│   ├── notify.js
│   ├── package.json
│   ├── schedule.js
│   ├── scheduler.js
│   ├── seed.js
│   └── validators.js
│
├── Dockerfile
├── .dockerignore
├── .gitignore
├── index.html
├── package-lock.json
└── README.md
```

## 4. Installation and Setup

### Prerequisites

Install the following:

- Node.js
- npm
- Git
- Visual Studio Code (recommended)

### Step 1: Clone the repository

```bash
git clone https://github.com/mouryavelicheti-sudo/ElderAid.git
cd ElderAid
```

### Step 2: Start the Backend

Open a terminal:

```bash
cd server
npm install
```

Initialize the database with demo accounts and sample data:

```bash
npm run seed
```

Start the backend server:

```bash
npm start
```

Backend URL:

http://localhost:4000

### Step 3: Start the Frontend

Open a second terminal:

```bash
cd client
npm install
npm run dev
```

Frontend URL:

http://localhost:5173

The frontend uses the Vite development server to proxy API requests to the backend on port 4000.

Open the application:

http://localhost:5173

## 5. Demo Accounts

All demo accounts use the password:

`password123`

| Role | Email | Description |
|---|---|---|
| Elder | elder@elderaid.com | Has prescription, medication schedules, and appointment |
| Elder | elder2@elderaid.com | Empty account for testing empty states |
| Doctor | doctor@elderaid.com | Dr. Ananya Rao, General Medicine |
| Caregiver | caregiver@elderaid.com | Assigned to the first elder |
| Administrator | admin@elderaid.com | Administrative access |

**Note:** These are sample credentials for local demonstration only. Do not use them in a production deployment.

## 6. Core Features — Review 1

### 6.1 Authentication and Authorization

- JWT-based authentication.
- Four user roles.
- Protected frontend routes.
- Role-based dashboard redirection.
- Unauthorized-access prevention.
- Password hashing using bcryptjs.

### 6.2 Elder Module

- View and update personal profile.
- View prescriptions.
- View medication schedules.
- Mark medications as Taken or Missed.
- Persistent medication check-in status.
- Book appointments.
- View appointment history.

### 6.3 Doctor Module

- Doctor dashboard.
- View assigned elders.
- Access individual elder details.
- Create prescriptions containing multiple medicines.
- Manage appointments.
- Confirm, cancel, and complete appointments.

### 6.4 Caregiver Module

- View assigned elders.
- Monitor medication status.
- View upcoming appointments.
- Access permitted elder information.

### 6.5 Administrator Module

- View system statistics.
- View registered users.
- Access administrative information.

## 7. Review 2 — Completed Features

The following features extend the core Review 1 functionality.

### 7.1 Health Records Management

- Doctors can create and update health records for elders.
- Health records support different types:
  - Diagnosis
  - Laboratory Results
  - Vital Signs
  - Other medical records
- Elders can view their own health records.
- Caregivers can view permitted health records of their assigned elders.

### 7.2 Emergency and SOS Management

- SOS emergency button on the elder dashboard.
- Emergency confirmation dialog.
- Emergency alerts stored in the database.
- Emergency alert status management:
  - ACTIVE
  - ACKNOWLEDGED
  - RESOLVED
  - CANCELLED
- Caregivers can acknowledge and resolve alerts for assigned elders.
- Emergency-contact information is displayed during alert handling.
- Elders can cancel false alarms.

### 7.3 In-App Notification System

- Notification bell in the navigation bar.
- Unread notification count.
- Notifications inbox.
- Read and unread notification status.
- Mark-as-read functionality.

Notifications are triggered by:

- Missed medication events.
- Appointment booking.
- Appointment confirmation.
- Appointment cancellation.
- Appointment completion.
- New prescriptions.
- New health records.
- SOS emergency events.

### 7.4 Medication Management

- Medication history for the previous 30 days.
- Taken, Missed, and Pending medication statuses.
- Missed-medication notifications for caregivers.
- Daily medication counts on the caregiver dashboard.
- Persistent medication check-in records.

### 7.5 Appointment Management

- Appointment booking with validation.
- Prevention of past-date bookings.
- Duplicate-slot validation.
- Elders can cancel their own Pending or Confirmed appointments.
- Appointment status tracking.
- Notifications for appointment status changes.

### 7.6 Caregiver Monitoring

- Individual elder detail page.
- Today's medication status.
- Seven-day medication history.
- Upcoming appointments.
- Health records.
- Emergency alerts.
- Active emergency-alert banners.
- Access restricted to assigned elders.

### 7.7 Extended Administrator Features

- Extended system statistics.
- SOS alert statistics.
- Health-record statistics.
- Medication adherence statistics.
- Disabled-account statistics.
- System activity log.
- Caregiver-to-elder assignment management.

### 7.8 Backend Security and Resource Authorization

All protected backend routes enforce authentication and appropriate authorization.

Security measures include:

- JWT authentication.
- Role-based access control.
- Resource-level authorization.
- Caregiver access restricted to assigned elders.
- Doctors restricted to records they are authorized to manage.
- Validation of incoming requests.

## 8. Database Management

ElderAid uses SQLite for persistent storage.

The database supports:

- User accounts and roles.
- Elder profiles.
- Doctor profiles.
- Caregiver assignments.
- Prescriptions.
- Medications.
- Medication occurrences and check-in records.
- Appointments.
- Health records.
- Emergency alerts.
- Notifications.
- System activity logs.

The database is initialized through the backend database module.

To create the sample database and demo data:

```bash
cd server
npm run seed
```

The SQLite database is generated locally and is excluded from Git tracking. Each developer can initialize their own database using the seed script.

## 9. Application Demonstration Workflow

The following workflow demonstrates the major features of ElderAid.

### Step 1: Elder Login

Login using:

`elder@elderaid.com`

Demonstrate:

1. Elder dashboard.
2. Today's medication check-in ribbon.
3. Mark a medication as Taken.
4. Refresh the page and verify that the status persists.
5. Book an appointment.
6. View health records.
7. Trigger an SOS alert.
8. View notifications.

### Step 2: Doctor Login

Login using:

`doctor@elderaid.com`

Demonstrate:

1. Doctor dashboard.
2. My Elders section.
3. Open an elder's details.
4. Create a new prescription.
5. Add health records.
6. Open appointments.
7. Confirm or manage a pending appointment.

### Step 3: Verify Elder Updates

Login again using:

`elder@elderaid.com`

Demonstrate:

1. View the updated prescription.
2. Check the health records.
3. Verify the appointment status.
4. View related notifications.

### Step 4: Caregiver Login

Login using:

`caregiver@elderaid.com`

Demonstrate:

1. Caregiver dashboard.
2. Assigned elder information.
3. Medication status and history.
4. Upcoming appointments.
5. Health records.
6. Emergency alerts.
7. Acknowledge or resolve an active SOS alert.

### Step 5: Administrator Login

Login using:

`admin@elderaid.com`

Demonstrate:

1. Administrator dashboard.
2. System statistics.
3. Registered user list.
4. System activity log.
5. Caregiver-to-elder assignments.

### Step 6: Authorization Testing

While logged in as an Elder, attempt to access:

```text
/doctor
```

The application should redirect the user to the Unauthorized page because the Elder role does not have Doctor access.

## 10. Testing and Quality Assurance

The application includes backend tests.

Run the test suite:

```bash
cd server
npm test
```

The tests are designed to start the real backend against a temporary database.

Important testing areas include:

- Authentication and login.
- Role-based access restrictions.
- Medication check-in persistence.
- Prescription management.
- Appointment operations.
- Health-record access.
- Emergency alert handling.
- Notification generation.
- Caregiver resource authorization.

## 11. Future Enhancements

The following capabilities are possible future extensions of ElderAid:

- Real SMS, email, and push notification integrations.
- Advanced administrative reporting and analytics.
- Voice-based interaction.
- Dedicated Android and iOS applications.
- Wearable-device integration.
- Integration with external healthcare systems.
- Advanced health monitoring and reporting.

## 12. Limitations

- External SMS delivery requires an appropriately configured gateway.
- Email and push notification services are not included as built-in services.
- The current application is a web-based system.
- Medication check-in and missed-dose handling depend on the implemented application workflows.

## 13. Expected Outcomes

ElderAid provides a centralized platform for managing elderly healthcare activities.

The completed Review 2 implementation brings together:

- Role-based healthcare management.
- Medication tracking.
- Appointment management.
- Health-record management.
- Emergency alert handling.
- In-app notifications.
- Caregiver monitoring.
- Administrative management.

The system aims to improve communication, monitoring, and coordination between elders, doctors, caregivers, and administrators.

---

## 14. Repository

**GitHub Repository:**

https://github.com/mouryavelicheti-sudo/ElderAid

**Project:** ElderAid — Neighborhood Elder Check-In System

**Development Stack:** React, Node.js, Express.js, SQLite

**Project Status:** Review 2 Completed Build
