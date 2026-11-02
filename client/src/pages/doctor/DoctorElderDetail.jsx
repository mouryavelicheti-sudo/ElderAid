import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Layout from '../../components/Layout';
import StatusBadge from '../../components/StatusBadge';

const EMPTY_MED = { name: '', dosage: '', frequency: '', time_slot: 'Morning', instructions: '' };
const RECORD_TYPES = ['General', 'Diagnosis', 'Lab Result', 'Vital Signs', 'Treatment', 'Other'];
const EMPTY_RECORD = { record_type: 'General', title: '', description: '' };

export default function DoctorElderDetail() {
  const { id } = useParams();
  const { session } = useAuth();
  const [elder, setElder] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [rxError, setRxError] = useState('');          // form-local errors (keeps the page visible)
  const [recordError, setRecordError] = useState('');
  const [recordFieldErrors, setRecordFieldErrors] = useState({});   // REQ-F-51
  const [editingRxId, setEditingRxId] = useState(null); // REQ-F-20: same form is reused for editing
  const rxFormRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [meds, setMeds] = useState([{ ...EMPTY_MED }]);

  const [recordForm, setRecordForm] = useState({ ...EMPTY_RECORD });
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [savingRecord, setSavingRecord] = useState(false);
  const [recordMsg, setRecordMsg] = useState('');

  const load = useCallback(() => {
    api.get(`/doctor/elders/${id}`, session.token).then(setElder).catch((e) => setError(e.message));
  }, [id, session.token]);

  useEffect(() => { load(); }, [load]);

  function updateMed(idx, field, value) {
    setMeds((m) => m.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }
  function addMed() { setMeds((m) => [...m, { ...EMPTY_MED }]); }
  function removeMed(idx) { setMeds((m) => m.filter((_, i) => i !== idx)); }

  function resetRxForm() {
    setEditingRxId(null); setNotes(''); setMeds([{ ...EMPTY_MED }]); setRxError('');
  }

  // Load an existing prescription into the SAME form for editing.
  function startEditRx(p) {
    setSuccess(''); setRxError('');
    setEditingRxId(p.id);
    setNotes(p.notes || '');
    setMeds(p.medications.map((m) => ({
      id: m.id, name: m.name, dosage: m.dosage, frequency: m.frequency,
      time_slot: m.time_slot, instructions: m.instructions || '',
    })));
    setTimeout(() => rxFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setRxError(''); setSuccess(''); setSaving(true);
    try {
      if (editingRxId) {
        const res = await api.put(`/doctor/prescriptions/${editingRxId}`, { notes, medications: meds }, session.token);
        setSuccess(res.changed === false ? 'No changes were made to the prescription.' : 'Prescription updated. The elder has been notified.');
      } else {
        await api.post('/doctor/prescriptions', { elder_id: Number(id), notes, medications: meds }, session.token);
        setSuccess('Prescription saved.');
      }
      resetRxForm();
      load();
    } catch (err) {
      setRxError(err.message);   // shown inside the form; the page stays intact
      rxFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setSaving(false);
    }
  }

  function startEditRecord(r) {
    setEditingRecordId(r.id);
    setRecordForm({ record_type: r.record_type, title: r.title, description: r.description || '' });
    setRecordMsg('');
  }

  async function handleRecordSubmit(e) {
    e.preventDefault();
    setRecordError(''); setRecordFieldErrors({}); setRecordMsg(''); setSavingRecord(true);
    try {
      if (editingRecordId) {
        await api.put(`/doctor/health-records/${editingRecordId}`, recordForm, session.token);
        setRecordMsg('Health record updated.');
      } else {
        await api.post(`/doctor/elders/${id}/health-records`, recordForm, session.token);
        setRecordMsg('Health record saved.');
      }
      setRecordForm({ ...EMPTY_RECORD });
      setEditingRecordId(null);
      load();
    } catch (err) {
      setRecordError(err.message);
      setRecordFieldErrors(err.fields || {});
    } finally {
      setSavingRecord(false);
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

      <div className="section card" style={{ maxWidth: 720 }} ref={rxFormRef}>
        <h3>{editingRxId ? 'Edit prescription' : 'New prescription'}</h3>
        {editingRxId && (
          <p className="field-hint" style={{ marginTop: 0 }}>
            Editing an existing prescription. Changing a medicine's time or frequency re-plans its schedule from now on;
            past check-in history is kept. The elder is notified of the change.
          </p>
        )}
        {success && <div className="alert alert-success">{success}</div>}
        {rxError && <div className="alert alert-error" role="alert">{rxError}</div>}
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
              {!m.id && meds.length > 1 && (
                <button type="button" className="btn btn-outline btn-sm" onClick={() => removeMed(idx)}>Remove medicine</button>
              )}
            </div>
          ))}

          <div className="btn-group" style={{ marginBottom: '1rem' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={addMed}>+ Add another medicine</button>
          </div>
          <p className="field-hint" style={{ marginTop: '-0.5rem', marginBottom: '1rem' }}>
            For a medicine taken more than once a day, add one row per time of day — each row becomes its own scheduled dose and reminder.
          </p>

          <div className="btn-group">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingRxId ? 'Update prescription' : 'Save prescription'}
            </button>
            {editingRxId && (
              <button type="button" className="btn btn-outline" onClick={resetRxForm} disabled={saving}>Cancel edit</button>
            )}
          </div>
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
                <div className="med-meta">
                  {new Date(p.created_at).toLocaleDateString()} · Dr. {p.doctor_name}
                  {p.updated_at && ' (edited)'}
                </div>
                {p.notes && <p style={{ fontStyle: 'italic' }}>{p.notes}</p>}
                <ul>
                  {p.medications.map((m) => (
                    <li key={m.id}>{m.name} · {m.dosage} · {m.frequency} · {m.time_slot}</li>
                  ))}
                </ul>
                {p.doctor_id === session.user.id ? (
                  <button className="btn btn-outline btn-sm" onClick={() => startEditRx(p)}>Edit prescription</button>
                ) : (
                  <span className="med-meta">Only Dr. {p.doctor_name} can edit this prescription.</span>
                )}
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

      <div className="section card" style={{ maxWidth: 720 }}>
        <h3>{editingRecordId ? 'Edit health record' : 'New health record'}</h3>
        {recordMsg && <div className="alert alert-success">{recordMsg}</div>}
        {recordError && <div className="alert alert-error" role="alert">{recordError}</div>}
        <form onSubmit={handleRecordSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="rectype">Record type</label>
              <select id="rectype" className={recordFieldErrors.record_type ? 'invalid' : undefined} value={recordForm.record_type}
                onChange={(e) => setRecordForm({ ...recordForm, record_type: e.target.value })}>
                {RECORD_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              {recordFieldErrors.record_type && <div className="field-error" role="alert">{recordFieldErrors.record_type}</div>}
            </div>
            <div className="field">
              <label htmlFor="rectitle">Title</label>
              <input id="rectitle" className={recordFieldErrors.title ? 'invalid' : undefined} value={recordForm.title} required
                onChange={(e) => setRecordForm({ ...recordForm, title: e.target.value })}
                placeholder="e.g. Blood pressure review" />
              {recordFieldErrors.title && <div className="field-error" role="alert">{recordFieldErrors.title}</div>}
            </div>
          </div>
          <div className="field">
            <label htmlFor="recdesc">Details</label>
            <textarea id="recdesc" rows={3} className={recordFieldErrors.description ? 'invalid' : undefined} value={recordForm.description}
              onChange={(e) => setRecordForm({ ...recordForm, description: e.target.value })}
              placeholder="Findings, measurements, treatment notes…" />
            {recordFieldErrors.description
              ? <div className="field-error" role="alert">{recordFieldErrors.description}</div>
              : <div className="field-hint">{(recordForm.description || '').length}/2000 characters · title up to 150</div>}
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" type="submit" disabled={savingRecord}>
              {savingRecord ? 'Saving…' : editingRecordId ? 'Update record' : 'Save record'}
            </button>
            {editingRecordId && (
              <button type="button" className="btn btn-outline"
                onClick={() => { setEditingRecordId(null); setRecordForm({ ...EMPTY_RECORD }); }}>
                Cancel edit
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="section">
        <h2>Health records</h2>
        {(elder.healthRecords || []).length === 0 ? (
          <div className="empty-state">No health records yet.</div>
        ) : (
          <div className="list">
            {elder.healthRecords.map((r) => (
              <div className="card" key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0 }}>{r.title}</h3>
                  <span className="status-badge status-Completed">{r.record_type}</span>
                </div>
                <div className="med-meta" style={{ margin: '0.25rem 0 0.5rem' }}>
                  Dr. {r.doctor_name} · {new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleString()}
                  {r.updated_at !== r.created_at && ' (edited)'}
                </div>
                {r.description && <p style={{ margin: '0 0 0.5rem' }}>{r.description}</p>}
                {r.doctor_id === session.user.id && (
                  <button className="btn btn-outline btn-sm" onClick={() => startEditRecord(r)}>Edit</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
