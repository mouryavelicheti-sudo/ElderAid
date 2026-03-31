import StatusBadge from './StatusBadge';

const SLOT_ORDER = ['Morning', 'Afternoon', 'Evening', 'Night'];

export default function CheckinRibbon({ medications, onMark, busyId }) {
  if (!medications || medications.length === 0) {
    return (
      <div className="empty-state">
        No medications scheduled today. Your doctor's prescriptions will appear here.
      </div>
    );
  }

  const bySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meds: medications.filter((m) => m.time_slot === slot),
  })).filter((s) => s.meds.length > 0);

  return (
    <div className="checkin-ribbon">
      {bySlot.map(({ slot, meds }) => (
        <div className="checkin-slot" key={slot}>
          <div className="slot-label">{slot}</div>
          {meds.map((m) => (
            <div className="med-row" key={m.id}>
              <div className="med-info">
                <div className="med-name">{m.name} <span className="med-meta">{m.dosage}</span></div>
                <div className="med-meta">{m.frequency}{m.instructions ? ` · ${m.instructions}` : ''}</div>
                {onMark ? (
                  <div className="btn-group" style={{ marginTop: '0.5rem' }}>
                    <button
                      className="btn btn-sm btn-taken"
                      disabled={busyId === m.id || m.status === 'Taken'}
                      onClick={() => onMark(m.id, 'Taken')}
                    >
                      ✓ Taken
                    </button>
                    <button
                      className="btn btn-sm btn-missed"
                      disabled={busyId === m.id || m.status === 'Missed'}
                      onClick={() => onMark(m.id, 'Missed')}
                    >
                      ✕ Missed
                    </button>
                  </div>
                ) : (
                  <div style={{ marginTop: '0.4rem' }}>
                    <StatusBadge status={m.status} />
                  </div>
                )}
              </div>
              {onMark && <StatusBadge status={m.status} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
