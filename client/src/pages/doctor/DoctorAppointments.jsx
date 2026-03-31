import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

const NEXT_ACTIONS = {
  Pending: [['Confirm', 'Confirmed'], ['Cancel', 'Cancelled']],
  Confirmed: [['Mark Completed', 'Completed'], ['Cancel', 'Cancelled']],
  Completed: [],
  Cancelled: [],
};

export default function DoctorAppointments() {
  const { session } = useAuth();
  const [appts, setAppts] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const a = await api.get('/doctor/appointments', session.token);
      setAppts(a);
    } catch (err) {
      setError(err.message);
    }
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id, status) {
    setBusyId(id);
    try {
      await api.put(`/doctor/appointments/${id}/status`, { status }, session.token);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Appointments</div>
        <h1>Manage appointments</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!appts ? <p>Loading…</p> : appts.length === 0 ? (
        <div className="empty-state">No appointments yet.</div>
      ) : (
        <div className="list">
          {appts.map((a) => (
            <div className="list-item" key={a.id}>
              <div>
                <strong>{a.elder_name}</strong>
                <div className="med-meta">{a.appt_date} at {a.appt_time}{a.reason ? ` — ${a.reason}` : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <StatusBadge status={a.status} />
                {NEXT_ACTIONS[a.status].map(([label, next]) => (
                  <button key={next} className="btn btn-outline btn-sm" disabled={busyId === a.id}
                    onClick={() => updateStatus(a.id, next)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
