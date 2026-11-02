import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ roles, children }) {
  const { session } = useAuth();

  if (!session) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(session.user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return children;
}
