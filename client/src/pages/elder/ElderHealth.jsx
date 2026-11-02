import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

export default function ElderHealth() {
  const { session } = useAuth();
  const [records, setRecords] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/elder/health-records', session.token),
      api.get('/elder/medications/history?days=30', session.token),
    ])
      .then(([r, h]) => { setRecords(r); setHistory(h); })
      .catch((e) => setError(e.message));
  }, [session.token]);

  // Group medication history by date for readability.
  const byDate = (history || []).reduce((acc, row) => {
    (acc[row.log_date] = acc[row.log_date] || []).push(row);
    return acc;
  }, {});

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">My Health</div>
        <h1>Health records</h1>
        <p style={{ color: 'var(--ink-soft)' }}>Records added by your doctors, newest first.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!records ? <p>Loading…</p> : records.length === 0 ? (
        <div className="empty-state">No health records yet. Your doctor will add them after your visits.</div>
      ) : (
        <div className="list" style={{ maxWidth: 720 }}>
          {records.map((r) => (
            <div className="card" key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0 }}>{r.title}</h3>
                <span className="status-badge status-Completed">{r.record_type}</span>
              </div>
              <div className="med-meta" style={{ margin: '0.25rem 0 0.5rem' }}>
                Dr. {r.doctor_name}{r.specialization ? ` · ${r.specialization}` : ''} · {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                {r.updated_at !== r.created_at && ' (edited)'}
              </div>
              {r.description && <p style={{ margin: 0 }}>{r.description}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="section">
        <h2>Medication history (last 30 days)</h2>
        {!history ? <p>Loading…</p> : history.length === 0 ? (
          <div className="empty-state">No medication check-ins recorded yet.</div>
        ) : (
          Object.entries(byDate).map(([date, rows]) => (
            <div key={date} style={{ marginBottom: '1rem', maxWidth: 720 }}>
              <div className="eyebrow" style={{ marginBottom: '0.35rem' }}>{date}</div>
              <div className="list">
                {rows.map((m, i) => (
                  <div className="list-item" key={i}>
                    <span>{m.name} {m.dosage} · {m.time_slot}</span>
                    <StatusBadge status={m.status} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
}
