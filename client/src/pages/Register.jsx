import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_HOME = {
  ELDER: '/elder',
  DOCTOR: '/doctor',
  CAREGIVER: '/caregiver',
  ADMINISTRATOR: '/admin',
};

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'ELDER', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const { user } = await register({
        name: form.name,
        email: form.email,
        phone: form.phone,
        role: form.role,
        password: form.password,
      });
      navigate(ROLE_HOME[user.role] || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark">EA</span>
          <div>
            <h1 style={{ fontSize: '1.4rem', margin: 0 }}>ElderAid</h1>
            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Create your account</div>
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" type="text" value={form.name} onChange={update('name')} required />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" value={form.email} onChange={update('email')} required />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone (optional)</label>
            <input id="phone" type="tel" value={form.phone} onChange={update('phone')} />
          </div>
          <div className="field">
            <label htmlFor="role">I am a</label>
            <select id="role" value={form.role} onChange={update('role')} required>
              <option value="ELDER">Elder</option>
              <option value="CAREGIVER">Caregiver</option>
              <option value="DOCTOR">Doctor</option>
              <option value="ADMINISTRATOR">Administrator</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="new-password" value={form.password}
              onChange={update('password')} minLength={6} required />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm password</label>
            <input id="confirm" type="password" autoComplete="new-password" value={form.confirm}
              onChange={update('confirm')} minLength={6} required />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <div className="login-footer-link">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
