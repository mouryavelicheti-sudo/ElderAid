import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

export default function CaregiverElderDetail() {
  const { id } = useParams();
  const { session } = useAuth();
  const [elder, setElder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/caregiver/elders/${id}`, session.token).then(setElder).catch((e) => setError(e.message));
  }, [id, session.token]);

  if (error) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!elder) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout wide>
      <Link to="/caregiver" style={{ fontSize: '0.9rem' }}>← Back to dashboard</Link>
      <div className="section">
        <div className="eyebrow">Assigned Elder</div>
        <h1>{elder.name}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          {elder.email}{elder.phone ? ` · ${elder.phone}` : ''}<br />
          {elder.dob ? `DOB: ${elder.dob} · ` : ''}{elder.blood_group ? `Blood group: ${elder.blood_group}` : ''}
        </p>
        {elder.address && <p><strong>Address:</strong> {elder.address}</p>}
        {elder.emergency_contact_name && (
          <p><strong>Emergency contact:</strong> {elder.emergency_contact_name} ({elder.emergency_contact_phone})</p>
        )}
        {elder.notes && <p><strong>Health notes:</strong> {elder.notes}</p>}
      </div>

      {elder.alerts.some((a) => a.status === 'ACTIVE') && (
        <div className="alert-banner">
          🚨 This elder has an active emergency alert — <Link to="/caregiver/alerts">respond now</Link>
        </div>
      )}

      <div className="section">
        <h2>Today's medications</h2>
        {elder.medicationsToday.length === 0 ? (
          <div className="empty-state">No medications scheduled today.</div>
        ) : (
          <div className="list">
            {elder.medicationsToday.map((m) => (
              <div className="list-item" key={m.id}>
                <span>{m.name} {m.dosage} · {m.time_slot}{m.instructions ? ` — ${m.instructions}` : ''}</span>
                <StatusBadge status={m.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Medication history (last 7 days)</h2>
        {elder.medicationHistory.length === 0 ? (
          <div className="empty-state">No check-ins recorded in the last week.</div>
        ) : (
          <table>
            <thead><tr><th>Date</th><th>Medication</th><th>Slot</th><th>Status</th></tr></thead>
            <tbody>
              {elder.medicationHistory.map((h, i) => (
                <tr key={i}>
                  <td>{h.log_date}</td>
                  <td>{h.name} {h.dosage}</td>
                  <td>{h.time_slot}</td>
                  <td><StatusBadge status={h.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section">
        <h2>Upcoming appointments</h2>
        {elder.upcomingAppointments.length === 0 ? (
          <div className="empty-state">No upcoming appointments.</div>
        ) : (
          <div className="list">
            {elder.upcomingAppointments.map((a, i) => (
              <div className="list-item" key={i}>
                <div>
                  <strong>Dr. {a.doctor_name}</strong>
                  <div className="med-meta">{a.appt_date} at {a.appt_time}{a.reason ? ` — ${a.reason}` : ''}</div>
                </div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Health records</h2>
        {elder.healthRecords.length === 0 ? (
          <div className="empty-state">No health records on file.</div>
        ) : (
          <div className="list">
            {elder.healthRecords.map((r, i) => (
              <div className="card" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>{r.title}</h3>
                  <span className="status-badge status-Completed">{r.record_type}</span>
                </div>
                <div className="med-meta" style={{ margin: '0.25rem 0 0.5rem' }}>
                  Dr. {r.doctor_name} · {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                </div>
                {r.description && <p style={{ margin: 0 }}>{r.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Recent emergency alerts</h2>
        {elder.alerts.length === 0 ? (
          <div className="empty-state">No emergency alerts.</div>
        ) : (
          <div className="list">
            {elder.alerts.map((a) => (
              <div className="list-item" key={a.id}>
                <div>
                  <strong>{a.message || 'SOS alert'}</strong>
                  <div className="med-meta">{a.created_at}</div>
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
