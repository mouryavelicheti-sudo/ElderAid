import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_HOME = {
  ELDER: '/elder',
  DOCTOR: '/doctor',
  CAREGIVER: '/caregiver',
  ADMINISTRATOR: '/admin',
};

export default function Unauthorized() {
  const { session } = useAuth();
  const home = session ? ROLE_HOME[session.user.role] : '/login';

  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <h1>Access denied</h1>
        <p>Your account doesn't have permission to view that page.</p>
        <Link className="btn btn-primary" to={home}>Return to my dashboard</Link>
      </div>
    </div>
  );
}
