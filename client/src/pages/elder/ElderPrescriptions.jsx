import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function ElderPrescriptions() {
  const { session } = useAuth();
  const [rx, setRx] = useState(null);
  const [error, setError] = useState('');
  const [schedule, setSchedule] = useState(null);

  useEffect(() => {
    api.get('/elder/prescriptions', session.token).then(setRx).catch((e) => setError(e.message));
    api.get('/elder/medications/schedule?days=7', session.token).then(setSchedule).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">My Prescriptions</div>
        <h1>Prescription history</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="section">
        <h2>Medication schedule — next 7 days</h2>
        <p className="med-meta">Generated from your prescriptions. You get an in-app reminder shortly before each dose.</p>
        {!schedule ? <p>Loading…</p> : schedule.length === 0 ? (
          <div className="empty-state">No scheduled doses yet.</div>
        ) : (
          Object.entries(schedule.reduce((acc, o) => { (acc[o.date] = acc[o.date] || []).push(o); return acc; }, {})).map(([date, items]) => (
            <div className="card schedule-day" key={date}>
              <h4>{new Date(date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h4>
              {items.map((o) => (
                <div className="list-item" key={o.medication_id + o.date}>
                  <div><strong>{o.time}</strong> · {o.name} <span className="med-meta">{o.dosage} · {o.time_slot}</span></div>
                  <span className={`status-badge status-${o.status}`}>{o.status}</span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      {!rx ? <p>Loading…</p> : rx.length === 0 ? (
        <div className="empty-state">No prescriptions yet. Your doctor will add one after your visit.</div>
      ) : (
        <div className="list">
          {rx.map((p) => (
            <div className="card" key={p.id}>
              <h3 style={{ marginBottom: '0.2rem' }}>Dr. {p.doctor_name}</h3>
              <div className="med-meta" style={{ marginBottom: '0.75rem' }}>
                {p.specialization ? `${p.specialization} · ` : ''}{new Date(p.created_at).toLocaleDateString()}{p.updated_at ? ' · edited by your doctor' : ''}
              </div>
              {p.notes && <p style={{ fontStyle: 'italic' }}>{p.notes}</p>}
              <table>
                <thead>
                  <tr><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Time</th><th>Instructions</th></tr>
                </thead>
                <tbody>
                  {p.medications.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.dosage}</td>
                      <td>{m.frequency}</td>
                      <td>{m.time_slot}</td>
                      <td>{m.instructions || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
