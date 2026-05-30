import { type CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionKind,
  Card,
  DEFAULT_BUY_IN,
  HandEvent,
  HandState,
  Seat,
  Street,
  TableState,
  addChipsToSeat,
  autoRecoverBotSeats,
  chooseBotAction,
  createInitialTable,
  createNextHand,
  getSeatLabel,
  getLegalActions,
  playableSeatCount,
  potSize,
  rebuyBustedSeat,
  submitAction,
  syncTableFromHand,
  visibleBoard,
} from './nlheEngine';
import { getSeatPosition, seatAngleForIndex } from './seatGeometry';
import { getPlayerId, persistCompletedHand, trackHandHistoryEvent } from './handHistoryAnalytics';
import { appendCompletedHand, buildHandRecord, calculateSessionStats, HandRecord, loadSessionHistory, PlayerSessionStats, StreetKey } from './handHistory';

type TableMode = 'play' | 'review';
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
type RecoveryNotice = {
  tone: 'info' | 'warning';
  message: string;
};

const HERO_INITIAL_BUY_IN = 1500;
const HIDDEN_REPLAY_ACTION_TYPES = new Set<HandEvent['actionType']>(['deal', 'small-blind', 'big-blind']);

const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1000, color: '#FFD700', borderColor: '#B8860B', label: '1K' },
  { value: 100, color: '#1a1a1a', borderColor: '#555555', label: '100' },
  { value: 25, color: '#228B22', borderColor: '#145214', label: '25' },
  { value: 5, color: '#CC0000', borderColor: '#8B0000', label: '5' },
  { value: 1, color: '#F5F5F5', borderColor: '#AAAAAA', label: '1' },
];
const suitLabels: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const suitSymbols: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
const suitClasses: Record<Card['suit'], string> = {
  spades: 'card-spade',
  hearts: 'card-heart',
  diamonds: 'card-diamond',
  clubs: 'card-club',
};

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
  // Chips sit at ~44% of the table radius — between the board edge (~21) and the seat panels (~32)
  return getSeatPosition(seatAngle, tableCenter, seatRadius * 0.44);
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

type CoachMessage = { role: 'user' | 'assistant'; content: string };

const QUICK_PROMPTS = [
  "What's my best play?",
  "What are my pot odds?",
  "Am I ahead or behind?",
  "Analyse my range here",
  "Was that last action a mistake?",
];

const SUIT_CODES: Record<Card['suit'], string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };

function buildGameStateForCoach(state: HandState) {
  const hero = state.seats.find((seat) => seat.isHero)!;
  const cardCode = (c: Card) => `${c.rank}${SUIT_CODES[c.suit]}`;
  return {
    street: state.street,
    handNumber: state.handNumber,
    board: state.board.map(cardCode),
    pot: potSize(state),
    heroCards: hero.cards.map(cardCode),
    heroRole: hero.role,
    heroStack: hero.stack,
    heroStreetContribution: hero.streetContribution,
    legalActions: getLegalActions(state, hero.id).map((a) => a.label),
    players: state.seats.map((s) => ({
      name: s.name,
      role: s.role,
      stack: s.stack,
      streetContribution: s.streetContribution,
      status: s.status,
      isHero: s.isHero,
      lastAction: s.lastAction,
    })),
    recentEvents: state.events.slice(-8).map((e) => `${e.actor} ${e.action}${e.amount ? ` $${e.amount}` : ''}`),
    bigBlind: state.bigBlind,
  };
}

function CardView({ card, hidden = false }: { card: Card; hidden?: boolean }) {
  return (
    <span className={`card ${hidden ? 'card-hidden' : suitClasses[card.suit]}`}>
      <span className="card-rank">{hidden ? '?' : card.rank}</span>
      <span aria-hidden="true" className="card-suit">{hidden ? '?' : suitSymbols[card.suit]}</span>
      <span className="sr-only">{hidden ? 'hidden card' : `${card.rank} of ${card.suit}`}</span>
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

function SeatView({ seat, street, reveal, positionLabel, isButton, style }: { seat: Seat; street: Street; reveal: boolean; positionLabel: string; isButton: boolean; style?: CSSProperties }) {
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
        <p>{seat.status === 'folded' ? 'Folded' : seat.status === 'all-in' ? 'All-in' : seat.lastAction}</p>
      </div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>
        {seat.cards.map((card, index) => <CardView key={`${seat.id}-${street}-${index}`} card={card} hidden={!reveal} />)}
      </div>
      <dl className="seat-money">
        <div><dt>Stack</dt><dd>{formatMoney(seat.stack)}</dd></div>
        <div><dt>In pot</dt><dd>{formatMoney(seat.streetContribution)}</dd></div>
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

function isUserFacingReplayEvent(event: HandEvent) {
  return !HIDDEN_REPLAY_ACTION_TYPES.has(event.actionType);
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
      {feedEvents.length === 0 ? (
        <p className="timeline-empty">Player decisions will appear here once action starts.</p>
      ) : feedEvents.map(({ event, index }) => {
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
  const position = getChipPosition(seatAngle, { x: 50, y: 50 }, 50);
  return (
    <div className="player-bet-chips" style={{ left: `${position.x}%`, top: `${position.y}%` }}>
      <ChipStacksView amount={seat.streetContribution} />
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

const SESSION_QUICK_PROMPTS = [
  "What are my biggest leaks?",
  "How's my 3-bet game?",
  "Where am I losing most?",
  "Is my postflop play good?",
];

const HAND_QUICK_PROMPTS = [
  "What did I do wrong?",
  "Was the flop bet correct?",
  "What's villain's range here?",
  "What's the optimal line?",
];

const STREET_QUICK_PROMPTS = [
  "What's the best sizing here?",
  "Should I have c-bet?",
  "Was this the right line?",
  "What hands call/fold here?",
];

function HandHistoryPanel({
  history,
  selectedHandId,
  setSelectedHandId,
  stats,
  historyView,
  onHistoryViewChange,
  onClose,
}: {
  history: HandRecord[];
  selectedHandId: string | null;
  setSelectedHandId: (handId: string) => void;
  stats: PlayerSessionStats[];
  historyView: 'session' | 'all';
  onHistoryViewChange: (view: 'session' | 'all') => void;
  onClose: () => void;
}) {
  const selected = history.find((hand) => hand.handId === selectedHandId) ?? history[0] ?? null;
  const heroId = selected?.players.find((player) => player.isHero)?.playerId;

  const [coachContext, setCoachContext] = useState<'session' | 'hand' | 'street'>('session');
  const [focusStreet, setFocusStreet] = useState<StreetKey | null>(null);

  const contextKey =
    coachContext === 'street' && selected && focusStreet ? `street:${selected.handId}:${focusStreet}`
    : coachContext === 'hand' && selected ? `hand:${selected.handId}`
    : `session:${historyView}`;

  const isHandMode = coachContext !== 'session';
  const quickPrompts =
    coachContext === 'street' ? STREET_QUICK_PROMPTS
    : coachContext === 'hand' ? HAND_QUICK_PROMPTS
    : SESSION_QUICK_PROMPTS;

  const [historyCoachThreads, setHistoryCoachThreads] = useState<Record<string, CoachMessage[]>>({});
  const [historyCoachStreaming, setHistoryCoachStreaming] = useState(false);
  const [historyCoachStreamText, setHistoryCoachStreamText] = useState('');
  const [historyCoachInput, setHistoryCoachInput] = useState('');
  const historyCoachMessagesRef = useRef<HTMLDivElement | null>(null);
  const abortHistoryCoachRef = useRef<AbortController | null>(null);

  const coachMessages = historyCoachThreads[contextKey] ?? [];

  useEffect(() => {
    historyCoachMessagesRef.current?.scrollTo({ top: historyCoachMessagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [historyCoachThreads, historyCoachStreamText, contextKey]);

  const sendHistoryCoachMessage = async (message: string) => {
    if (historyCoachStreaming) return;
    if (!message.trim()) return;

    abortHistoryCoachRef.current?.abort();
    const controller = new AbortController();
    abortHistoryCoachRef.current = controller;

    const userMsg: CoachMessage = { role: 'user', content: message };
    const prevMessages = historyCoachThreads[contextKey] ?? [];
    setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...prevMessages, userMsg] }));
    setHistoryCoachStreaming(true);
    setHistoryCoachStreamText('');

    const body = coachContext === 'street'
      ? { mode: 'hand', hand: selected, focusStreet, userMessage: message, history: prevMessages.slice(-8) }
      : coachContext === 'hand'
      ? { mode: 'hand', hand: selected, userMessage: message, history: prevMessages.slice(-8) }
      : { mode: 'session', stats, hands: history, userMessage: message, history: prevMessages.slice(-8) };

    try {
      const resp = await fetch('/api/coach-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error('Coach unavailable');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.error) { accumulated = parsed.error; break; }
            if (parsed.text) { accumulated += parsed.text; setHistoryCoachStreamText(accumulated); }
          } catch { /* ignore malformed SSE */ }
        }
      }

      const assistantMsg: CoachMessage = { role: 'assistant', content: accumulated };
      setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...(prev[contextKey] ?? []), assistantMsg] }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const assistantMsg: CoachMessage = { role: 'assistant', content: 'Coach unavailable — please try again.' };
        setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...(prev[contextKey] ?? []), assistantMsg] }));
      }
    } finally {
      setHistoryCoachStreaming(false);
      setHistoryCoachStreamText('');
    }
  };

  return (
    <aside className="hand-history-panel" aria-label="Hand history panel">
      <header className="hand-history-header">
        <div><p className="eyebrow">Hand History</p><h2>{historyView === 'session' ? 'This Session' : 'All Sessions'}</h2></div>
        <div className="history-view-toggle" role="group" aria-label="History view">
          <button type="button" className={historyView === 'session' ? 'active' : ''} onClick={() => { onHistoryViewChange('session'); setCoachContext('session'); }} aria-pressed={historyView === 'session'}>This Session</button>
          <button type="button" className={historyView === 'all' ? 'active' : ''} onClick={() => { onHistoryViewChange('all'); setCoachContext('session'); }} aria-pressed={historyView === 'all'}>All Sessions</button>
        </div>
        <button onClick={onClose} type="button" aria-label="Close hand history">Close</button>
      </header>
      <div className="hand-history-body">
        <div className="hand-history-content">
          <section className="session-stats" aria-labelledby="session-stats-title">
            <h3 id="session-stats-title">{historyView === 'session' ? 'Session Stats' : 'All-Time Stats'}</h3>
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
                <button className={selected?.handId === hand.handId ? 'hand-list-item active' : 'hand-list-item'} key={hand.handId} onClick={() => { setSelectedHandId(hand.handId); setCoachContext('hand'); setFocusStreet(null); }} type="button">
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
                    <div className={`street-block${coachContext === 'street' && focusStreet === street ? ' street-block-active' : ''}`} key={street} onClick={() => { setCoachContext('street'); setFocusStreet(street); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setCoachContext('street'); setFocusStreet(street); } }} aria-label={`Focus coach on ${street}`}>
                      <h4>{streetTitle(street, selected)}<span className="street-coach-hint">Click to coach</span></h4>
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
        <div className="history-coach">
          <div className="history-coach-header">
            <span className="eyebrow">AI Coach</span>
            <span className="history-coach-context">
              {coachContext === 'street' && selected && focusStreet
                ? `Hand #${selected.handNumber} · ${focusStreet.toUpperCase()}`
                : coachContext === 'hand' && selected
                ? `Hand #${selected.handNumber}`
                : historyView === 'session' ? 'This Session' : 'All Sessions'}
            </span>
            <span className={`coach-status${historyCoachStreaming ? ' coach-status-thinking' : ''}`}>{historyCoachStreaming ? 'Thinking…' : 'Ready'}</span>
          </div>
          <div className="history-coach-messages" ref={historyCoachMessagesRef}>
            {coachMessages.length === 0 && !historyCoachStreaming && (
              <p className="history-coach-empty">
                {coachContext === 'street' && focusStreet ? `Ask about the ${focusStreet} — sizing, lines, alternatives.`
                : coachContext === 'hand' ? 'Ask about this hand — sizing, lines, mistakes.'
                : 'Ask about your overall play, leaks, and trends.'}
              </p>
            )}
            {coachMessages.map((msg, i) => (
              <div className={`coach-msg-${msg.role}`} key={i}>{msg.content}</div>
            ))}
            {historyCoachStreaming && historyCoachStreamText && (
              <div className="coach-msg-assistant">{historyCoachStreamText}<span className="coach-cursor">▌</span></div>
            )}
            {historyCoachStreaming && !historyCoachStreamText && (
              <div className="coach-msg-assistant coach-thinking">Thinking…</div>
            )}
          </div>
          <div className="coach-chips">
            {quickPrompts.map((prompt) => (
              <button className="coach-chip" disabled={historyCoachStreaming} key={prompt} onClick={() => sendHistoryCoachMessage(prompt)} type="button">{prompt}</button>
            ))}
          </div>
          <form className="coach-input-row" onSubmit={(e) => { e.preventDefault(); const msg = historyCoachInput.trim(); if (msg) { sendHistoryCoachMessage(msg); setHistoryCoachInput(''); } }}>
            <input
              className="coach-input"
              placeholder={coachContext === 'street' && focusStreet ? `Ask about the ${focusStreet}…` : coachContext === 'hand' ? 'Ask about this hand…' : 'Ask about your session…'}
              value={historyCoachInput}
              onChange={(e) => setHistoryCoachInput(e.target.value)}
              disabled={historyCoachStreaming}
            />
            <button className="coach-send" disabled={historyCoachStreaming || !historyCoachInput.trim()} type="submit">→</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function RebuyModal({ onRebuy }: { onRebuy: () => void }) {
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

function RebuyPanel({
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

function sourceForAnalytics(event: HandEvent) {
  if (event.source === 'hero') return 'hero-action' as const;
  if (event.source === 'bot') return 'bot-action' as const;
  if (event.action === 'Deal street') return 'street-change' as const;
  if (event.action === 'Deal') return 'initial-state' as const;
  return 'reset' as const;
}

function App() {
  const [tableState, setTableState] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem('poker-demo-game-state');
      if (saved) {
        const parsed = JSON.parse(saved) as { table: TableState; hand: HandState };
        if (parsed?.table?.seats && parsed?.hand?.stage) return parsed;
      }
    } catch { /* fall through to fresh start */ }
    const table = createInitialTable();
    const savedHandNumber = parseInt(window.sessionStorage.getItem('poker-demo-hand-number') || '0', 10);
    if (savedHandNumber > 0) table.handNumber = savedHandNumber;
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
  const [customBet, setCustomBet] = useState<CustomBetState>({ isOpen: false, value: 0, min: 0, max: 0 });
  const [customBetError, setCustomBetError] = useState('');
  const [customBetFlash, setCustomBetFlash] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
  const customBetRef = useRef<HTMLDivElement | null>(null);
  const persistedHandIds = useRef(new Set<string>());
  const currentRunHandIds = useRef(new Set<string>());
  const [historyView, setHistoryView] = useState<'session' | 'all'>('session');
  const [addOnAmount, setAddOnAmount] = useState(Math.floor(DEFAULT_BUY_IN / 2));
  const [addOnQueued, setAddOnQueued] = useState(false);
  const addOnQueuedRef = useRef(false);
  const addOnAmountRef = useRef(Math.floor(DEFAULT_BUY_IN / 2));
  const [rebuyModalOpen, setRebuyModalOpen] = useState(false);
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachStreaming, setCoachStreaming] = useState(false);
  const [coachStreamText, setCoachStreamText] = useState('');
  const [coachInput, setCoachInput] = useState('');
  const coachMessagesRef = useRef<HTMLDivElement | null>(null);
  const abortCoachRef = useRef<AbortController | null>(null);
  const [heroTotalInvested, setHeroTotalInvested] = useState(() => {
    const saved = parseInt(window.sessionStorage.getItem('poker-demo-total-invested') || '0', 10);
    return saved > 0 ? saved : HERO_INITIAL_BUY_IN;
  });

  useEffect(() => {
    const playerId = getPlayerId();
    fetch(`/api/hands?playerId=${encodeURIComponent(playerId)}`)
      .then((r) => r.json())
      .then((data: { hands?: HandRecord[] }) => {
        if (!Array.isArray(data.hands) || data.hands.length === 0) return;
        setSessionHistory((local) => {
          const localIds = new Set(local.map((h) => h.handId));
          const fromDb = data.hands!.filter((h) => !localIds.has(h.handId));
          const merged = [...local, ...fromDb].sort((a, b) => b.timestamp - a.timestamp);
          return merged;
        });
        setSelectedHandId((current) => current ?? data.hands![0]?.handId ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try { window.sessionStorage.setItem('poker-demo-game-state', JSON.stringify(tableState)); } catch {}
  }, [tableState]);

  useEffect(() => {
    window.sessionStorage.setItem('poker-demo-total-invested', String(heroTotalInvested));
  }, [heroTotalInvested]);

  const board = visibleBoard(state);
  const pot = potSize(state);
  const hero = state.seats.find((seat) => seat.isHero)!;
  const playableSeats = playableSeatCount(tableState.table);
  const activeSeat = state.currentSeatId ? state.seats.find((seat) => seat.id === state.currentSeatId) : undefined;
  const legalActions = useMemo(() => getLegalActions(state, hero.id), [state, hero.id]);
  const customBetAction = legalActions.find((action) => action.kind === 'raise') ?? legalActions.find((action) => action.kind === 'bet');
  const customBetLimits = useMemo(() => {
    if (!customBetAction) return null;
    const min = customBetAction.min ?? (customBetAction.kind === 'bet' ? state.bigBlind : customBetAction.targetContribution);
    const max = customBetAction.max ?? hero.streetContribution + hero.stack;
    return { min, max };
  }, [customBetAction, hero.stack, hero.streetContribution, state.bigBlind]);
  const replayEvents = useMemo(() => state.events.filter(isUserFacingReplayEvent), [state.events]);
  const activePlayers = state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in');
  const tableSeatCount = tableState.table.seats.length;
  const occupiedSeatIndices = tableState.table.seats.filter((seat) => seat.playerId && seat.isActive && seat.chips > 0).map((seat) => seat.seatIndex);
  const isHeroTurn = state.currentSeatId === hero.id && state.stage === 'awaiting-action';
  const modeLabel = state.stage === 'hand-complete' ? 'Showdown' : activeSeat?.isHero ? 'Player turn' : activeSeat ? 'Bot action' : 'Resolving';
  const visibleHistory = useMemo(
    () => historyView === 'session' ? sessionHistory.filter((h) => currentRunHandIds.current.has(h.handId)) : sessionHistory,
    [historyView, sessionHistory]
  );
  const sessionStats = useMemo(() => state.seats.map((seat) => calculateSessionStats(seat.id, visibleHistory, state.bigBlind)), [visibleHistory, state.seats, state.bigBlind]);

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
    setSelectedEvent((current) => Math.max(0, Math.min(current, replayEvents.length - 1)));
  }, [replayEvents.length]);

  useEffect(() => {
    if (state.stage !== 'hand-complete') return;
    window.sessionStorage.setItem('poker-demo-hand-number', String(state.handNumber));
    if (!persistedHandIds.current.has(state.handId)) {
      persistedHandIds.current.add(state.handId);
      currentRunHandIds.current.add(state.handId);
      persistCompletedHand(buildHandRecord(state));
    }
    setSessionHistory((current) => {
      const next = appendCompletedHand(current, state);
      setSelectedHandId((selected) => selected ?? next[0]?.handId ?? null);
      return next;
    });
    const timer = window.setTimeout(() => {
      const heroFinalStack = state.seats.find((s) => s.isHero)?.stack ?? 0;
      const pendingAddOn = addOnQueuedRef.current && heroFinalStack > 0
        ? Math.min(addOnAmountRef.current, DEFAULT_BUY_IN - heroFinalStack)
        : 0;
      if (addOnQueuedRef.current) {
        addOnQueuedRef.current = false;
        setAddOnQueued(false);
      }
      setTableState((current) => {
        let syncedTable = autoRecoverBotSeats(syncTableFromHand(current.table, current.hand));
        if (pendingAddOn > 0) {
          syncedTable = addChipsToSeat(syncedTable, hero.id, pendingAddOn);
        }
        const heroSeat = syncedTable.seats.find((seat) => seat.isHero);
        if (heroSeat && heroSeat.chips <= 0) {
          setRebuyModalOpen(true);
          return { ...current, table: syncedTable };
        }
        const next = createNextHand(syncedTable);
        if (!next) {
          setRecoveryNotice({ tone: 'warning', message: 'Only one live seat remains. Rebuy or recover the table before the next hand.' });
          return { ...current, table: syncedTable };
        }
        return next;
      });
      if (pendingAddOn > 0) {
        setHeroTotalInvested((c) => c + pendingAddOn);
        setRecoveryNotice({ tone: 'info', message: `${formatMoney(pendingAddOn)} add-on posted before the next hand.` });
      }
      setSelectedEvent(0);
      setMode('play');
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [state.stage]);

  useEffect(() => {
    if (state.stage !== 'hand-complete') return;
    if (hero.stack <= 0 && addOnQueuedRef.current) {
      addOnQueuedRef.current = false;
      setAddOnQueued(false);
    }
    const fillAmount = DEFAULT_BUY_IN - hero.stack;
    if (fillAmount > 0) {
      addOnAmountRef.current = fillAmount;
      setAddOnAmount(fillAmount);
    }
  }, [state.stage]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const rebuyHero = () => {
    setTableState((current) => {
      const syncedTable = syncTableFromHand(current.table, current.hand);
      const next = createNextHand(autoRecoverBotSeats(rebuyBustedSeat(syncedTable, hero.id)));
      if (!next) return current;
      return next;
    });
    setHeroTotalInvested((current) => current + DEFAULT_BUY_IN);
    setRebuyModalOpen(false);
    setRecoveryNotice(null);
    setSelectedEvent(0);
    setMode('play');
  };

  const toggleAddOnQueue = () => {
    const next = !addOnQueuedRef.current;
    addOnQueuedRef.current = next;
    setAddOnQueued(next);
  };

  const sendCoachMessage = async (message: string) => {
    if (coachStreaming) return;
    abortCoachRef.current?.abort();
    abortCoachRef.current = new AbortController();
    setCoachStreaming(true);
    setCoachStreamText('');
    const historySnapshot = coachMessages.slice(-8);
    try {
      const resp = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameState: buildGameStateForCoach(state), userMessage: message, history: historySnapshot }),
        signal: abortCoachRef.current.signal,
      });
      if (!resp.ok || !resp.body) throw new Error('Coach request failed');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assistantText = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        finished = done;
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { finished = true; break; }
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) { assistantText += parsed.text; setCoachStreamText(assistantText); }
          } catch { /* skip malformed chunk */ }
        }
      }
      if (assistantText) {
        setCoachMessages((prev) => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: assistantText },
        ]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCoachMessages((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: 'Coach unavailable — ensure ANTHROPIC_API_KEY is set in your Vercel environment.' },
      ]);
    } finally {
      setCoachStreaming(false);
      setCoachStreamText('');
    }
  };

  useEffect(() => {
    coachMessagesRef.current?.scrollTo({ top: coachMessagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [coachMessages, coachStreamText]);

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
    runAction(customBetAction.kind, Math.min(value, customBetLimits.max));
  };

  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible) return;
    if (replayEvents.length === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedEvent((current) => Math.min(replayEvents.length - 1, current + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedEvent((current) => Math.max(0, current - 1)); }
  };

  const showAllCards = state.stage === 'hand-complete';

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar">
          <div><p className="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div>
          <button className="hand-history-toggle hand-history-top" onClick={() => setHandHistoryOpen((open) => !open)} type="button" aria-expanded={handHistoryOpen}>
            <span aria-hidden="true">H</span> Hand History
          </button>
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
            {state.seats.map((seat) => <PlayerBetChips key={`${seat.id}-chips`} seat={seat} seatAngle={seatAngleForIndex(seat.seatIndex, tableSeatCount)} />)}
            <div className="board">
              <p>Board</p>
              <div className="board-cards">{state.board.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= board.length && state.stage !== 'hand-complete'} />)}</div>
              <div className="board-pot"><ChipStacksView amount={pot} size="pot" /></div>
              <dl className="pot-summary"><div><dt>Active</dt><dd>{activePlayers.length}</dd></div></dl>
            </div>
            <div className="seats-grid">{state.seats.map((seat) => {
              const seatAngle = seatAngleForIndex(seat.seatIndex, tableSeatCount);
              // Top (0°) and bottom (180°) seats use a larger radius so chips fit in the gap between them and the board
              const seatRadius = Math.abs(Math.cos(seatAngle * Math.PI / 180)) > 0.7 ? 40 : 32;
              const position = getSeatPosition(seatAngle, { x: 50, y: 50 }, seatRadius);
              return (
                <SeatView
                  isButton={seat.seatIndex === state.buttonSeatIndex}
                  key={seat.id}
                  positionLabel={getSeatLabel(seat.seatIndex, state.buttonSeatIndex, occupiedSeatIndices)}
                  reveal={seat.isHero || showAllCards}
                  seat={seat}
                  street={state.street}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                />
              );
            })}</div>
          </div>
        </div>
        <section className="action-panel" aria-labelledby="actions-title">
          <div><h2 id="actions-title">Legal Actions</h2><p aria-live="polite">{activeSeat?.isHero ? 'Action is on you.' : activeSeat ? `${activeSeat.name} is resolving a legal engine action.` : state.message}</p></div>
          <div className="betting-controls" ref={customBetRef}>
            <dl className="session-investment" aria-label="Session investment">
              <div><dt>Current hand pot</dt><dd>{formatMoney(pot)}</dd></div>
              <div><dt>Your session invested</dt><dd>{formatMoney(heroTotalInvested)}</dd></div>
            </dl>
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
              </button>
            ))}
            {customBetAction && (
              <button aria-expanded={customBet.isOpen} className="primary-action custom-bet-toggle" disabled={!isHeroTurn} onClick={toggleCustomBet} type="button">
                <span>Custom Bet</span>
              </button>
            )}
            <span className="auto-hand-status" role="status">{state.stage === 'hand-complete' ? 'Next hand auto-starts' : 'Hand in progress'}</span>
            </div>
          </div>
        </section>
        <RebuyPanel
          addOnAmount={addOnAmount}
          addOnQueued={addOnQueued}
          canRebuy={state.stage === 'hand-complete' && hero.stack <= 0}
          heroStack={hero.stack}
          notice={recoveryNotice}
          onAddOnAmountChange={(amount) => { addOnAmountRef.current = amount; setAddOnAmount(amount); }}
          onAddOnToggle={toggleAddOnQueue}
          onRebuy={rebuyHero}
          playableSeats={playableSeats}
        />
      </section>
      <aside className="side-rail" aria-label="Training side panels">
        <section className="coach-panel" aria-labelledby="coach-title">
          <div className="panel-heading">
            <div><p className="eyebrow">AI Powered</p><h2 id="coach-title">Coach</h2></div>
            <span className={`coach-status${coachStreaming ? ' coach-status-thinking' : ''}`}>{coachStreaming ? 'Thinking…' : 'Ready'}</span>
          </div>
          <div className="coach-messages" ref={coachMessagesRef}>
            {coachMessages.length === 0 && !coachStreaming && (
              <p className="coach-empty">Tap a prompt or ask a question to get strategy advice.</p>
            )}
            {coachMessages.map((msg, i) => (
              <div key={i} className={`coach-msg coach-msg-${msg.role}`}>
                <p>{msg.content}</p>
              </div>
            ))}
            {coachStreaming && (
              <div className="coach-msg coach-msg-assistant coach-msg-streaming">
                <p>{coachStreamText || '…'}</p>
              </div>
            )}
          </div>
          <div className="coach-chips" aria-label="Quick prompts">
            {QUICK_PROMPTS.map((prompt) => (
              <button className="coach-chip" disabled={coachStreaming} key={prompt} onClick={() => sendCoachMessage(prompt)} type="button">
                {prompt}
              </button>
            ))}
          </div>
          <form className="coach-input-row" onSubmit={(e) => { e.preventDefault(); const msg = coachInput.trim(); if (msg) { sendCoachMessage(msg); setCoachInput(''); } }}>
            <input
              aria-label="Ask your coach"
              className="coach-input"
              disabled={coachStreaming}
              onChange={(e) => setCoachInput(e.target.value)}
              placeholder="Ask your coach…"
              type="text"
              value={coachInput}
            />
            <button className="coach-send" disabled={coachStreaming || !coachInput.trim()} type="submit">→</button>
          </form>
        </section>
        <section className="review-panel" aria-labelledby="review-title">
          <div className="panel-heading"><div><p className="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button onClick={() => setHistoryVisible((visible) => !visible)} type="button">{historyVisible ? 'Hide' : 'Show'}</button></div>
          {historyVisible ? (
            <>
              <ActionFeed
                events={replayEvents}
                onKeyDown={handleTimelineKey}
                onSelect={(index) => { setSelectedEvent(index); setMode('review'); }}
                selectedEvent={selectedEvent}
              />
              <div className="timeline-hero-hand" aria-label="Your hole cards">
                <span>Your hand</span>
                <HistoryCards cards={hero.cards} />
              </div>
            </>
          ) : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}
        </section>
      </aside>
      {handHistoryOpen && <HandHistoryPanel history={visibleHistory} selectedHandId={selectedHandId} setSelectedHandId={setSelectedHandId} stats={sessionStats} historyView={historyView} onHistoryViewChange={setHistoryView} onClose={() => setHandHistoryOpen(false)} />}
      {rebuyModalOpen && <RebuyModal onRebuy={rebuyHero} />}
    </main>
  );
}

export default App;
