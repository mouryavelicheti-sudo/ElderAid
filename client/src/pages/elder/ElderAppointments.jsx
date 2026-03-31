import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

export default function ElderAppointments() {
  const { session } = useAuth();
  const [appts, setAppts] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [form, setForm] = useState({ doctor_id: '', appt_date: '', appt_time: '', reason: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      api.get('/elder/appointments', session.token),
      api.get('/elder/doctors', session.token),
    ]);
    setAppts(a);
    setDoctors(d);
  }, [session.token]);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.post('/elder/appointments', form, session.token);
      setSuccess('Appointment requested.');
      setForm({ doctor_id: '', appt_date: '', appt_time: '', reason: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Appointments</div>
        <h1>My appointments</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="section card" style={{ maxWidth: 640 }}>
        <h3>Book a new appointment</h3>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="doctor">Doctor</label>
            <select id="doctor" value={form.doctor_id} onChange={(e) => setForm({ ...form, doctor_id: e.target.value })} required>
              <option value="">Select a doctor…</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>Dr. {d.name}{d.specialization ? ` — ${d.specialization}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="date">Date</label>
              <input id="date" type="date" value={form.appt_date} onChange={(e) => setForm({ ...form, appt_date: e.target.value })} required />
            </div>
            <div className="field">
              <label htmlFor="time">Time</label>
              <input id="time" type="time" value={form.appt_time} onChange={(e) => setForm({ ...form, appt_time: e.target.value })} required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="reason">Reason</label>
            <textarea id="reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Follow-up check-up" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Booking…' : 'Request appointment'}
          </button>
        </form>
      </div>

      <div className="section">
        <h2>History</h2>
        {!appts ? <p>Loading…</p> : appts.length === 0 ? (
          <div className="empty-state">No appointments yet.</div>
        ) : (
          <div className="list">
            {appts.map((a) => (
              <div className="list-item" key={a.id}>
                <div>
                  <strong>Dr. {a.doctor_name}</strong>{a.specialization ? ` · ${a.specialization}` : ''}
                  <div className="med-meta">{a.appt_date} at {a.appt_time}{a.reason ? ` — ${a.reason}` : ''}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
