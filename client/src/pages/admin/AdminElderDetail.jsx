import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

const STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];

export default function AdminElderDetail() {
  const { id } = useParams();
  const { session } = useAuth();
  const [elder, setElder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    api.get(`/admin/elders/${id}`, session.token).then(setElder).catch((e) => setError(e.message));
  }, [id, session.token]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(apptId, status) {
    setError('');
    try {
      await api.put(`/admin/appointments/${apptId}/status`, { status }, session.token);
      setNotice('Appointment status updated.');
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !elder) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!elder) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout wide>
      <Link to="/admin/elders" style={{ fontSize: '0.9rem' }}>← Back to elders</Link>
      <div className="section">
        <div className="eyebrow">Elder Profile</div>
        <h1>{elder.name}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          {elder.email}{elder.phone ? ` · ${elder.phone}` : ''}<br />
          {elder.dob ? `DOB: ${elder.dob} · ` : ''}{elder.blood_group ? `Blood group: ${elder.blood_group}` : ''}
        </p>
        {elder.address && <p><strong>Address:</strong> {elder.address}</p>}
        {elder.emergency_contact_name && (
          <p><strong>Emergency contact:</strong> {elder.emergency_contact_name} ({elder.emergency_contact_phone})</p>
        )}
        {elder.notes && <p><strong>Notes:</strong> {elder.notes}</p>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="section">
        <h2>Prescriptions</h2>
        {elder.prescriptions.length === 0 ? (
          <div className="empty-state">No prescriptions yet.</div>
        ) : (
          <div className="list">
            {elder.prescriptions.map((p) => (
              <div className="card" key={p.id}>
                <div className="med-meta">{new Date(p.created_at).toLocaleDateString()} · Dr. {p.doctor_name}</div>
                {p.notes && <p style={{ fontStyle: 'italic' }}>{p.notes}</p>}
                <ul>
                  {p.medications.map((m) => (
                    <li key={m.id}>{m.name} · {m.dosage} · {m.frequency} · {m.time_slot}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Appointments</h2>
        {elder.appointments.length === 0 ? (
          <div className="empty-state">No appointments yet.</div>
        ) : (
          <div className="list">
            {elder.appointments.map((a) => (
              <div className="list-item" key={a.id}>
                <div>
                  {a.appt_date} at {a.appt_time} with Dr. {a.doctor_name}
                  {a.reason ? ` — ${a.reason}` : ''}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <StatusBadge status={a.status} />
                  <select value={a.status} onChange={(e) => changeStatus(a.id, e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
