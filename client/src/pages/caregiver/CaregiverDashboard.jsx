import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

export default function CaregiverDashboard() {
  const { session } = useAuth();
  const [elders, setElders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/caregiver/elders', session.token).then(setElders).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Welcome back</div>
        <h1>Hello, {session.user.name.split(' ')[0]}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>Here's how your assigned elders are doing today.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!elders ? <p>Loading…</p> : elders.length === 0 ? (
        <div className="empty-state">No elders are assigned to you yet.</div>
      ) : (
        <div className="list">
          {elders.map((e) => (
            <div className="card" key={e.id}>
              {e.activeAlerts > 0 && (
                <div className="alert-banner">
                  🚨 {e.activeAlerts} active emergency alert{e.activeAlerts > 1 ? 's' : ''} — <Link to="/caregiver/alerts">respond now</Link>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 style={{ marginBottom: '0.2rem' }}>{e.name}</h3>
                <Link to={`/caregiver/elders/${e.id}`} style={{ fontSize: '0.9rem' }}>View details →</Link>
              </div>
              <div className="med-meta" style={{ marginBottom: '0.75rem' }}>
                {e.dob ? `DOB ${e.dob} · ` : ''}{e.blood_group ? `Blood group ${e.blood_group} · ` : ''}{e.phone}
              </div>

              <div className="eyebrow">Today's medications</div>
              {e.medicationsToday.length > 0 && (
                <p className="med-meta" style={{ margin: '0.15rem 0 0.5rem' }}>
                  {e.takenToday} taken · {e.missedToday} missed · {e.medicationsToday.length - e.takenToday - e.missedToday} pending
                </p>
              )}
              {e.medicationsToday.length === 0 ? (
                <p className="med-meta">No medications scheduled.</p>
              ) : (
                <div className="list" style={{ marginBottom: '0.75rem' }}>
                  {e.medicationsToday.map((m, i) => (
                    <div className="list-item" key={i}>
                      <span>{m.name} · {m.time_slot}</span>
                      <StatusBadge status={m.status || 'Pending'} />
                    </div>
                  ))}
                </div>
              )}

              <div className="eyebrow">Next appointment</div>
              {e.nextAppointment ? (
                <p className="med-meta">{e.nextAppointment.appt_date} at {e.nextAppointment.appt_time} — {e.nextAppointment.status}</p>
              ) : (
                <p className="med-meta">None scheduled.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
