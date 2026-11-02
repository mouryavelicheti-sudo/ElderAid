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
  const [success, setSuccess] = useState('');
  const [reschedId, setReschedId] = useState(null);   // REQ-F-35
  const [reschedForm, setReschedForm] = useState({ appt_date: '', appt_time: '' });
  const [reschedError, setReschedError] = useState('');

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
    setBusyId(id); setError(''); setSuccess('');
    try {
      await api.put(`/doctor/appointments/${id}/status`, { status }, session.token);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitReschedule(e) {
    e.preventDefault();
    setReschedError(''); setSuccess('');
    try {
      const res = await api.put(`/doctor/appointments/${reschedId}/reschedule`, reschedForm, session.token);
      setSuccess(`Appointment moved to ${res.appt_date} at ${res.appt_time}. The elder has been notified.`);
      setReschedId(null);
      await load();
    } catch (err) {
      setReschedError(err.message);
    }
  }

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Appointments</div>
        <h1>Manage appointments</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}
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
                {['Pending', 'Confirmed'].includes(a.status) && (
                  <button className="btn btn-outline btn-sm" disabled={busyId === a.id}
                    onClick={() => { setReschedError(''); setSuccess(''); setReschedId(a.id); setReschedForm({ appt_date: a.appt_date, appt_time: a.appt_time }); }}>
                    Reschedule
                  </button>
                )}
                {NEXT_ACTIONS[a.status].map(([label, next]) => (
                  <button key={next} className="btn btn-outline btn-sm" disabled={busyId === a.id}
                    onClick={() => updateStatus(a.id, next)}>
                    {label}
                  </button>
                ))}
              </div>
              {reschedId === a.id && (
                <form onSubmit={submitReschedule} style={{ flexBasis: '100%', marginTop: '0.75rem' }}>
                  <div className="field-row">
                    <div className="field">
                      <label htmlFor={`rd${a.id}`}>New date</label>
                      <input id={`rd${a.id}`} type="date" min={new Date().toISOString().slice(0, 10)} value={reschedForm.appt_date}
                        onChange={(e) => setReschedForm({ ...reschedForm, appt_date: e.target.value })} required />
                    </div>
                    <div className="field">
                      <label htmlFor={`rt${a.id}`}>New time</label>
                      <input id={`rt${a.id}`} type="time" value={reschedForm.appt_time}
                        onChange={(e) => setReschedForm({ ...reschedForm, appt_time: e.target.value })} required />
                    </div>
                  </div>
                  {reschedError && <div className="alert alert-error" role="alert">{reschedError}</div>}
                  <div className="btn-group">
                    <button className="btn btn-primary btn-sm" type="submit">Save new time</button>
                    <button className="btn btn-outline btn-sm" type="button" onClick={() => setReschedId(null)}>Keep current time</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
