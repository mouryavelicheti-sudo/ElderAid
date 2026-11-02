import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

import Login from './pages/Login';
import Register from './pages/Register';
import Unauthorized from './pages/Unauthorized';
import Notifications from './pages/Notifications';

import ElderDashboard from './pages/elder/ElderDashboard';
import ElderProfile from './pages/elder/ElderProfile';
import ElderPrescriptions from './pages/elder/ElderPrescriptions';
import ElderAppointments from './pages/elder/ElderAppointments';
import ElderHealth from './pages/elder/ElderHealth';

import DoctorDashboard from './pages/doctor/DoctorDashboard';
import DoctorElders from './pages/doctor/DoctorElders';
import DoctorElderDetail from './pages/doctor/DoctorElderDetail';
import DoctorAppointments from './pages/doctor/DoctorAppointments';

import CaregiverDashboard from './pages/caregiver/CaregiverDashboard';
import CaregiverAlerts from './pages/caregiver/CaregiverAlerts';
import CaregiverElderDetail from './pages/caregiver/CaregiverElderDetail';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminElders from './pages/admin/AdminElders';
import AdminElderDetail from './pages/admin/AdminElderDetail';
import AdminActivity from './pages/admin/AdminActivity';
import AdminAssignments from './pages/admin/AdminAssignments';

const ROLE_HOME = {
  ELDER: '/elder',
  DOCTOR: '/doctor',
  CAREGIVER: '/caregiver',
  ADMINISTRATOR: '/admin',
};

function RootRedirect() {
  const { session } = useAuth();
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[session.user.role] || '/login'} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/unauthorized" element={<Unauthorized />} />
          <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />

          <Route path="/elder" element={<ProtectedRoute roles={['ELDER']}><ElderDashboard /></ProtectedRoute>} />
          <Route path="/elder/profile" element={<ProtectedRoute roles={['ELDER']}><ElderProfile /></ProtectedRoute>} />
          <Route path="/elder/prescriptions" element={<ProtectedRoute roles={['ELDER']}><ElderPrescriptions /></ProtectedRoute>} />
          <Route path="/elder/appointments" element={<ProtectedRoute roles={['ELDER']}><ElderAppointments /></ProtectedRoute>} />
          <Route path="/elder/health" element={<ProtectedRoute roles={['ELDER']}><ElderHealth /></ProtectedRoute>} />

          <Route path="/doctor" element={<ProtectedRoute roles={['DOCTOR']}><DoctorDashboard /></ProtectedRoute>} />
          <Route path="/doctor/elders" element={<ProtectedRoute roles={['DOCTOR']}><DoctorElders /></ProtectedRoute>} />
          <Route path="/doctor/elders/:id" element={<ProtectedRoute roles={['DOCTOR']}><DoctorElderDetail /></ProtectedRoute>} />
          <Route path="/doctor/appointments" element={<ProtectedRoute roles={['DOCTOR']}><DoctorAppointments /></ProtectedRoute>} />

          <Route path="/caregiver" element={<ProtectedRoute roles={['CAREGIVER']}><CaregiverDashboard /></ProtectedRoute>} />
          <Route path="/caregiver/alerts" element={<ProtectedRoute roles={['CAREGIVER']}><CaregiverAlerts /></ProtectedRoute>} />
          <Route path="/caregiver/elders/:id" element={<ProtectedRoute roles={['CAREGIVER']}><CaregiverElderDetail /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminUsers /></ProtectedRoute>} />
          <Route path="/admin/elders" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminElders /></ProtectedRoute>} />
          <Route path="/admin/elders/:id" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminElderDetail /></ProtectedRoute>} />
          <Route path="/admin/activity" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminActivity /></ProtectedRoute>} />
          <Route path="/admin/assignments" element={<ProtectedRoute roles={['ADMINISTRATOR']}><AdminAssignments /></ProtectedRoute>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
