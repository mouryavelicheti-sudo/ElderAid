const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/elder', require('./routes/elder.routes'));
app.use('/api/doctor', require('./routes/doctor.routes'));
app.use('/api/caregiver', require('./routes/caregiver.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/notifications', require('./routes/notification.routes'));

const scheduler = require('./scheduler');
app.get('/api/health', (req, res) => res.json({
  ok: true,
  scheduler: { lastRun: scheduler.lastRun.at, failingJobs: Object.keys(scheduler.lastRun.errors) },
}));

// Optional: serve the built React client (production/preview mode).
// In development the Vite dev server is used instead and this folder won't exist.
const path = require('path');
const fs = require('fs');
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4000;
// A stray rejected promise must never take the API down (e.g. an external delivery attempt).
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

app.listen(PORT, () => {
  console.log(`ElderAid API running on http://localhost:${PORT}`);
  scheduler.start(); // reminders, auto-missed medication, appointment reminders, delivery retries
});
