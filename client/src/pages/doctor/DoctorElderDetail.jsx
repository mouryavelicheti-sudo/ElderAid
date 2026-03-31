import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

const EMPTY_MED = { name: '', dosage: '', frequency: '', time_slot: 'Morning', instructions: '' };

export default function DoctorElderDetail() {
  const { id } = useParams();
  const { session } = useAuth();
  const [elder, setElder] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [meds, setMeds] = useState([{ ...EMPTY_MED }]);

  const load = useCallback(() => {
    api.get(`/doctor/elders/${id}`, session.token).then(setElder).catch((e) => setError(e.message));
  }, [id, session.token]);

  useEffect(() => { load(); }, [load]);

  function updateMed(idx, field, value) {
    setMeds((m) => m.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }
  function addMed() { setMeds((m) => [...m, { ...EMPTY_MED }]); }
  function removeMed(idx) { setMeds((m) => m.filter((_, i) => i !== idx)); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setSaving(true);
    try {
      await api.post('/doctor/prescriptions', { elder_id: Number(id), notes, medications: meds }, session.token);
      setSuccess('Prescription saved.');
      setNotes('');
      setMeds([{ ...EMPTY_MED }]);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <Layout><div className="alert alert-error">{error}</div></Layout>;
  if (!elder) return <Layout><p>Loading…</p></Layout>;

  return (
    <Layout wide>
      <Link to="/doctor/elders" style={{ fontSize: '0.9rem' }}>← Back to elders</Link>
      <div className="section">
        <div className="eyebrow">Elder Profile</div>
        <h1>{elder.name}</h1>
        <p style={{ color: 'var(--ink-soft)' }}>
          {elder.dob ? `DOB: ${elder.dob} · ` : ''}{elder.blood_group ? `Blood group: ${elder.blood_group} · ` : ''}{elder.phone}
        </p>
        {elder.notes && <p><strong>Notes:</strong> {elder.notes}</p>}
      </div>

      <div className="section card" style={{ maxWidth: 720 }}>
        <h3>New prescription</h3>
        {success && <div className="alert alert-success">{success}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="rxnotes">Notes</label>
            <textarea id="rxnotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Recheck BP in 2 weeks" />
          </div>

          {meds.map((m, idx) => (
            <div key={idx} className="card" style={{ background: 'var(--paper)', marginBottom: '0.75rem' }}>
              <div className="field-row">
                <div className="field">
                  <label>Medicine name</label>
                  <input value={m.name} onChange={(e) => updateMed(idx, 'name', e.target.value)} required />
                </div>
                <div className="field">
                  <label>Dosage</label>
                  <input value={m.dosage} onChange={(e) => updateMed(idx, 'dosage', e.target.value)} placeholder="e.g. 5mg" required />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label>Frequency</label>
                  <input value={m.frequency} onChange={(e) => updateMed(idx, 'frequency', e.target.value)} placeholder="e.g. Once daily" required />
                </div>
                <div className="field">
                  <label>Time of day</label>
                  <select value={m.time_slot} onChange={(e) => updateMed(idx, 'time_slot', e.target.value)}>
                    <option>Morning</option><option>Afternoon</option><option>Evening</option><option>Night</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Instructions</label>
                <input value={m.instructions} onChange={(e) => updateMed(idx, 'instructions', e.target.value)} placeholder="e.g. Take after food" />
              </div>
              {meds.length > 1 && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => removeMed(idx)}>Remove medicine</button>
              )}
            </div>
          ))}

          <div className="btn-group" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={addMed}>+ Add another medicine</button>
          </div>

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save prescription'}
          </button>
        </form>
      </div>

      <div className="section">
        <h2>Prescription history</h2>
        {elder.prescriptions.length === 0 ? (
          <div className="empty-state">No prescriptions yet.</div>
        ) : (
          <div className="list">
            {elder.prescriptions.map((p) => (
              <div className="card" key={p.id}>
                <div className="med-meta">{new Date(p.created_at).toLocaleDateString()}</div>
                {p.notes && <p style={{ fontStyle: 'italic' }}>{p.notes}</p>}
                <ul>
                  {p.medications.map((m) => (
                    <li key={m.id}>{m.name} · {m.dosage} · {m.frequency} · {m.time_slot}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section">
        <h2>Appointments</h2>
        {elder.appointments.length === 0 ? (
          <div className="empty-state">No appointments yet.</div>
        ) : (
          <div className="list">
            {elder.appointments.map((a) => (
              <div className="list-item" key={a.id}>
                <div>{a.appt_date} at {a.appt_time}{a.reason ? ` — ${a.reason}` : ''}</div>
                <StatusBadge status={a.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
