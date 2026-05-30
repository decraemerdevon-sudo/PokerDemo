import { DEFAULT_BUY_IN } from '../nlheEngine';
import { formatMoney } from '../utils/format';

export type RecoveryNotice = {
  tone: 'info' | 'warning';
  message: string;
};

export function RebuyModal({ onRebuy }: { onRebuy: () => void }) {
  return (
    <div className="rebuy-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rebuy-modal-title">
      <div className="rebuy-modal">
        <p className="eyebrow">Bankroll</p>
        <h2 id="rebuy-modal-title">You're out of chips</h2>
        <p className="rebuy-modal-sub">Your stack hit zero. Rebuy to keep playing.</p>
        <button className="rebuy-primary rebuy-modal-btn" onClick={onRebuy} type="button">
          Rebuy {formatMoney(DEFAULT_BUY_IN)}
        </button>
      </div>
    </div>
  );
}

export function RebuyPanel({
  canRebuy,
  heroStack,
  playableSeats,
  notice,
  addOnAmount,
  addOnQueued,
  onAddOnToggle,
  onRebuy,
  onAddOnAmountChange,
}: {
  canRebuy: boolean;
  heroStack: number;
  playableSeats: number;
  notice: RecoveryNotice | null;
  addOnAmount: number;
  addOnQueued: boolean;
  onAddOnToggle: () => void;
  onRebuy: () => void;
  onAddOnAmountChange: (amount: number) => void;
}) {
  const heroBusted = heroStack <= 0;
  const addOnAvailable = heroStack < DEFAULT_BUY_IN;
  const minAddOn = 100;
  const maxAddOn = Math.max(minAddOn, DEFAULT_BUY_IN - heroStack);
  const clampedAddOn = Math.min(addOnAmount, maxAddOn);
  return (
    <section className="rebuy-panel" aria-labelledby="rebuy-title">
      <div>
        <p className="eyebrow">Bankroll</p>
        <h2 id="rebuy-title">Rebuy and Add-on</h2>
      </div>
      <dl className="rebuy-summary">
        <div><dt>Your stack</dt><dd>{formatMoney(heroStack)}</dd></div>
        <div><dt>Live seats</dt><dd>{playableSeats}</dd></div>
      </dl>
      {notice && <p className={`rebuy-notice rebuy-notice-${notice.tone}`} role="status">{notice.message}</p>}
      <div className="rebuy-actions">
        <button className="rebuy-primary" disabled={!canRebuy || !heroBusted} onClick={onRebuy} type="button">Rebuy {formatMoney(DEFAULT_BUY_IN)}</button>
        <div className="addon-section">
          <button
            className={`rebuy-secondary${addOnQueued ? ' addon-queued-btn' : ''}`}
            disabled={!addOnAvailable}
            onClick={onAddOnToggle}
            type="button"
          >
            {addOnQueued ? `✓ Add-on ${formatMoney(clampedAddOn)} queued` : `Add-on ${formatMoney(clampedAddOn)}`}
          </button>
          <input
            aria-label="Add-on amount"
            className="addon-slider"
            disabled={!addOnAvailable}
            max={maxAddOn}
            min={minAddOn}
            onChange={(e) => onAddOnAmountChange(Number(e.target.value))}
            step={1}
            type="range"
            value={clampedAddOn}
          />
          <div className="addon-range-labels"><span>{formatMoney(minAddOn)}</span><span>{formatMoney(maxAddOn)}</span></div>
        </div>
      </div>
    </section>
  );
}
