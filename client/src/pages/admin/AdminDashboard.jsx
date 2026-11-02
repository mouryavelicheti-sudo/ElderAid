import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function AdminDashboard() {
  const { session } = useAuth();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/stats', session.token)
      .then(setStats)
      .catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout wide>
      <div className="section">
        <div className="eyebrow">System Overview</div>
        <h1>Administrator dashboard</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!stats ? <p>Loading…</p> : (
        <div className="section stat-grid">
          <div className="stat-tile"><div className="stat-num">{stats.totalUsers}</div><div className="stat-label">Total users</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.elders}</div><div className="stat-label">Elders</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.doctors}</div><div className="stat-label">Doctors</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.caregivers}</div><div className="stat-label">Caregivers</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.administrators}</div><div className="stat-label">Administrators</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.totalAppointments}</div><div className="stat-label">Appointments</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.totalPrescriptions}</div><div className="stat-label">Prescriptions</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.totalHealthRecords}</div><div className="stat-label">Health records</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.activeAlerts}</div><div className="stat-label">Active SOS alerts</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.medicationsTakenToday}</div><div className="stat-label">Meds taken today</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.medicationsMissedToday}</div><div className="stat-label">Meds missed today</div></div>
          <div className="stat-tile"><div className="stat-num">{stats.disabledUsers}</div><div className="stat-label">Disabled accounts</div></div>
        </div>
      )}

      <div className="section">
        <h2>Quick links</h2>
        <p>
          <Link to="/admin/users">Manage users</Link> — create, edit, or enable/disable any Elder, Doctor,
          Caregiver, or Administrator account.<br />
          <Link to="/admin/elders">View elders</Link> — see any elder's full profile, prescriptions, and
          appointments, and override an appointment's status if needed.<br />
          <Link to="/admin/assignments">Care teams</Link> — assign caregivers to the elders they monitor.<br />
          <Link to="/admin/activity">Activity log</Link> — review recent system activity.
        </p>
      </div>
    </Layout>
  );
}
