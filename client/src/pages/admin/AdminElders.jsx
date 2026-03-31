import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function AdminElders() {
  const { session } = useAuth();
  const [elders, setElders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/admin/elders', session.token).then(setElders).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout wide>
      <div className="section">
        <div className="eyebrow">Elder Oversight</div>
        <h1>Elders</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!elders ? <p>Loading…</p> : elders.length === 0 ? <p>No elders registered yet.</p> : (
        <div className="section">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Blood group</th><th></th></tr></thead>
            <tbody>
              {elders.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.email}</td>
                  <td>{e.phone || '—'}</td>
                  <td>{e.blood_group || '—'}</td>
                  <td><Link to={`/admin/elders/${e.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
