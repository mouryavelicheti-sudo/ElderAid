import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';

const EMPTY = {
  name: '', phone: '', dob: '', address: '', blood_group: '',
  emergency_contact_name: '', emergency_contact_phone: '', notes: '',
};

export default function ElderProfile() {
  const { session } = useAuth();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/elder/profile', session.token)
      .then((d) => setForm({ ...EMPTY, ...d }))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [session.token]);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.put('/elder/profile', form, session.token);
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout>
      <div className="section">
        <div className="eyebrow">My Profile</div>
        <h1>Personal information</h1>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form className="card" onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" value={form.name} onChange={(e) => update('name', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" value={form.phone || ''} onChange={(e) => update('phone', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Email</label>
          <input value={form.email || ''} disabled />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="dob">Date of birth</label>
            <input id="dob" type="date" value={form.dob || ''} onChange={(e) => update('dob', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="blood">Blood group</label>
            <input id="blood" value={form.blood_group || ''} onChange={(e) => update('blood_group', e.target.value)} placeholder="e.g. B+" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="address">Address</label>
          <textarea id="address" rows={2} value={form.address || ''} onChange={(e) => update('address', e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="ecname">Emergency contact name</label>
            <input id="ecname" value={form.emergency_contact_name || ''} onChange={(e) => update('emergency_contact_name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ecphone">Emergency contact phone</label>
            <input id="ecphone" value={form.emergency_contact_phone || ''} onChange={(e) => update('emergency_contact_phone', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Health notes</label>
          <textarea id="notes" rows={2} value={form.notes || ''} onChange={(e) => update('notes', e.target.value)} />
        </div>

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </Layout>
  );
}
