import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function DoctorElders() {
  const { session } = useAuth();
  const [elders, setElders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/doctor/elders', session.token).then(setElders).catch((e) => setError(e.message));
  }, [session.token]);

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">My Elders</div>
        <h1>Elders in the system</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!elders ? <p>Loading…</p> : (
        <div className="list">
          {elders.map((e) => (
            <div className="list-item" key={e.id}>
              <div>
                <strong>{e.name}</strong>
                <div className="med-meta">{e.email}{e.blood_group ? ` · Blood group ${e.blood_group}` : ''}</div>
              </div>
              <Link className="btn btn-outline btn-sm" to={`/doctor/elders/${e.id}`}>View & prescribe</Link>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
