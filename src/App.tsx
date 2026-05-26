import { KeyboardEvent, useEffect, useMemo, useState } from 'react';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Street = 'Preflop' | 'Flop' | 'Turn' | 'River';
type TableMode = 'turn' | 'showdown' | 'review';
type CoachState = 'idle' | 'loading' | 'ready' | 'error';
type BotStyle = 'loose-aggressive' | 'balanced' | 'pressure';

type Card = { rank: string; suit: Suit };
type Seat = {
  id: string;
  name: string;
  role: string;
  stack: number;
  contribution: number;
  status: string;
  cards: Card[];
  isHero?: boolean;
  folded?: boolean;
  style?: BotStyle;
};
type TimelineEvent = { street: string; actor: string; action: string; amount?: number; note: string };
type BotDecision = { action: string; amount: number; status: string; note: string };
type BotContext = { street: Street; visibleBoard: Card[] };

const suitLabels: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const suitSymbols: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const board: Card[] = [
  { rank: '10', suit: 'clubs' },
  { rank: 'K', suit: 'diamonds' },
  { rank: '4', suit: 'spades' },
  { rank: 'A', suit: 'clubs' },
  { rank: '7', suit: 'hearts' },
];
const initialSeats: Seat[] = [
  { id: 'mira', name: 'Mira', role: 'BTN', stack: 1240, contribution: 60, status: 'Calls wide', cards: [{ rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'diamonds' }], style: 'loose-aggressive' },
  { id: 'nash', name: 'Nash Bot', role: 'SB', stack: 930, contribution: 30, status: 'Thinking', cards: [{ rank: '9', suit: 'spades' }, { rank: '9', suit: 'clubs' }], style: 'balanced' },
  { id: 'hero', name: 'You', role: 'BB', stack: 1470, contribution: 120, status: 'Action on you', cards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }], isHero: true },
  { id: 'atlas', name: 'Atlas', role: 'CO', stack: 860, contribution: 0, status: 'Folded', cards: [{ rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }], folded: true, style: 'pressure' },
];
const initialTimeline: TimelineEvent[] = [
  { street: 'Preflop', actor: 'Atlas', action: 'Fold', note: 'CO gives up after a 3-bet sizing cue.' },
  { street: 'Preflop', actor: 'Mira', action: 'Call', amount: 60, note: 'Button keeps suited broadways in range.' },
  { street: 'Flop', actor: 'You', action: 'Bet', amount: 90, note: 'Top pair, strong kicker; denies equity.' },
  { street: 'Turn', actor: 'Nash Bot', action: 'Check', note: 'Small blind range is capped after passive line.' },
];
const streets: Street[] = ['Preflop', 'Flop', 'Turn', 'River'];
const botOrder = ['mira', 'nash', 'atlas'];

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}
function boardCount(street: Street) {
  return street === 'Preflop' ? 0 : street === 'Flop' ? 3 : street === 'Turn' ? 4 : 5;
}
function texture(cards: Card[]) {
  if (cards.length < 3) return 'no board yet; preflop ranges and position dominate';
  const suitCounts = cards.reduce<Record<Suit, number>>((counts, card) => ({ ...counts, [card.suit]: counts[card.suit] + 1 }), { spades: 0, hearts: 0, diamonds: 0, clubs: 0 });
  const paired = new Set(cards.map((card) => card.rank)).size < cards.length;
  const flushy = Object.values(suitCounts).some((count) => count >= 3);
  const broadway = cards.filter((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank)).length >= 2;
  return `${paired ? 'paired' : 'unpaired'}, ${flushy ? 'flush-heavy' : 'rainbow/two-tone'}, ${broadway ? 'broadway-connected' : 'low-card'} texture`;
}
function handStrength(cards: Card[], visibleBoard: Card[]) {
  const ranks = [...cards, ...visibleBoard].map((card) => card.rank);
  const madePairs = new Set(ranks.filter((rank) => ranks.filter((item) => item === rank).length >= 2)).size;
  if (madePairs >= 2) return 86;
  if (madePairs && cards.some((card) => card.rank === 'A')) return 78;
  if (madePairs) return 64;
  if (cards.some((card) => card.rank === 'A') && cards.every((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank))) return 58;
  return cards[0]?.suit === cards[1]?.suit ? 48 : 34;
}
function getBotDecision(seat: Seat, street: Street, pot: number, highBet: number, visibleBoard: Card[]): BotDecision {
  const callCost = Math.max(0, highBet - seat.contribution);
  const potOdds = callCost === 0 ? 0 : callCost / (pot + callCost);
  const pressure = callCost > seat.stack * 0.22;
  const position = seat.role === 'BTN' || seat.role === 'CO' ? 7 : 0;
  const style = seat.style === 'loose-aggressive' ? 12 : seat.style === 'pressure' ? 8 : 0;
  const score = handStrength(seat.cards, visibleBoard) + position + style - (pressure ? 14 : 0) - (potOdds > 0.34 ? 8 : 0);
  const boardRead = texture(visibleBoard);

  if (callCost > 0 && score < 46) return { action: 'Fold', amount: 0, status: 'Folded under pressure', note: `${seat.role} releases versus ${formatMoney(callCost)} more on ${street}: ${boardRead}, weak equity, and poor pot odds.` };
  if (score >= 74) {
    const amount = Math.min(seat.stack, Math.max(highBet + 120, Math.round(pot * 0.65)));
    return { action: callCost > 0 ? 'Raise' : 'Bet', amount, status: 'Pressuring range', note: `${seat.role} applies stack pressure with ${formatMoney(amount)} on ${street}: strong range, ${boardRead}, and fold equity against capped lines.` };
  }
  if (callCost > 0) return { action: 'Call', amount: callCost, status: 'Continues with equity', note: `${seat.role} continues for ${formatMoney(callCost)} with playable equity and acceptable pot odds on ${boardRead}.` };
  return { action: 'Check', amount: 0, status: 'Checks range', note: `${seat.role} checks range on ${boardRead}, protecting medium-strength hands and inducing bets.` };
}
function buildCoachAdvice(street: Street, visibleBoard: Card[], seats: Seat[], timeline: TimelineEvent[]) {
  const hero = seats.find((seat) => seat.isHero)!;
  const pot = seats.reduce((sum, seat) => sum + seat.contribution, 0);
  const callCost = Math.max(0, Math.max(...seats.map((seat) => seat.contribution)) - hero.contribution);
  const recent = timeline.slice(-3).map((event) => `${event.actor} ${event.action}${event.amount ? ` ${formatMoney(event.amount)}` : ''}`).join(', ');
  const boardText = visibleBoard.map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ') || 'not dealt';
  return `You have AKo from the BB on ${street.toLowerCase()} with ${formatMoney(pot)} in the pot, ${formatMoney(callCost)} to call, and ${Math.round(hero.stack / 30)}bb behind. Board is ${boardText} (${texture(visibleBoard)}). Recent action: ${recent || 'none'}. Your range keeps strong top-pair/two-pair advantage while BTN can hold suited Broadway draws; prefer a value-heavy sizing that charges draws while keeping dominated kings and aces in.`;
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
function SeatView({ seat, mode }: { seat: Seat; mode: TableMode }) {
  const reveal = seat.isHero || mode === 'showdown' || mode === 'review';
  return (
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''}`} aria-label={`${seat.name} seat`}>
      <div><div className="seat-topline"><strong>{seat.name}</strong><span>{seat.role}</span></div><p>{seat.status}</p></div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>{seat.cards.map((card, index) => <CardView key={`${seat.id}-${index}`} card={card} hidden={!reveal} />)}</div>
      <dl className="seat-money"><div><dt>Stack</dt><dd>{formatMoney(seat.stack)}</dd></div><div><dt>In pot</dt><dd>{formatMoney(seat.contribution)}</dd></div></dl>
    </article>
  );
}

function App() {
  const [mode, setMode] = useState<TableMode>('turn');
  const [street, setStreet] = useState<Street>('Flop');
  const [seats, setSeats] = useState(initialSeats);
  const [timeline, setTimeline] = useState(initialTimeline);
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [coachState, setCoachState] = useState<CoachState>('idle');
  const [coachAdvice, setCoachAdvice] = useState('');
  const [lastAction, setLastAction] = useState('No action selected yet.');
  const [pendingBots, setPendingBots] = useState<string[]>([]);
  const [botContext, setBotContext] = useState<BotContext | null>(null);

  const visibleBoard = useMemo(() => board.slice(0, boardCount(street)), [street]);
  const pot = useMemo(() => seats.reduce((sum, seat) => sum + seat.contribution, 0), [seats]);
  const highBet = useMemo(() => Math.max(...seats.map((seat) => seat.contribution)), [seats]);
  const activeBot = pendingBots[0] ? seats.find((seat) => seat.id === pendingBots[0]) : undefined;
  const activeEvent = timeline[selectedEvent];

  useEffect(() => {
    if (!activeBot || !botContext || mode !== 'turn') return;
    const timer = window.setTimeout(() => {
      const decision = getBotDecision(activeBot, botContext.street, pot, highBet, botContext.visibleBoard);
      setSeats((current) => current.map((seat) => seat.id === activeBot.id ? { ...seat, contribution: decision.action === 'Fold' ? seat.contribution : seat.contribution + decision.amount, stack: decision.action === 'Fold' ? seat.stack : Math.max(0, seat.stack - decision.amount), folded: decision.action === 'Fold' || seat.folded, status: decision.status } : seat));
      setTimeline((current) => [...current, { street: botContext.street, actor: activeBot.name, action: decision.action, amount: decision.amount || undefined, note: decision.note }]);
      setLastAction(`${activeBot.name} ${decision.action.toLowerCase()}${decision.amount ? `s ${formatMoney(decision.amount)}` : 's'}.`);
      setPendingBots((current) => {
        const nextQueue = current.slice(1);
        if (nextQueue.length === 0) setBotContext(null);
        return nextQueue;
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeBot, botContext, highBet, mode, pot]);

  const runAction = (action: string) => {
    const amount = action.includes('$') ? Number(action.split('$')[1]) : 0;
    const nextSeats = seats.map((seat) => seat.isHero ? { ...seat, contribution: action === 'Fold' ? seat.contribution : seat.contribution + amount, stack: action === 'Fold' ? seat.stack : Math.max(0, seat.stack - amount), folded: action === 'Fold', status: action === 'Fold' ? 'Folded' : 'Line chosen' } : seat);
    setSeats(nextSeats);
    setTimeline((current) => [...current, { street, actor: 'You', action: action.split(' ')[0], amount: amount || undefined, note: `Hero chooses ${action.toLowerCase()} after weighing ${texture(visibleBoard)} and prior action.` }]);
    setLastAction(`Selected ${action}. Bots are resolving the rest of the street.`);
    setBotContext({ street, visibleBoard });
    setPendingBots(botOrder.filter((id) => nextSeats.some((seat) => seat.id === id && !seat.folded)));
  };
  const askCoach = () => {
    setCoachState('loading');
    window.setTimeout(() => {
      const nextAdvice = buildCoachAdvice(street, visibleBoard, seats, timeline);
      setCoachAdvice((current) => current === nextAdvice ? current : nextAdvice);
      setCoachState('ready');
    }, 450);
  };
  const reset = () => {
    setMode('turn'); setStreet('Flop'); setSeats(initialSeats); setTimeline(initialTimeline); setSelectedEvent(0); setCoachState('idle'); setCoachAdvice(''); setPendingBots([]); setBotContext(null); setLastAction('New hand loaded. Action is on you.');
  };
  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedEvent((current) => Math.min(timeline.length - 1, current + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedEvent((current) => Math.max(0, current - 1)); }
  };

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar"><div><p className="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div><div className="status-group" aria-label="table state controls">{(['turn', 'showdown', 'review'] as TableMode[]).map((state) => <button className={mode === state ? 'state-chip active' : 'state-chip'} key={state} onClick={() => setMode(state)} type="button">{state === 'turn' ? 'Player Turn' : state[0].toUpperCase() + state.slice(1)}</button>)}</div></header>
        <div className={`table-stage mode-${mode}`}><div className="state-banner" role="status" aria-live="polite"><span>{mode === 'turn' ? 'Player Turn' : mode}</span><p>{activeBot ? `${activeBot.name} is resolving action.` : 'Choose a line, ask the coach, or review the hand.'}</p></div><div className="felt" aria-label="Poker table"><div className="board"><p>Board</p><div className="board-cards">{board.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= visibleBoard.length} />)}</div><dl className="pot-summary"><div><dt>Pot</dt><dd>{formatMoney(pot)}</dd></div><div><dt>Blinds</dt><dd>$15 / $30</dd></div></dl></div><div className="seats-grid">{seats.map((seat) => <SeatView key={seat.id} seat={seat} mode={mode} />)}</div></div></div>
        <section className="action-panel" aria-labelledby="actions-title"><div><h2 id="actions-title">Player Actions</h2><p aria-live="polite">{activeBot ? `${activeBot.name} is thinking through position, pot odds, and board texture.` : lastAction}</p></div><div className="action-grid">{['Fold', 'Call $90', 'Raise $270'].map((action) => <button className="primary-action" disabled={mode !== 'turn' || pendingBots.length > 0} key={action} onClick={() => runAction(action)} type="button"><span>{action}</span><small>{mode === 'turn' && !pendingBots.length ? 'Available' : 'Locked'}</small></button>)}<button className="ghost-action" onClick={reset} type="button">New Hand</button><button className="ghost-action" disabled={pendingBots.length > 0} onClick={() => setStreet((current) => streets[Math.min(streets.indexOf(current) + 1, streets.length - 1)])} type="button">Next Street</button></div></section>
      </section>
      <aside className="side-rail" aria-label="Training side panels">
        <section className="coach-panel" aria-labelledby="coach-title"><div className="panel-heading"><div><p className="eyebrow">Opt-in</p><h2 id="coach-title">Coach</h2></div><button onClick={askCoach} type="button">Ask</button></div>{coachState === 'idle' && <p className="muted">Coach is hidden until requested, so table decisions stay primary.</p>}{coachState === 'loading' && <div className="coach-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />Loading range advice...</div>}{coachState === 'ready' && <div className="coach-card"><strong>Suggested line: raise for value to about 65-75% pot</strong><p>{coachAdvice}</p></div>}{coachState === 'error' && <div className="error-box" role="alert">Coach failed to load. Keep playing or retry when the trainer reconnects.</div>}<button className="text-button" onClick={() => setCoachState('error')} type="button">Simulate coach error</button></section>
        <section className="review-panel" aria-labelledby="review-title"><div className="panel-heading"><div><p className="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button onClick={() => setHistoryVisible((visible) => !visible)} type="button">{historyVisible ? 'Hide' : 'Show'}</button></div>{historyVisible ? <><div aria-label="Hand timeline" className="timeline" onKeyDown={handleTimelineKey} role="listbox" tabIndex={0}>{timeline.map((event, index) => <button aria-selected={selectedEvent === index} className={selectedEvent === index ? 'timeline-item active' : 'timeline-item'} key={`${event.street}-${event.actor}-${index}`} onClick={() => { setSelectedEvent(index); setMode('review'); }} role="option" type="button"><span>{event.street}</span><strong>{event.actor}: {event.action}{event.amount ? ` ${formatMoney(event.amount)}` : ''}</strong></button>)}</div><article className="review-detail"><h3>{activeEvent.action} review</h3><p>{activeEvent.note}</p></article></> : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}</section>
      </aside>
    </main>
  );
}

export default App;
