import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

const ROLES = ['ELDER', 'DOCTOR', 'CAREGIVER', 'ADMINISTRATOR'];
const EMPTY_FORM = { name: '', email: '', phone: '', role: 'ELDER', password: '' };

export default function AdminUsers() {
  const { session } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function loadUsers() {
    return api.get('/admin/users', session.token).then(setUsers).catch((e) => setError(e.message));
  }

  useEffect(() => { loadUsers(); }, [session.token]);

  function flashNotice(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3000);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await api.post('/admin/users', createForm, session.token);
      setCreateForm(EMPTY_FORM);
      setShowCreate(false);
      await loadUsers();
      flashNotice('User created successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  function startEdit(u) {
    setEditingId(u.id);
    setEditForm({ name: u.name, email: u.email, phone: u.phone || '', role: u.role, password: '' });
  }

  async function handleSaveEdit(id) {
    setError('');
    setSaving(true);
    try {
      const { password, ...rest } = editForm;
      await api.put(`/admin/users/${id}`, rest, session.token);
      setEditingId(null);
      await loadUsers();
      flashNotice('User updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      await api.put(`/admin/users/${u.id}`, { is_active: u.is_active ? 0 : 1 }, session.token);
      await loadUsers();
      flashNotice(u.is_active ? 'Account disabled.' : 'Account enabled.');
    } catch (err) {
      setError(err.message);
    }
  }

  const isSelf = (u) => u.id === session.user.id;

  return (
    <Layout wide>
      <div className="section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="eyebrow">User Management</div>
          <h1>Users</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Cancel' : 'Add user'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {showCreate && (
        <div className="section card">
          <h2>New user</h2>
          <form onSubmit={handleCreate}>
            <div className="field-row">
              <div className="field">
                <label>Name</label>
                <input value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Phone</label>
                <input value={createForm.phone} onChange={(e) => setCreateForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={createForm.role} onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value }))}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Temporary password</label>
              <input type="password" minLength={6} value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} required />
            </div>
            <button className="btn btn-primary" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </div>
      )}

      <div className="section">
        {!users ? <p>Loading…</p> : (
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                editingId === u.id ? (
                  <tr key={u.id}>
                    <td><input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} /></td>
                    <td><input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} /></td>
                    <td>
                      <select value={editForm.role} disabled={isSelf(u)}
                        onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}>
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>
                    <td><input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} /></td>
                    <td>{u.is_active ? 'Active' : 'Disabled'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-primary" disabled={saving} onClick={() => handleSaveEdit(u.id)}>Save</button>{' '}
                      <button className="btn" onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>{u.role}</td>
                    <td>{u.phone || '—'}</td>
                    <td>{u.is_active ? 'Active' : <span style={{ color: 'var(--clay)' }}>Disabled</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn" onClick={() => startEdit(u)}>Edit</button>{' '}
                      <button className="btn" disabled={isSelf(u)} onClick={() => toggleActive(u)}>
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Layout>
  );
}
