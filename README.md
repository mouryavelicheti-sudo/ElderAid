# ElderAid — Neighborhood Elder Check-In System

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

# ElderAid

ElderAid is a web-based healthcare assistance system designed to support
elderly people and provide a common platform for elders, doctors, caregivers,
and administrators.

The project is being developed as a group project by two members. The current
version focuses on the basic system structure, authentication, role-based
dashboards, database connectivity, and initial healthcare functions.

---

## Project Objective

The main objective of ElderAid is to provide a simple and easy-to-use
healthcare assistance platform for elderly users.

The system provides different functionalities based on the user's role.
Elders can access their healthcare information, doctors can manage elder
related information and prescriptions, caregivers can monitor assigned
elders, and administrators can manage basic system information.

---

## User Roles

The system contains four main types of users:

- Elder
- Doctor
- Caregiver
- Administrator

Each user has access to different functionalities according to their role.

---

## Technologies Used

### Frontend

- React.js
- Vite
- JavaScript
- CSS

### Backend

- Node.js
- Express.js
- REST API

### Database

- SQLite
- better-sqlite3

### Authentication

- JWT
- bcryptjs

---

## System Architecture

ElderAid follows a three-layer architecture:

1. Frontend
2. Backend
3. Database

```text
Users
   |
   v
React + Vite Frontend
   |
   | API Requests
   v
Node.js + Express Backend
   |
   | Database Operations
   v
SQLite Database
