import { useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from './StatusBadge';
import ContactDelivery from './ContactDelivery';

// SOS emergency panel for the elder dashboard.
// Creates a real emergency_alerts row via the backend and notifies caregivers/admins.
export default function SosPanel({ activeAlert, onChanged }) {
  const { session } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function triggerSos() {
    setBusy(true); setError('');
    try {
      await api.post('/elder/sos', { message }, session.token);
      setConfirming(false);
      setMessage('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelSos() {
    setBusy(true); setError('');
    try {
      await api.put(`/elder/sos/${activeAlert.id}/cancel`, {}, session.token);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sos-card">
      <div>
        <strong style={{ fontSize: '1.05rem' }}>Emergency SOS</strong>
        <div className="med-meta">
          Press the button if you need urgent help. Your caregiver and the care team will be alerted immediately.
        </div>
        {activeAlert && (
          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <StatusBadge status={activeAlert.status} />
            <span className="med-meta">Alert raised {activeAlert.created_at}</span>
          </div>
        )}
        {activeAlert && (
          <ContactDelivery deliveries={activeAlert.contactDeliveries} inApp audience="elder" />
        )}
        {error && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
      </div>

      {activeAlert ? (
        activeAlert.status === 'ACTIVE' ? (
          <button className="btn btn-outline" disabled={busy} onClick={cancelSos}>
            {busy ? 'Cancelling…' : 'Cancel alert (false alarm)'}
          </button>
        ) : (
          <span className="med-meta">Your caregiver is responding.</span>
        )
      ) : (
        <button className="sos-btn" onClick={() => { setError(''); setConfirming(true); }}>
          SOS
        </button>
      )}

      {confirming && (
        <div className="modal-backdrop" onClick={() => !busy && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Confirm emergency alert</h3>
            <p>
              This will immediately alert your assigned caregiver(s) and the ElderAid
              administrators inside the app, and try to text your emergency contact.
              Only continue if you need urgent assistance.
            </p>
            <div className="field">
              <label htmlFor="sosmsg">What is happening? (optional)</label>
              <textarea
                id="sosmsg" rows={2} value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. Chest pain, fell down, feeling dizzy…"
              />
            </div>
            <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-outline" disabled={busy} onClick={() => setConfirming(false)}>
                Go back
              </button>
              <button className="sos-btn" disabled={busy} onClick={triggerSos}>
                {busy ? 'Sending…' : 'Yes, send SOS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
