import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import CheckinRibbon from '../../components/CheckinRibbon';
import StatusBadge from '../../components/StatusBadge';
import SosPanel from '../../components/SosPanel';

export default function ElderDashboard() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/elder/dashboard', session.token);
      setData(d);
    } catch (err) {
      setError(err.message);
    }
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function mark(medId, status) {
    setBusyId(medId);
    try {
      await api.put(`/elder/medications/${medId}/status`, { status }, session.token);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!data) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Welcome back</div>
        <h1>Hello, {data.user.name.split(' ')[0]}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>Here's your check-in for today.</p>
      </div>

      <div className="section">
        <SosPanel activeAlert={data.activeAlert} onChanged={load} />
      </div>

      <div className="section">
        <h2>Today's medications</h2>
        <CheckinRibbon medications={data.medicationsToday} onMark={mark} busyId={busyId} />
      </div>

      <div className="section">
        <h2>Upcoming appointments</h2>
        {data.upcomingAppointments.length === 0 ? (
          <div className="empty-state">No upcoming appointments. <Link to="/elder/appointments">Book one</Link>.</div>
        ) : (
          <div className="list">
            {data.upcomingAppointments.map((a) => (
              <div className="list-item" key={a.id}>
                <div>
                  <strong>Dr. {a.doctor_name}</strong>
                  <div className="med-meta">{a.appt_date} at {a.appt_time}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Quick actions</h2>
        <div className="btn-group">
          <Link className="btn btn-outline" to="/elder/profile">View / edit profile</Link>
          <Link className="btn btn-outline" to="/elder/prescriptions">View prescriptions</Link>
          <Link className="btn btn-primary" to="/elder/appointments">Book appointment</Link>
        </div>
      </div>
    </Layout>
  );
}
