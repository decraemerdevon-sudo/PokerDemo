import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionKind,
  Card,
  HandEvent,
  HandState,
  Seat,
  Street,
  chooseBotAction,
  createInitialTable,
  createNextHand,
  getSeatLabel,
  getLegalActions,
  potSize,
  submitAction,
  syncTableFromHand,
  visibleBoard,
} from './nlheEngine';
import { trackHandHistoryEvent } from './handHistoryAnalytics';
import { appendCompletedHand, calculateSessionStats, HandRecord, loadSessionHistory, PlayerSessionStats, StreetKey } from './handHistory';

type TableMode = 'play' | 'review';
type CoachState = 'idle' | 'loading' | 'ready' | 'error';
type ChipDenomination = {
  value: number;
  color: string;
  borderColor: string;
  label: string;
};
type ChipStack = {
  denomination: ChipDenomination;
  count: number;
};
type CustomBetState = {
  isOpen: boolean;
  value: number;
  min: number;
  max: number;
};

const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1000, color: '#FFD700', borderColor: '#B8860B', label: '1K' },
  { value: 100, color: '#1a1a1a', borderColor: '#555555', label: '100' },
  { value: 25, color: '#228B22', borderColor: '#145214', label: '25' },
  { value: 5, color: '#CC0000', borderColor: '#8B0000', label: '5' },
  { value: 1, color: '#F5F5F5', borderColor: '#AAAAAA', label: '1' },
];
const fourSeatAngles = [315, 45, 225, 135];

const suitLabels: Record<Card['suit'], string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const suitSymbols: Record<Card['suit'], string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

function breakIntoChips(amount: number): ChipStack[] {
  let remaining = Math.max(0, Math.floor(amount));
  const stacks: ChipStack[] = [];

  CHIP_DENOMINATIONS.forEach((denomination) => {
    if (remaining <= 0) return;
    const count = Math.floor(remaining / denomination.value);
    if (count > 0) {
      stacks.push({ denomination, count });
      remaining -= count * denomination.value;
    }
  });

  if (remaining !== 0) console.warn(`Unable to render exact chip amount; ${remaining} remains.`);
  return stacks;
}

function getChipPosition(seatAngle: number, tableCenter: { x: number; y: number }, seatRadius: number) {
  const chipOffset = seatRadius * 0.38;
  const angleRad = (seatAngle - 90) * (Math.PI / 180);
  return {
    x: tableCenter.x + (seatRadius - chipOffset) * Math.cos(angleRad),
    y: tableCenter.y + (seatRadius - chipOffset) * Math.sin(angleRad),
  };
}

function seatAngleForIndex(index: number, seatCount: number) {
  if (seatCount === 4) return fourSeatAngles[index] ?? 0;
  return (index * 360) / Math.max(seatCount, 1);
}

function texture(cards: Card[]) {
  if (cards.length < 3) return 'no board yet; preflop ranges and position dominate';
  const suitCounts = cards.reduce<Record<Card['suit'], number>>((counts, card) => ({ ...counts, [card.suit]: counts[card.suit] + 1 }), { spades: 0, hearts: 0, diamonds: 0, clubs: 0 });
  const paired = new Set(cards.map((card) => card.rank)).size < cards.length;
  const flushy = Object.values(suitCounts).some((count) => count >= 3);
  const broadway = cards.filter((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank)).length >= 2;
  return `${paired ? 'paired' : 'unpaired'}, ${flushy ? 'flush-heavy' : 'rainbow/two-tone'}, ${broadway ? 'broadway-connected' : 'low-card'} texture`;
}

function cardText(cards: Card[]) {
  return cards.map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ');
}

function signedMoney(value: number) {
  if (value === 0) return '$0';
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

function clampWholeChip(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function buildCoachAdvice(state: HandState) {
  const hero = state.seats.find((seat) => seat.isHero)!;
  const legal = getLegalActions(state, hero.id);
  const board = visibleBoard(state);
  const boardText = cardText(board) || 'not dealt';
  const actionText = legal.length ? legal.map((action) => action.label).join(', ') : 'none';
  const recent = state.events.slice(-4).map((event) => `${event.actor} ${event.action}${event.amount ? ` ${formatMoney(event.amount)}` : ''}`).join(', ');
  return `Hero holds ${cardText(hero.cards)} on ${state.street.toLowerCase()} with ${formatMoney(potSize(state))} in the pot. Board: ${boardText} (${texture(board)}). Legal actions: ${actionText}. Recent action: ${recent || 'none'}.`;
}

function CardView({ card, hidden = false }: { card: Card; hidden?: boolean }) {
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <span className={`card ${isRed ? 'card-red' : 'card-black'} ${hidden ? 'card-hidden' : ''}`}>
      <span className="card-rank">{hidden ? '?' : card.rank}</span>
      <span aria-hidden="true" className="card-suit">{hidden ? '*' : suitSymbols[card.suit]}</span>
      <span className="sr-only">{hidden ? 'hidden card' : `${card.rank} of ${card.suit}`}</span>
      {!hidden && <span className="suit-code">{suitLabels[card.suit]}</span>}
    </span>
  );
}

function ChipStackView({ stack, size }: { stack: ChipStack; size: 'player' | 'pot' }) {
  const visibleCount = Math.min(stack.count, 10);
  const labelColor = stack.denomination.value === 1 || stack.denomination.value === 1000 ? '#17130c' : '#fffdf7';
  return (
    <div className="chip-stack" aria-label={`${stack.count} ${stack.denomination.label} chips`}>
      {stack.count > visibleCount && <span className="chip-count">x{stack.count}</span>}
      <div className={`chip-column chip-column-${size}`}>
        {Array.from({ length: visibleCount }, (_, index) => (
          <span
            aria-hidden="true"
            className="casino-chip"
            key={`${stack.denomination.value}-${index}`}
            style={{
              backgroundColor: stack.denomination.color,
              borderColor: stack.denomination.borderColor,
              color: labelColor,
              bottom: index * (size === 'player' ? 4 : 3),
              zIndex: index,
            }}
          >
            {index === visibleCount - 1 ? stack.denomination.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChipStacksView({ amount, label, size = 'player' }: { amount: number; label?: string; size?: 'player' | 'pot' }) {
  const stacks = breakIntoChips(amount);
  if (!stacks.length) return null;
  return (
    <div className={`chip-display chip-display-${size}`} aria-label={`${label ? `${label}: ` : ''}${formatMoney(amount)} in chips`}>
      {label && <span className="chip-display-label">{label}</span>}
      <div className="chip-stacks">
        {stacks.map((stack) => <ChipStackView key={stack.denomination.value} stack={stack} size={size} />)}
      </div>
      <strong>{formatMoney(amount)}</strong>
    </div>
  );
}

function SeatView({ seat, street, reveal, positionLabel, isButton }: { seat: Seat; street: Street; reveal: boolean; positionLabel: string; isButton: boolean }) {
  const isCurrent = seat.status === 'active' && seat.lastAction.toLowerCase().includes('waiting');
  return (
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''} ${seat.status === 'folded' ? 'seat-folded' : ''} ${isCurrent ? 'seat-current' : ''}`} aria-label={`${seat.name} seat`}>
      <div>
        <div className="seat-topline">
          <strong>{seat.name}</strong>
          <span className="seat-position-group">
            {positionLabel && <span className="seat-position-label">{positionLabel}</span>}
            {isButton && <span className="dealer-chip" aria-label="dealer button">D</span>}
          </span>
        </div>
        <p>{seat.status === 'folded' ? 'Folded' : seat.status === 'all-in' ? 'All-in' : seat.lastAction}</p>
      </div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>
        {seat.cards.map((card, index) => <CardView key={`${seat.id}-${street}-${index}`} card={card} hidden={!reveal} />)}
      </div>
      <dl className="seat-money">
        <div><dt>Stack</dt><dd>{formatMoney(seat.stack)}</dd></div>
        <div><dt>In pot</dt><dd>{formatMoney(seat.contribution)}</dd></div>
      </dl>
    </article>
  );
}

function formatEventAmount(event: HandEvent) {
  return event.amount ? formatMoney(event.amount) : '';
}

function eventTimeLabel(events: HandEvent[], index: number) {
  const newerCount = events.length - index - 1;
  return newerCount === 0 ? 'now' : `${newerCount} ago`;
}

function streetDividerLabel(event: HandEvent) {
  if (event.action !== 'Deal street') return event.street;
  const dealt = event.note.replace(/^Burned one and dealt /, '').replace(/\. Betting round.*$/, '');
  return `${event.street} - ${dealt}`;
}

function ActionFeed({ events, selectedEvent, onSelect, onKeyDown }: {
  events: HandEvent[];
  selectedEvent: number;
  onSelect: (index: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const feedEvents = events.map((event, index) => ({ event, index })).reverse();
  let previousStreet: Street | null = null;

  return (
    <div aria-label="Current hand action feed" className="timeline action-feed" onKeyDown={onKeyDown} role="listbox" tabIndex={0}>
      {feedEvents.map(({ event, index }) => {
        const showStreetDivider = event.street !== previousStreet;
        previousStreet = event.street;
        return (
          <div className="action-feed-group" key={event.id}>
            {showStreetDivider && (
              <div className="street-divider" aria-label={`${event.street} street`}>
                <span>{streetDividerLabel(event)}</span>
              </div>
            )}
            <button aria-selected={selectedEvent === index} className={selectedEvent === index ? 'timeline-item action-feed-item active' : 'timeline-item action-feed-item'} onClick={() => onSelect(index)} role="option" type="button">
              <span className="action-position">{event.position ?? ''}</span>
              <strong>{event.actor}</strong>
              <span>{event.action}</span>
              <span>{formatEventAmount(event)}</span>
              <time>{eventTimeLabel(events, index)}</time>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PlayerBetChips({ seat, seatAngle }: { seat: Seat; seatAngle: number }) {
  if (seat.streetContribution <= 0) return null;
  const position = getChipPosition(seatAngle, { x: 50, y: 50 }, 56);
  return (
    <div className="player-bet-chips" style={{ left: `${position.x}%`, top: `${position.y}%` }}>
      <ChipStacksView amount={seat.streetContribution} label={seat.name} />
    </div>
  );
}

function HiddenCards() {
  return <span className="hidden-cards" aria-label="hidden hole cards">[? ?]</span>;
}

function HistoryCards({ cards }: { cards: Card[] | null }) {
  if (!cards) return <HiddenCards />;
  return <span className="history-cards">{cards.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} />)}</span>;
}

function streetTitle(street: StreetKey, hand: HandRecord) {
  if (street === 'flop') return `FLOP ${hand.flopCards ? `[${cardText(hand.flopCards)}]` : ''}`;
  if (street === 'turn') return `TURN ${hand.turnCard ? `[${cardText([hand.turnCard])}]` : ''}`;
  if (street === 'river') return `RIVER ${hand.riverCard ? `[${cardText([hand.riverCard])}]` : ''}`;
  return 'PREFLOP';
}

function HandHistoryPanel({
  history,
  selectedHandId,
  setSelectedHandId,
  stats,
  onClose,
}: {
  history: HandRecord[];
  selectedHandId: string | null;
  setSelectedHandId: (handId: string) => void;
  stats: PlayerSessionStats[];
  onClose: () => void;
}) {
  const selected = history.find((hand) => hand.handId === selectedHandId) ?? history[0] ?? null;
  const heroId = selected?.players.find((player) => player.isHero)?.playerId;

  return (
    <aside className="hand-history-panel" aria-label="Hand history panel">
      <header className="hand-history-header">
        <div><p className="eyebrow">Session</p><h2>Hand History</h2></div>
        <button onClick={onClose} type="button" aria-label="Close hand history">Close</button>
      </header>
      <div className="hand-history-content">
        <section className="session-stats" aria-labelledby="session-stats-title">
          <h3 id="session-stats-title">Session Stats</h3>
          <div className="stats-table" role="table" aria-label="Session statistics">
            <div className="stats-row stats-head" role="row"><span>Player</span><span>VPIP</span><span>PFR</span><span>Net</span></div>
            {stats.map((stat) => (
              <div className="stats-row" role="row" key={stat.playerId}>
                <strong>{stat.displayName}</strong><span>{stat.VPIP}%</span><span>{stat.PFR}%</span><span className={stat.totalNetChips >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(stat.totalNetChips)}</span>
              </div>
            ))}
          </div>
          <details>
            <summary>Full Stats</summary>
            <div className="full-stats">
              {stats.map((stat) => (
                <dl key={stat.playerId}>
                  <dt>{stat.displayName}</dt>
                  <dd>3Bet {stat.threebet}%</dd><dd>Fold 3Bet {stat.foldTo3bet}%</dd><dd>AF {stat.AF}</dd><dd>CBet {stat.CBet_flop}%</dd><dd>WTSD {stat.WTSD}%</dd><dd>WSD {stat.WSD}%</dd><dd>bb/100 {stat.bbPer100}</dd>
                </dl>
              ))}
            </div>
          </details>
        </section>
        <section className="hand-list" aria-labelledby="hand-list-title">
          <h3 id="hand-list-title">Hand List</h3>
          {history.length === 0 ? <p className="muted">Completed hands will appear here.</p> : history.map((hand) => {
            const hero = hand.players.find((player) => player.isHero);
            const winnerNames = hand.pots.map((pot) => hand.players.find((player) => player.playerId === pot.winnerId)?.displayName ?? 'Unknown').join(', ');
            return (
              <button className={selected?.handId === hand.handId ? 'hand-list-item active' : 'hand-list-item'} key={hand.handId} onClick={() => setSelectedHandId(hand.handId)} type="button">
                <strong>#{hand.handNumber}</strong><span>{winnerNames} won</span>{hero && <em className={hero.netResult >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(hero.netResult)}</em>}
              </button>
            );
          })}
        </section>
        <section className="hand-detail" aria-labelledby="hand-detail-title">
          {!selected ? <div className="empty-state"><strong>No hands yet</strong><p>Play a hand to populate the append-only session log.</p></div> : (
            <>
              <h3 id="hand-detail-title">Hand #{selected.handNumber}</h3>
              <p className="position-line">{selected.players.map((player) => `${player.position}: ${player.displayName}`).join(' | ')}</p>
              <div className="player-snapshots">
                {selected.players.map((player) => (
                  <div className="player-snapshot" key={player.playerId}>
                    <strong>{player.displayName}</strong><HistoryCards cards={player.holeCards} />
                    <span>Stack: {formatMoney(player.stackAtHandStart)} to {formatMoney(player.finalStack)}</span>
                    <em className={player.netResult >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(player.netResult)}</em>
                    {player.foldedStreet && <small>folded {player.foldedStreet}</small>}
                  </div>
                ))}
              </div>
              {(['preflop', 'flop', 'turn', 'river'] as StreetKey[]).map((street) => {
                const record = selected.streets[street];
                if (!record) return null;
                return (
                  <div className="street-block" key={street}>
                    <h4>{streetTitle(street, selected)}</h4>
                    {record.actions.length === 0 ? <p className="muted">No actions.</p> : record.actions.map((action, index) => (
                      <div className="history-action" key={`${street}-${action.playerId}-${index}`}>
                        <span>{action.position}</span><strong>{action.displayName}</strong><span>{action.actionType.replace('-', ' ')}</span>
                        <span>{action.amount ? formatMoney(action.amount) : ''}</span>
                        <em>{action.betSizingPct ? `${Math.round(action.betSizingPct * 100)}% pot` : ''}</em>
                        <small>Pot: {formatMoney(action.potAfter)}</small>
                      </div>
                    ))}
                  </div>
                );
              })}
              <div className="street-block result-block">
                <h4>RESULT</h4>
                {selected.pots.map((pot) => {
                  const winner = selected.players.find((player) => player.playerId === pot.winnerId);
                  const heroNet = selected.players.find((player) => player.playerId === heroId)?.netResult ?? 0;
                  return <p key={`${pot.label}-${pot.winnerId}`}>{winner?.displayName ?? pot.winnerId} wins {formatMoney(pot.amount)}{pot.winnerHandDescription ? ` (${pot.winnerHandDescription})` : ' without showdown'}. Net: <strong className={heroNet >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(heroNet)}</strong></p>;
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}

function sourceForAnalytics(event: HandEvent) {
  if (event.source === 'hero') return 'hero-action' as const;
  if (event.source === 'bot') return 'bot-action' as const;
  if (event.action === 'Deal street') return 'street-change' as const;
  if (event.action === 'Deal') return 'initial-state' as const;
  return 'reset' as const;
}

function App() {
  const [tableState, setTableState] = useState(() => {
    const table = createInitialTable();
    const next = createNextHand(table);
    if (!next) throw new Error('Unable to start table with fewer than two active players');
    return next;
  });
  const state = tableState.hand;
  const [mode, setMode] = useState<TableMode>('play');
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [handHistoryOpen, setHandHistoryOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<HandRecord[]>(() => loadSessionHistory());
  const [selectedHandId, setSelectedHandId] = useState<string | null>(() => loadSessionHistory()[0]?.handId ?? null);
  const [coachState, setCoachState] = useState<CoachState>('idle');
  const [coachAdvice, setCoachAdvice] = useState('');
  const [customBet, setCustomBet] = useState<CustomBetState>({ isOpen: false, value: 0, min: 0, max: 0 });
  const [customBetError, setCustomBetError] = useState('');
  const [customBetFlash, setCustomBetFlash] = useState(false);
  const customBetRef = useRef<HTMLDivElement | null>(null);

  const board = visibleBoard(state);
  const pot = potSize(state);
  const hero = state.seats.find((seat) => seat.isHero)!;
  const activeSeat = state.currentSeatId ? state.seats.find((seat) => seat.id === state.currentSeatId) : undefined;
  const legalActions = useMemo(() => getLegalActions(state, hero.id), [state, hero.id]);
  const customBetAction = legalActions.find((action) => action.kind === 'raise') ?? legalActions.find((action) => action.kind === 'bet');
  const customBetLimits = useMemo(() => {
    if (!customBetAction) return null;
    const min = customBetAction.min ?? (customBetAction.kind === 'bet' ? state.bigBlind : customBetAction.targetContribution);
    const max = customBetAction.max ?? hero.streetContribution + hero.stack;
    return { min, max };
  }, [customBetAction, hero.stack, hero.streetContribution, state.bigBlind]);
  const activeEvent = state.events[selectedEvent] || state.events[state.events.length - 1];
  const activePlayers = state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in');
  const occupiedSeatIndices = state.seats.map((seat) => seat.seatIndex);
  const isHeroTurn = state.currentSeatId === hero.id && state.stage === 'awaiting-action';
  const modeLabel = state.stage === 'hand-complete' ? 'Showdown' : activeSeat?.isHero ? 'Player turn' : activeSeat ? 'Bot action' : 'Resolving';
  const sessionStats = useMemo(() => state.seats.map((seat) => calculateSessionStats(seat.id, sessionHistory, state.bigBlind)), [sessionHistory, state.seats, state.bigBlind]);

  useEffect(() => {
    const last = state.events[state.events.length - 1];
    if (!last) return;
    trackHandHistoryEvent({
      handId: state.handId,
      street: last.street,
      actor: last.actor,
      action: last.action,
      amount: last.amount,
      note: last.note,
      source: sourceForAnalytics(last),
    });
  }, [state.events.length, state.handId]);

  useEffect(() => {
    if (!activeSeat || activeSeat.isHero || state.stage !== 'awaiting-action') return;
    const timer = window.setTimeout(() => {
      setTableState((current) => {
        if (current.hand.currentSeatId !== activeSeat.id) return current;
        const decision = chooseBotAction(current.hand, activeSeat.id);
        return { ...current, hand: submitAction(current.hand, activeSeat.id, decision.kind, decision.targetContribution) };
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeSeat, state.stage]);

  useEffect(() => {
    setSelectedEvent((current) => Math.min(current, state.events.length - 1));
  }, [state.events.length]);

  useEffect(() => {
    if (state.stage !== 'hand-complete') return;
    setSessionHistory((current) => {
      const next = appendCompletedHand(current, state);
      setSelectedHandId((selected) => selected ?? next[0]?.handId ?? null);
      return next;
    });
    const timer = window.setTimeout(() => {
      setTableState((current) => {
        const syncedTable = syncTableFromHand(current.table, current.hand);
        return createNextHand(syncedTable) ?? current;
      });
      setSelectedEvent(0);
      setMode('play');
      setCoachState('idle');
      setCoachAdvice('');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [state.stage]);

  useEffect(() => {
    if (!customBet.isOpen || !customBetLimits) return;
    setCustomBet((current) => ({
      ...current,
      min: customBetLimits.min,
      max: customBetLimits.max,
      value: clampWholeChip(current.value || customBetLimits.min, customBetLimits.min, customBetLimits.max),
    }));
  }, [customBet.isOpen, customBetLimits]);

  useEffect(() => {
    if (!customBet.isOpen) return;
    const closeCustomBet = (event: MouseEvent) => {
      if (customBetRef.current?.contains(event.target as Node)) return;
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    };
    document.addEventListener('mousedown', closeCustomBet);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', closeCustomBet);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [customBet.isOpen]);

  const runAction = (kind: ActionKind, targetContribution?: number) => {
    if (!isHeroTurn) return;
    setTableState((current) => ({ ...current, hand: submitAction(current.hand, hero.id, kind, targetContribution) }));
    setMode('play');
    setCustomBet((current) => ({ ...current, isOpen: false }));
    setCustomBetError('');
  };

  const toggleCustomBet = () => {
    if (!customBetLimits) return;
    setCustomBet((current) => ({
      isOpen: !current.isOpen,
      min: customBetLimits.min,
      max: customBetLimits.max,
      value: clampWholeChip(current.value || customBetLimits.min, customBetLimits.min, customBetLimits.max),
    }));
    setCustomBetError('');
  };

  const setCustomBetValue = (value: number) => {
    setCustomBet((current) => ({ ...current, value: Math.round(value) }));
    setCustomBetError('');
  };

  const applyQuickSize = (size: number) => {
    if (!customBetLimits) return;
    setCustomBetValue(clampWholeChip(size, customBetLimits.min, customBetLimits.max));
  };

  const confirmCustomBet = () => {
    if (!customBetAction || !customBetLimits) return;
    const value = Math.round(customBet.value);
    if (value < customBetLimits.min) {
      setCustomBetError(`Minimum bet is ${formatMoney(customBetLimits.min)}`);
      setCustomBetFlash(true);
      window.setTimeout(() => setCustomBetFlash(false), 240);
      return;
    }
    const target = Math.min(value, customBetLimits.max);
    runAction(target === customBetLimits.max ? 'all_in' : customBetAction.kind, target);
  };

  const askCoach = () => {
    setCoachState('loading');
    window.setTimeout(() => {
      setCoachAdvice(buildCoachAdvice(state));
      setCoachState('ready');
    }, 450);
  };

  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedEvent((current) => Math.min(state.events.length - 1, current + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedEvent((current) => Math.max(0, current - 1)); }
  };

  const showAllCards = state.stage === 'hand-complete' || mode === 'review';

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar">
          <div><p className="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div>
          <div className="status-group" aria-label="table state">
            <span className="state-chip active">{modeLabel}</span>
            <span className="state-chip">{state.street}</span>
          </div>
        </header>
        <div className={`table-stage mode-${mode}`}>
          <div className="state-banner" role="status" aria-live="polite">
            <span>{state.street}</span>
            <p>{state.message}</p>
          </div>
          <div className="felt" aria-label="Poker table">
            <div className="pot-chip-area">
              <ChipStacksView amount={pot} label="Pot" size="pot" />
            </div>
            {state.seats.map((seat, index) => <PlayerBetChips key={`${seat.id}-chips`} seat={seat} seatAngle={seatAngleForIndex(index, state.seats.length)} />)}
            <div className="board">
              <p>Board</p>
              <div className="board-cards">{state.board.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= board.length && state.stage !== 'hand-complete'} />)}</div>
              <dl className="pot-summary"><div><dt>Pot</dt><dd>{formatMoney(pot)}</dd></div><div><dt>Active</dt><dd>{activePlayers.length}</dd></div></dl>
            </div>
            <div className="seats-grid">{state.seats.map((seat) => (
              <SeatView
                isButton={seat.seatIndex === state.buttonSeatIndex}
                key={seat.id}
                positionLabel={getSeatLabel(seat.seatIndex, state.buttonSeatIndex, occupiedSeatIndices)}
                reveal={seat.isHero || showAllCards}
                seat={seat}
                street={state.street}
              />
            ))}</div>
          </div>
        </div>
        <section className="action-panel" aria-labelledby="actions-title">
          <div><h2 id="actions-title">Legal Actions</h2><p aria-live="polite">{activeSeat?.isHero ? 'Action is on you.' : activeSeat ? `${activeSeat.name} is resolving a legal engine action.` : state.message}</p></div>
          <div className="betting-controls" ref={customBetRef}>
            {customBet.isOpen && customBetLimits && (
              <div className="custom-bet-panel" role="dialog" aria-labelledby="custom-bet-title">
                <div className="custom-bet-heading">
                  <h3 id="custom-bet-title">Custom Bet</h3>
                  <span>{formatMoney(customBetLimits.min)} - {formatMoney(customBetLimits.max)}</span>
                </div>
                <label className="custom-bet-input">
                  <span className="sr-only">Custom bet amount</span>
                  <input
                    aria-describedby={customBetError ? 'custom-bet-error' : undefined}
                    className={customBetFlash ? 'input-flash' : ''}
                    inputMode="numeric"
                    max={customBetLimits.max}
                    min={customBetLimits.min}
                    onChange={(event) => setCustomBetValue(Number(event.target.value))}
                    type="number"
                    value={Number.isNaN(customBet.value) ? '' : customBet.value}
                  />
                </label>
                <input
                  aria-label="Custom bet amount slider"
                  className="custom-bet-slider"
                  max={customBetLimits.max}
                  min={customBetLimits.min}
                  onChange={(event) => setCustomBetValue(Number(event.target.value))}
                  step={1}
                  type="range"
                  value={clampWholeChip(customBet.value || customBetLimits.min, customBetLimits.min, customBetLimits.max)}
                />
                <div className="custom-bet-range"><span>Min: {formatMoney(customBetLimits.min)}</span><span>Max: {formatMoney(customBetLimits.max)}</span></div>
                <div className="quick-sizes" aria-label="Quick bet sizes">
                  <span>Quick sizes:</span>
                  <button onClick={() => applyQuickSize(Math.floor(pot * 0.5))} type="button">1/2 Pot</button>
                  <button onClick={() => applyQuickSize(pot)} type="button">Pot</button>
                  <button onClick={() => applyQuickSize(pot * 2)} type="button">2x Pot</button>
                </div>
                {customBetError && <p className="custom-bet-error" id="custom-bet-error" role="alert">{customBetError}</p>}
                <button className="confirm-bet" disabled={!isHeroTurn} onClick={confirmCustomBet} type="button">Confirm Bet</button>
              </div>
            )}
            <div className="action-grid">
            {legalActions.map((action) => (
              <button className="primary-action" disabled={!isHeroTurn} key={action.kind} onClick={() => runAction(action.kind, action.targetContribution)} type="button">
                <span>{action.label}</span>
                <small>{isHeroTurn ? 'Legal' : 'Locked'}</small>
              </button>
            ))}
              {customBetAction && (
                <button aria-expanded={customBet.isOpen} className="primary-action custom-bet-toggle" disabled={!isHeroTurn} onClick={toggleCustomBet} type="button">
                  <span>Custom Bet</span>
                  <small>{customBet.isOpen ? 'Close' : 'Open'} v</small>
                </button>
              )}
            <span className="auto-hand-status" role="status">{state.stage === 'hand-complete' ? 'Next hand auto-starts' : 'Hand in progress'}</span>
            </div>
          </div>
        </section>
      </section>
      <aside className="side-rail" aria-label="Training side panels">
        <section className="coach-panel" aria-labelledby="coach-title">
          <div className="panel-heading"><div><p className="eyebrow">Opt-in</p><h2 id="coach-title">Coach</h2></div><button onClick={askCoach} type="button">Ask</button></div>
          {coachState === 'idle' && <p className="muted">Coach is hidden until requested, so table decisions stay primary.</p>}
          {coachState === 'loading' && <div className="coach-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />Loading range advice...</div>}
          {coachState === 'ready' && <div className="coach-card"><strong>Suggested line: use only legal engine actions</strong><p>{coachAdvice}</p></div>}
          {coachState === 'error' && <div className="error-box" role="alert">Coach failed to load. Keep playing or retry when the trainer reconnects.</div>}
          <button className="text-button" onClick={() => setCoachState('error')} type="button">Simulate coach error</button>
        </section>
        <section className="review-panel" aria-labelledby="review-title">
          <div className="panel-heading"><div><p className="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button onClick={() => setHistoryVisible((visible) => !visible)} type="button">{historyVisible ? 'Hide' : 'Show'}</button></div>
          {historyVisible ? (
            <>
              <ActionFeed
                events={state.events}
                onKeyDown={handleTimelineKey}
                onSelect={(index) => { setSelectedEvent(index); setMode('review'); }}
                selectedEvent={selectedEvent}
              />
              <article className="review-detail"><h3>{activeEvent.action} review</h3><p>{activeEvent.note}</p></article>
            </>
          ) : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}
        </section>
      </aside>
      <button className="hand-history-toggle" onClick={() => setHandHistoryOpen((open) => !open)} type="button" aria-expanded={handHistoryOpen}>
        <span aria-hidden="true">H</span> Hand History
      </button>
      {handHistoryOpen && <HandHistoryPanel history={sessionHistory} selectedHandId={selectedHandId} setSelectedHandId={setSelectedHandId} stats={sessionStats} onClose={() => setHandHistoryOpen(false)} />}
    </main>
  );
}

export default App;
