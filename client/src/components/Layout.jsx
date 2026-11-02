import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

const NAV = {
  ELDER: [
    { to: '/elder', label: 'Dashboard', end: true },
    { to: '/elder/profile', label: 'My Profile' },
    { to: '/elder/prescriptions', label: 'Prescriptions' },
    { to: '/elder/appointments', label: 'Appointments' },
    { to: '/elder/health', label: 'Health Records' },
  ],
  DOCTOR: [
    { to: '/doctor', label: 'Dashboard', end: true },
    { to: '/doctor/elders', label: 'My Elders' },
    { to: '/doctor/appointments', label: 'Appointments' },
  ],
  CAREGIVER: [
    { to: '/caregiver', label: 'Dashboard', end: true },
    { to: '/caregiver/alerts', label: 'Emergency Alerts' },
  ],
  ADMINISTRATOR: [
    { to: '/admin', label: 'Dashboard', end: true },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/elders', label: 'Elders' },
    { to: '/admin/assignments', label: 'Care Teams' },
    { to: '/admin/activity', label: 'Activity Log' },
  ],
};

export default function Layout({ children, wide }) {
  const { session, logout } = useAuth();
  const role = session?.user?.role;
  const items = NAV[role] || [];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">EA</span>
          ElderAid
        </a>
        <div className="topbar-right">
          <NotificationBell />
          <span>{session?.user?.name}</span>
          <span className="role-pill">{role}</span>
          <button className="logout-btn" onClick={logout}>Log out</button>
        </div>
      </header>
      <div className="layout">
        <nav className="sidenav">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className={`main ${wide ? 'main-wide' : ''}`}>{children}</main>
      </div>
    </div>
  );
}
