// Shows EXTERNAL delivery (SMS to the emergency contact), clearly separate from in-app
// notifications. Statuses come straight from the server: PENDING / DELIVERED / FAILED.
// A message is only described as sent when the server reports DELIVERED.
const EXPLAIN = {
  DELIVERED: 'The text message was accepted by the SMS gateway.',
  PENDING: 'Sending… delivery is not confirmed yet.',
  FAILED: 'No text message was sent. Please call this person directly.',
};

export default function ContactDelivery({ deliveries, inApp, audience = 'elder' }) {
  if (!deliveries || deliveries.length === 0) return null;
  return (
    <div className="delivery-box">
      {inApp && (
        <div className="med-meta" style={{ marginBottom: '0.4rem' }}>
          <span className="channel-chip">In-app</span>{' '}
          {audience === 'elder'
            ? 'Your assigned caregivers and the care team were alerted inside ElderAid.'
            : 'Caregivers and administrators were alerted inside ElderAid.'}
        </div>
      )}
      {deliveries.map((d) => (
        <div key={d.id} style={{ marginTop: '0.3rem' }}>
          <div className="delivery-row">
            <span className="channel-chip">External · {d.channel}</span>
            <strong>{d.recipient_name || 'No emergency contact on file'}</strong>
            {d.recipient_contact && <span className="med-meta">({d.recipient_contact})</span>}
            <span className={`status-badge status-${d.delivery_status === 'PENDING' ? 'PENDING_DELIVERY' : d.delivery_status}`}>
              {d.delivery_status}
            </span>
          </div>
          <div className="med-meta">
            {EXPLAIN[d.delivery_status]}
            {d.delivery_status !== 'DELIVERED' && d.delivery_error ? ` (${d.delivery_error})` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}
