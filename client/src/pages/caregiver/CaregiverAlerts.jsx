import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';
import ContactDelivery from '../../components/ContactDelivery';

export default function CaregiverAlerts() {
  const { session } = useAuth();
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(() => {
    api.get('/caregiver/alerts', session.token).then(setAlerts).catch((e) => setError(e.message));
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setBusyId(id); setError('');
    try {
      await api.put(`/caregiver/alerts/${id}/status`, { status }, session.token);
      setNotice(status === 'ACKNOWLEDGED' ? 'Alert acknowledged — the elder has been notified.' : 'Alert marked as resolved.');
      setTimeout(() => setNotice(''), 3000);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">Emergency</div>
        <h1>Emergency alerts</h1>
        <p style={{ color: 'var(--ink-soft)' }}>SOS alerts from elders assigned to you, active first.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {!alerts ? <p>Loading…</p> : alerts.length === 0 ? (
        <div className="empty-state">No emergency alerts from your assigned elders.</div>
      ) : (
        <div className="list" style={{ maxWidth: 760 }}>
          {alerts.map((a) => (
            <div className="card" key={a.id} style={a.status === 'ACTIVE' ? { borderColor: 'var(--clay)' } : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{a.elder_name}</h3>
                <StatusBadge status={a.status} />
              </div>
              <div className="med-meta" style={{ margin: '0.25rem 0 0.5rem' }}>
                Raised {new Date(a.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                {a.updated_at !== a.created_at && ` · updated ${new Date(a.updated_at.replace(' ', 'T') + 'Z').toLocaleString()}`}
              </div>
              {a.message && <p style={{ margin: '0 0 0.5rem' }}><strong>Message:</strong> {a.message}</p>}
              <p className="med-meta" style={{ margin: '0 0 0.5rem' }}>
                {a.elder_phone && <>Elder phone: {a.elder_phone} · </>}
                {a.address && <>Address: {a.address} · </>}
                {a.emergency_contact_name
                  ? <>Emergency contact: {a.emergency_contact_name} ({a.emergency_contact_phone || 'no phone'})</>
                  : 'No emergency contact on file'}
              </p>
              <ContactDelivery deliveries={a.contactDeliveries} audience="caregiver" />
              {a.acknowledged_by_name && a.status !== 'ACTIVE' && (
                <p className="med-meta" style={{ margin: '0 0 0.5rem' }}>Acknowledged by {a.acknowledged_by_name}</p>
              )}
              {a.resolved_by_name && <p className="med-meta" style={{ margin: '0 0 0.5rem' }}>Resolved by {a.resolved_by_name}</p>}

              <div className="btn-group">
                {a.status === 'ACTIVE' && (
                  <button className="btn btn-primary btn-sm" disabled={busyId === a.id}
                    onClick={() => setStatus(a.id, 'ACKNOWLEDGED')}>
                    Acknowledge
                  </button>
                )}
                {['ACTIVE', 'ACKNOWLEDGED'].includes(a.status) && (
                  <button className="btn btn-outline btn-sm" disabled={busyId === a.id}
                    onClick={() => setStatus(a.id, 'RESOLVED')}>
                    Mark resolved
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
