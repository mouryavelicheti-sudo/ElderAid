import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function AdminActivity() {
  const { session } = useAuth();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/activity', session.token).then(setRows).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout wide>
      <div className="section">
        <div className="eyebrow">System Activity</div>
        <h1>Activity log</h1>
        <p style={{ color: 'var(--ink-soft)' }}>Most recent system events (newest first).</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!rows ? <p>Loading…</p> : rows.length === 0 ? (
        <div className="empty-state">No activity recorded yet.</div>
      ) : (
        <div className="section">
          <table>
            <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.created_at}</td>
                  <td>{r.actor_name}</td>
                  <td><span className="status-badge status-Completed">{r.action}</span></td>
                  <td>{r.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
