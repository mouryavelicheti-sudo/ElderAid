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
  const [fieldErrors, setFieldErrors] = useState({});
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
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: undefined }));
  }

  // Small helper: red outline + message under a field when the server rejected it.
  const cls = (f) => (fieldErrors[f] ? 'invalid' : undefined);
  const FieldError = ({ name }) => (fieldErrors[name]
    ? <div className="field-error" role="alert">{fieldErrors[name]}</div> : null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setFieldErrors({}); setSaving(true);
    try {
      const res = await api.put('/elder/profile', form, session.token);
      // Show the values exactly as the server stored them (trimmed / normalised).
      if (res && res.profile) setForm((f) => ({ ...f, ...res.profile }));
      setSuccess('Profile updated.');
    } catch (err) {
      // REQ-F-17: show the server's validation message, and mark the offending fields.
      setError(err.message);
      setFieldErrors(err.fields || {});
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <form className="card" onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
        <div className="field-row">
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" className={cls('name')} aria-invalid={!!fieldErrors.name} value={form.name} onChange={(e) => update('name', e.target.value)} required />
            <FieldError name="name" />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" className={cls('phone')} aria-invalid={!!fieldErrors.phone} value={form.phone || ''} onChange={(e) => update('phone', e.target.value)} placeholder="e.g. +91 98765 43210" />
            <FieldError name="phone" />
          </div>
        </div>

        <div className="field">
          <label>Email</label>
          <input value={form.email || ''} disabled />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="dob">Date of birth</label>
            <input id="dob" type="date" className={cls('dob')} aria-invalid={!!fieldErrors.dob} value={form.dob || ''} onChange={(e) => update('dob', e.target.value)} />
            <FieldError name="dob" />
          </div>
          <div className="field">
            <label htmlFor="blood">Blood group</label>
            <input id="blood" className={cls('blood_group')} aria-invalid={!!fieldErrors.blood_group} value={form.blood_group || ''} onChange={(e) => update('blood_group', e.target.value)} placeholder="e.g. B+ (A, B, AB or O with + or −)" />
            <FieldError name="blood_group" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="address">Address</label>
          <textarea id="address" rows={2} className={cls('address')} aria-invalid={!!fieldErrors.address} value={form.address || ''} onChange={(e) => update('address', e.target.value)} />
          <FieldError name="address" />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="ecname">Emergency contact name</label>
            <input id="ecname" className={cls('emergency_contact_name')} aria-invalid={!!fieldErrors.emergency_contact_name} value={form.emergency_contact_name || ''} onChange={(e) => update('emergency_contact_name', e.target.value)} />
            <FieldError name="emergency_contact_name" />
          </div>
          <div className="field">
            <label htmlFor="ecphone">Emergency contact phone</label>
            <input id="ecphone" className={cls('emergency_contact_phone')} aria-invalid={!!fieldErrors.emergency_contact_phone} value={form.emergency_contact_phone || ''} onChange={(e) => update('emergency_contact_phone', e.target.value)} />
            <FieldError name="emergency_contact_phone" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Health notes</label>
          <textarea id="notes" rows={2} className={cls('notes')} aria-invalid={!!fieldErrors.notes} value={form.notes || ''} onChange={(e) => update('notes', e.target.value)} />
          <FieldError name="notes" />
        </div>

        <p className="field-hint" style={{ marginBottom: '0.75rem' }}>
          Your emergency contact is the person ElderAid tries to alert by text message when you press SOS.
        </p>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </Layout>
  );
}
