import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

export default function DoctorDashboard() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/doctor/dashboard', session.token).then(setData).catch((e) => setError(e.message));
  }, [session.token]);

  if (error) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!data) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Welcome back</div>
        <h1>Dr. {data.user.name}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>{data.specialization}</p>
      </div>

      <div className="section stat-grid">
        <div className="stat-tile">
          <div className="stat-num">{data.elderCount}</div>
          <div className="stat-label">Elders in system</div>
        </div>
        <div className="stat-tile">
          <div className="stat-num">{data.apptCount}</div>
          <div className="stat-label">Total appointments</div>
        </div>
      </div>

      <div className="section">
        <h2>Upcoming appointments</h2>
        {data.upcoming.length === 0 ? (
          <div className="empty-state">Nothing scheduled soon.</div>
        ) : (
          <div className="list">
            {data.upcoming.map((a) => (
              <div className="list-item" key={a.id}>
                <div>
                  <strong>{a.elder_name}</strong>
                  <div className="med-meta">{a.appt_date} at {a.appt_time}{a.reason ? ` — ${a.reason}` : ''}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <div className="btn-group">
          <Link className="btn btn-outline" to="/doctor/elders">View elders</Link>
          <Link className="btn btn-primary" to="/doctor/appointments">Manage appointments</Link>
        </div>
      </div>
    </Layout>
  );
}
