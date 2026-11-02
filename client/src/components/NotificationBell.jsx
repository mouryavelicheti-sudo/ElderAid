import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function NotificationBell() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);

  const load = useCallback(() => {
    if (!session?.token) return;
    api.get('/notifications/unread-count', session.token)
      .then((d) => setUnread(d.unreadCount))
      .catch(() => {});
  }, [session?.token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <button
      className="bell-btn"
      title={unread > 0 ? `${unread} unread notification(s)` : 'Notifications'}
      onClick={() => navigate('/notifications')}
    >
      🔔
      {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}
