import { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

const TYPE_LABEL = {
  MEDICATION_REMINDER: 'Medication reminder',
  MISSED_MEDICATION: 'Missed medication',
  APPOINTMENT: 'Appointment',
  APPOINTMENT_UPDATE: 'Appointment update',
  APPOINTMENT_CANCELLED: 'Appointment cancelled',
  APPOINTMENT_REMINDER: 'Appointment reminder',
  EMERGENCY: 'Emergency',
  PRESCRIPTION: 'Prescription',
  HEALTH_RECORD: 'Health record',
  GENERAL: 'General',
};

export default function Notifications() {
  const { session } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/notifications', session.token).then(setData).catch((e) => setError(e.message));
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  async function markRead(id) {
    try {
      await api.put(`/notifications/${id}/read`, {}, session.token);
      load();
    } catch (err) { setError(err.message); }
  }

  async function markAllRead() {
    try {
      await api.put('/notifications/read-all', {}, session.token);
      load();
    } catch (err) { setError(err.message); }
  }

  return (
    <Layout>
      <div className="section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div className="eyebrow">Inbox</div>
          <h1>Notifications</h1>
        </div>
        {data && data.unreadCount > 0 && (
          <button className="btn btn-outline btn-sm" onClick={markAllRead}>
            Mark all as read ({data.unreadCount})
          </button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {!data ? <p>Loading…</p> : data.notifications.length === 0 ? (
        <div className="empty-state">No notifications yet.</div>
      ) : (
        <div className="section" style={{ maxWidth: 720 }}>
          {data.notifications.map((n) => (
            <div className={`notif-item ${n.is_read ? '' : 'unread'}`} key={n.id}>
              {!n.is_read && <span className="notif-dot" />}
              <div className="notif-body">
                <div className="notif-title">{n.title}</div>
                <div className="eyebrow">
                  {TYPE_LABEL[n.type] || n.type}{' '}
                  <span className="channel-chip">In-app</span>
                  {n.delivery_status && n.delivery_status !== 'DELIVERED' && (
                    <span className={`status-badge status-${n.delivery_status === 'PENDING' ? 'PENDING_DELIVERY' : n.delivery_status}`} style={{ marginLeft: '0.4rem' }}>
                      {n.delivery_status}
                    </span>
                  )}
                </div>
                {n.message && <p style={{ margin: '0.25rem 0 0' }}>{n.message}</p>}
                <div className="notif-time">{new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</div>
              </div>
              {!n.is_read && (
                <button className="btn btn-outline btn-sm" onClick={() => markRead(n.id)}>Mark read</button>
              )}
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
