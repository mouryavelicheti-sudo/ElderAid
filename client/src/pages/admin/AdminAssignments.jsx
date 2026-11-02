import { useEffect, useState, useCallback } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

export default function AdminAssignments() {
  const { session } = useAuth();
  const [assignments, setAssignments] = useState(null);
  const [caregivers, setCaregivers] = useState([]);
  const [elders, setElders] = useState([]);
  const [form, setForm] = useState({ caregiver_id: '', elder_id: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      api.get('/admin/assignments', session.token),
      api.get('/admin/users', session.token),
    ])
      .then(([a, users]) => {
        setAssignments(a);
        setCaregivers(users.filter((u) => u.role === 'CAREGIVER' && u.is_active));
        setElders(users.filter((u) => u.role === 'ELDER' && u.is_active));
      })
      .catch((e) => setError(e.message));
  }, [session.token]);

  useEffect(() => { load(); }, [load]);

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  }

  async function handleAssign(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await api.post('/admin/assignments', form, session.token);
      setForm({ caregiver_id: '', elder_id: '' });
      flash('Caregiver assigned.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id) {
    setError('');
    try {
      await api.del(`/admin/assignments/${id}`, session.token);
      flash('Assignment removed.');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Layout wide>
      <div className="section">
        <div className="eyebrow">Care Teams</div>
        <h1>Caregiver assignments</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          Assign caregivers to the elders they monitor. Caregivers only see their assigned elders.
        </p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="section card" style={{ maxWidth: 640 }}>
        <h3>New assignment</h3>
        <form onSubmit={handleAssign}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="cg">Caregiver</label>
              <select id="cg" value={form.caregiver_id} required
                onChange={(e) => setForm({ ...form, caregiver_id: e.target.value })}>
                <option value="">Select caregiver…</option>
                {caregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="el">Elder</label>
              <select id="el" value={form.elder_id} required
                onChange={(e) => setForm({ ...form, elder_id: e.target.value })}>
                <option value="">Select elder…</option>
                {elders.map((e2) => <option key={e2.id} value={e2.id}>{e2.name}</option>)}
              </select>
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Assigning…' : 'Assign caregiver'}
          </button>
        </form>
      </div>

      <div className="section">
        <h2>Current assignments</h2>
        {!assignments ? <p>Loading…</p> : assignments.length === 0 ? (
          <div className="empty-state">No caregiver assignments yet.</div>
        ) : (
          <table>
            <thead><tr><th>Caregiver</th><th>Elder</th><th></th></tr></thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td>{a.caregiver_name} <span className="med-meta">({a.caregiver_email})</span></td>
                  <td>{a.elder_name} <span className="med-meta">({a.elder_email})</span></td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => handleRemove(a.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
