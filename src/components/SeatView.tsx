import { type CSSProperties } from 'react';
import { Card, Seat, Street } from '../nlheEngine';
import { getSeatPosition, seatAngleForIndex } from '../seatGeometry';
import { formatMoney } from '../utils/format';
import { CardView } from './CardView';
import { ChipStacksView } from './ChipViews';

export function getChipPosition(seatAngle: number, tableCenter: { x: number; y: number }, seatRadius: number) {
  // Chips sit at ~44% of the table radius — between the board edge (~21) and the seat panels (~32)
  return getSeatPosition(seatAngle, tableCenter, seatRadius * 0.44);
}

export function SeatView({ seat, street, reveal, positionLabel, isButton, isThinking, style }: {
  seat: Seat;
  street: Street;
  reveal: boolean;
  positionLabel: string;
  isButton: boolean;
  isThinking?: boolean;
  style?: CSSProperties;
}) {
  const isCurrent = seat.status === 'active' && seat.lastAction.toLowerCase().includes('waiting');
  return (
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''} ${seat.status === 'folded' ? 'seat-folded' : ''} ${isCurrent ? 'seat-current' : ''}`} aria-label={`${seat.name} seat`} style={style}>
      <div>
        <div className="seat-topline">
          <strong>{seat.name}</strong>
          <span className="seat-position-group">
            {positionLabel && <span className="seat-position-label">{positionLabel}</span>}
            {isButton && <span className="dealer-chip" aria-label="dealer button">D</span>}
          </span>
        </div>
        <p>{isThinking ? <span className="seat-thinking" aria-label="Bot is thinking">Thinking…</span> : seat.status === 'folded' ? 'Folded' : seat.status === 'all-in' ? 'All-in' : seat.lastAction}</p>
      </div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>
        {seat.cards.map((card: Card, index: number) => <CardView key={`${seat.id}-${street}-${index}`} card={card} hidden={!reveal} />)}
      </div>
      <dl className="seat-money">
        <div><dt>Stack</dt><dd>{formatMoney(seat.stack)}</dd></div>
        <div><dt>In pot</dt><dd>{formatMoney(seat.streetContribution)}</dd></div>
      </dl>
    </article>
  );
}

export function PlayerBetChips({ seat, seatAngle }: { seat: Seat; seatAngle: number }) {
  if (seat.streetContribution <= 0) return null;
  const position = getChipPosition(seatAngle, { x: 50, y: 50 }, 50);
  return (
    <div className="player-bet-chips" style={{ left: `${position.x}%`, top: `${position.y}%` }}>
      <ChipStacksView amount={seat.streetContribution} />
    </div>
  );
}

export { seatAngleForIndex };
