import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function ElderPrescriptions() {
  const { session } = useAuth();
  const [rx, setRx] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/elder/prescriptions', session.token).then(setRx).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">My Prescriptions</div>
        <h1>Prescription history</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!rx ? <p>Loading…</p> : rx.length === 0 ? (
        <div className="empty-state">No prescriptions yet. Your doctor will add one after your visit.</div>
      ) : (
        <div className="list">
          {rx.map((p) => (
            <div className="card" key={p.id}>
              <h3 style={{ marginBottom: '0.2rem' }}>Dr. {p.doctor_name}</h3>
              <div className="med-meta" style={{ marginBottom: '0.75rem' }}>
                {p.specialization ? `${p.specialization} · ` : ''}{new Date(p.created_at).toLocaleDateString()}
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
