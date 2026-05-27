import { KeyboardEvent, useEffect, useMemo, useState } from 'react';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Street = 'Preflop' | 'Flop' | 'Turn' | 'River';
type TableMode = 'turn' | 'bots' | 'showdown' | 'review';
type CoachState = 'idle' | 'loading' | 'ready' | 'error';
type BotStyle = 'loose-aggressive' | 'balanced' | 'pressure';
type PlayerAction = 'Fold' | 'Call' | 'Raise';
type BotAction = 'Fold' | 'Check' | 'Call' | 'Bet' | 'Raise';

type Card = { rank: string; suit: Suit };
type Seat = {
  id: string;
  name: string;
  role: string;
  stack: number;
  contribution: number;
  streetContribution: number;
  status: string;
  cards: Card[];
  isHero?: boolean;
  folded?: boolean;
  style?: BotStyle;
};
type TimelineEvent = { street: string; actor: string; action: string; amount?: number; note: string };
type BotDecision = { action: BotAction; amount: number; status: string; note: string };
type BotContext = { street: Street; visibleBoard: Card[]; pot: number; highBet: number; queue: string[] };

const suitLabels: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const suitSymbols: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const streets: Street[] = ['Preflop', 'Flop', 'Turn', 'River'];
const botOrder = ['mira', 'nash', 'atlas'];

const baseBoard: Card[] = [
  { rank: '10', suit: 'clubs' },
  { rank: 'K', suit: 'diamonds' },
  { rank: '4', suit: 'spades' },
  { rank: 'A', suit: 'clubs' },
  { rank: '7', suit: 'hearts' },
];

const handRotations: Array<{ board: Card[]; hero: Card[]; mira: Card[]; nash: Card[]; atlas: Card[] }> = [
  {
    board: baseBoard,
    hero: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
    mira: [{ rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'diamonds' }],
    nash: [{ rank: '9', suit: 'spades' }, { rank: '9', suit: 'clubs' }],
    atlas: [{ rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }],
  },
  {
    board: [
      { rank: '8', suit: 'hearts' },
      { rank: '8', suit: 'clubs' },
      { rank: 'K', suit: 'spades' },
      { rank: '2', suit: 'diamonds' },
      { rank: 'Q', suit: 'hearts' },
    ],
    hero: [{ rank: 'K', suit: 'clubs' }, { rank: 'Q', suit: 'spades' }],
    mira: [{ rank: '10', suit: 'hearts' }, { rank: '9', suit: 'hearts' }],
    nash: [{ rank: 'A', suit: 'diamonds' }, { rank: 'J', suit: 'clubs' }],
    atlas: [{ rank: '7', suit: 'clubs' }, { rank: '7', suit: 'diamonds' }],
  },
];

function createSeats(handIndex: number): Seat[] {
  const hand = handRotations[handIndex % handRotations.length];
  return [
    { id: 'mira', name: 'Mira', role: 'BTN', stack: 1440, contribution: 0, streetContribution: 0, status: 'Button in position', cards: hand.mira, style: 'loose-aggressive' },
    { id: 'nash', name: 'Nash Bot', role: 'SB', stack: 970, contribution: 15, streetContribution: 15, status: 'Small blind posted', cards: hand.nash, style: 'balanced' },
    { id: 'hero', name: 'You', role: 'BB', stack: 1470, contribution: 30, streetContribution: 30, status: 'Big blind posted', cards: hand.hero, isHero: true },
    { id: 'atlas', name: 'Atlas', role: 'CO', stack: 1080, contribution: 0, streetContribution: 0, status: 'Cutoff weighing range', cards: hand.atlas, style: 'pressure' },
  ];
}

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

function rankValue(rank: string) {
  return ranks.length - ranks.indexOf(rank);
}

function handStrength(cards: Card[], visibleBoard: Card[]) {
  const allCards = [...cards, ...visibleBoard];
  const rankCounts = allCards.reduce<Record<string, number>>((counts, card) => ({ ...counts, [card.rank]: (counts[card.rank] || 0) + 1 }), {});
  const suitCounts = allCards.reduce<Record<Suit, number>>((counts, card) => ({ ...counts, [card.suit]: counts[card.suit] + 1 }), { spades: 0, hearts: 0, diamonds: 0, clubs: 0 });
  const madeRanks = Object.entries(rankCounts).filter(([, count]) => count >= 2);
  const pocketPair = cards[0]?.rank === cards[1]?.rank;
  const suited = cards[0]?.suit === cards[1]?.suit;
  const overcards = visibleBoard.length ? cards.filter((card) => rankValue(card.rank) > Math.max(...visibleBoard.map((boardCard) => rankValue(boardCard.rank)))).length : 0;

  if (Object.values(rankCounts).some((count) => count >= 3) && madeRanks.length >= 2) return 92;
  if (madeRanks.length >= 2) return 84;
  if (madeRanks.some(([rank]) => cards.some((card) => card.rank === rank) && rankValue(rank) >= 10)) return 76;
  if (pocketPair && !visibleBoard.some((card) => rankValue(card.rank) > rankValue(cards[0].rank))) return 70;
  if (Object.values(suitCounts).some((count) => count >= 4) && suited) return 66;
  if (pocketPair) return 60;
  if (overcards >= 2 || (cards.some((card) => card.rank === 'A') && cards.some((card) => ['K', 'Q', 'J', '10'].includes(card.rank)))) return 56;
  return suited ? 46 : 34;
}

function getBotDecision(seat: Seat, context: BotContext): BotDecision {
  const callCost = Math.max(0, context.highBet - seat.streetContribution);
  const potOdds = callCost === 0 ? 0 : callCost / Math.max(1, context.pot + callCost);
  const boardRead = texture(context.visibleBoard);
  const styleBoost = seat.style === 'loose-aggressive' ? 10 : seat.style === 'pressure' ? 6 : 0;
  const positionBoost = seat.role === 'BTN' || seat.role === 'CO' ? 6 : -2;
  const pressurePenalty = callCost > seat.stack * 0.18 ? 16 : 0;
  const score = handStrength(seat.cards, context.visibleBoard) + styleBoost + positionBoost - pressurePenalty - (potOdds > 0.36 ? 8 : 0);

  if (callCost > 0 && score < 48) {
    return { action: 'Fold', amount: 0, status: 'Folded exploitatively', note: `${seat.role} folds versus ${formatMoney(callCost)} more: weak range realization, ${Math.round(potOdds * 100)}% pot odds, ${boardRead}.` };
  }

  if (score >= 78) {
    const target = Math.max(context.highBet + Math.max(60, callCost), Math.round(context.pot * (seat.style === 'pressure' ? 0.78 : 0.62)));
    const amount = Math.min(seat.stack, target - seat.streetContribution);
    return { action: callCost > 0 ? 'Raise' : 'Bet', amount, status: 'Value-heavy pressure', note: `${seat.role} uses a ${seat.style === 'loose-aggressive' ? 'thin value/semi-bluff' : 'GTO value'} raise on ${context.street}: strong score, blocker pressure, and ${boardRead}.` };
  }

  if (callCost > 0) {
    return { action: 'Call', amount: Math.min(seat.stack, callCost), status: 'Continues at frequency', note: `${seat.role} calls ${formatMoney(callCost)} with enough equity and board coverage to avoid over-folding on ${boardRead}.` };
  }

  if (score >= 62 && context.street !== 'Preflop') {
    const amount = Math.min(seat.stack, Math.max(45, Math.round(context.pot * 0.45)));
    return { action: 'Bet', amount, status: 'Probes capped ranges', note: `${seat.role} bets ${formatMoney(amount)} as a range probe after checked action; sizing keeps bluffs credible on ${boardRead}.` };
  }

  return { action: 'Check', amount: 0, status: 'Checks range', note: `${seat.role} checks to protect medium-strength hands and keep bluff-catchers in range on ${boardRead}.` };
}

function buildCoachAdvice(street: Street, visibleBoard: Card[], seats: Seat[], timeline: TimelineEvent[]) {
  const hero = seats.find((seat) => seat.isHero)!;
  const pot = seats.reduce((sum, seat) => sum + seat.contribution, 0);
  const callCost = Math.max(0, Math.max(...seats.map((seat) => seat.streetContribution)) - hero.streetContribution);
  const recent = timeline.slice(-4).map((event) => `${event.actor} ${event.action}${event.amount ? ` ${formatMoney(event.amount)}` : ''}`).join(', ');
  const boardText = visibleBoard.map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ') || 'not dealt';
  return `Hero holds ${hero.cards.map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ')} on ${street.toLowerCase()} with ${formatMoney(pot)} in the pot and ${formatMoney(callCost)} to call. Board: ${boardText} (${texture(visibleBoard)}). Recent action: ${recent || 'none'}. Prefer value-heavy pressure with top range, but fold the bottom when bot sizing creates poor realization.`;
}

function winnerName(seats: Seat[], visibleBoard: Card[]) {
  return seats
    .filter((seat) => !seat.folded)
    .sort((a, b) => handStrength(b.cards, visibleBoard) - handStrength(a.cards, visibleBoard))[0]?.name || 'No winner';
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
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''} ${seat.folded ? 'seat-folded' : ''}`} aria-label={`${seat.name} seat`}>
      <div>
        <div className="seat-topline"><strong>{seat.name}</strong><span>{seat.role}</span></div>
        <p>{seat.status}</p>
      </div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>{seat.cards.map((card, index) => <CardView key={`${seat.id}-${index}`} card={card} hidden={!reveal} />)}</div>
      <dl className="seat-money"><div><dt>Stack</dt><dd>{formatMoney(seat.stack)}</dd></div><div><dt>In pot</dt><dd>{formatMoney(seat.contribution)}</dd></div></dl>
    </article>
  );
}

function App() {
  const [handIndex, setHandIndex] = useState(0);
  const [mode, setMode] = useState<TableMode>('turn');
  const [street, setStreet] = useState<Street>('Preflop');
  const [seats, setSeats] = useState(() => createSeats(0));
  const [timeline, setTimeline] = useState<TimelineEvent[]>([{ street: 'Preflop', actor: 'Dealer', action: 'Deal', note: 'Blinds posted. Action starts preflop with a full hand flow.' }]);
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [coachState, setCoachState] = useState<CoachState>('idle');
  const [coachAdvice, setCoachAdvice] = useState('');
  const [lastAction, setLastAction] = useState('Action is on you preflop.');
  const [pendingBots, setPendingBots] = useState<string[]>([]);
  const [botContext, setBotContext] = useState<BotContext | null>(null);
  const [autoResetArmed, setAutoResetArmed] = useState(false);

  const currentBoard = handRotations[handIndex % handRotations.length].board;
  const visibleBoard = useMemo(() => currentBoard.slice(0, boardCount(street)), [currentBoard, street]);
  const pot = useMemo(() => seats.reduce((sum, seat) => sum + seat.contribution, 0), [seats]);
  const highBet = useMemo(() => Math.max(...seats.map((seat) => seat.streetContribution)), [seats]);
  const activeBot = pendingBots[0] ? seats.find((seat) => seat.id === pendingBots[0]) : undefined;
  const activeEvent = timeline[selectedEvent] || timeline[timeline.length - 1];
  const activePlayers = seats.filter((seat) => !seat.folded);
  const streetLabel = mode === 'showdown' ? 'Showdown' : street;

  const reset = (nextIndex = handIndex + 1) => {
    const nextSeats = createSeats(nextIndex);
    setHandIndex(nextIndex);
    setMode('turn');
    setStreet('Preflop');
    setSeats(nextSeats);
    setTimeline([{ street: 'Preflop', actor: 'Dealer', action: 'Deal', note: `Hand ${nextIndex + 1} begins. Blinds posted and action starts preflop.` }]);
    setSelectedEvent(0);
    setCoachState('idle');
    setCoachAdvice('');
    setPendingBots([]);
    setBotContext(null);
    setAutoResetArmed(false);
    setLastAction('New hand loaded. Action is on you preflop.');
  };

  const finishHand = (reason: string, nextSeats = seats, boardForResult = visibleBoard) => {
    const winner = winnerName(nextSeats, boardForResult);
    const finalPot = nextSeats.reduce((sum, seat) => sum + seat.contribution, 0);
    setMode('showdown');
    setPendingBots([]);
    setBotContext(null);
    setAutoResetArmed(true);
    setTimeline((current) => [...current, { street: 'Showdown', actor: 'Dealer', action: 'Award pot', amount: finalPot, note: `${reason} ${winner} wins ${formatMoney(finalPot)}. A fresh hand will load automatically.` }]);
    setLastAction(`${winner} wins ${formatMoney(finalPot)}. New hand starts automatically.`);
  };

  const advanceAfterStreet = (nextSeats: Seat[]) => {
    const remaining = nextSeats.filter((seat) => !seat.folded);
    if (remaining.length <= 1) {
      finishHand('All other players folded.', nextSeats);
      return;
    }

    const streetIndex = streets.indexOf(street);
    if (streetIndex === streets.length - 1) {
      finishHand('River betting completed.', nextSeats, currentBoard);
      return;
    }

    const nextStreet = streets[streetIndex + 1];
    setStreet(nextStreet);
    setMode('turn');
    setSeats(nextSeats.map((seat) => ({ ...seat, streetContribution: 0, status: seat.folded ? 'Folded' : seat.isHero ? `Action on you: ${nextStreet}` : `Waiting on ${nextStreet}` })));
    setTimeline((current) => [...current, { street: nextStreet, actor: 'Dealer', action: 'Deal street', note: `${nextStreet} is dealt automatically. Board now shows ${boardCount(nextStreet)} cards.` }]);
    setLastAction(`${nextStreet} dealt. Action is back on you.`);
  };

  useEffect(() => {
    if (!activeBot || !botContext || mode !== 'bots') return;
    const timer = window.setTimeout(() => {
      const decision = getBotDecision(activeBot, botContext);
      let resolvedSeats: Seat[] = [];
      setSeats((current) => {
        resolvedSeats = current.map((seat) => {
          if (seat.id !== activeBot.id) return seat;
          const nextContribution = decision.action === 'Fold' ? seat.contribution : seat.contribution + decision.amount;
          return {
            ...seat,
            contribution: nextContribution,
            streetContribution: decision.action === 'Fold' ? seat.streetContribution : seat.streetContribution + decision.amount,
            stack: decision.action === 'Fold' ? seat.stack : Math.max(0, seat.stack - decision.amount),
            folded: decision.action === 'Fold' || seat.folded,
            status: decision.status,
          };
        });
        return resolvedSeats;
      });
      setTimeline((current) => [...current, { street: botContext.street, actor: activeBot.name, action: decision.action, amount: decision.amount || undefined, note: decision.note }]);
      setLastAction(`${activeBot.name} ${decision.action.toLowerCase()}${decision.amount ? `s ${formatMoney(decision.amount)}` : 's'}.`);
      setPendingBots((current) => {
        const nextQueue = current.slice(1);
        if (nextQueue.length === 0) {
          setBotContext(null);
          window.setTimeout(() => advanceAfterStreet(resolvedSeats), 150);
        }
        return nextQueue;
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeBot, botContext, mode]);

  useEffect(() => {
    if (!autoResetArmed) return;
    const timer = window.setTimeout(() => reset(), 1800);
    return () => window.clearTimeout(timer);
  }, [autoResetArmed]);

  const runAction = (action: PlayerAction) => {
    const targetByAction: Record<PlayerAction, number> = { Fold: 0, Call: highBet, Raise: Math.max(highBet + 90, Math.round((pot + Math.max(0, highBet - seats.find((seat) => seat.isHero)?.streetContribution!)) * 0.72)) };
    let nextSeats = seats.map((seat) => {
      if (!seat.isHero) return seat;
      const callCost = Math.max(0, targetByAction[action] - seat.streetContribution);
      return {
        ...seat,
        contribution: action === 'Fold' ? seat.contribution : seat.contribution + callCost,
        streetContribution: action === 'Fold' ? seat.streetContribution : seat.streetContribution + callCost,
        stack: action === 'Fold' ? seat.stack : Math.max(0, seat.stack - callCost),
        folded: action === 'Fold',
        status: action === 'Fold' ? 'Folded' : 'Line chosen',
      };
    });

    const amount = action === 'Fold' ? 0 : Math.max(0, targetByAction[action] - (seats.find((seat) => seat.isHero)?.streetContribution || 0));
    setSeats(nextSeats);
    setTimeline((current) => [...current, { street, actor: 'You', action, amount: amount || undefined, note: `Hero chooses ${action.toLowerCase()} after weighing ${texture(visibleBoard)}, position, and prior sizing.` }]);

    if (action === 'Fold') {
      finishHand('Hero folded.', nextSeats);
      return;
    }

    const nextPot = nextSeats.reduce((sum, seat) => sum + seat.contribution, 0);
    const nextHighBet = Math.max(...nextSeats.map((seat) => seat.streetContribution));
    const queue = botOrder.filter((id) => nextSeats.some((seat) => seat.id === id && !seat.folded));
    setLastAction(`Selected ${action}${amount ? ` ${formatMoney(amount)}` : ''}. Bots are resolving the street.`);
    setMode('bots');
    setBotContext({ street, visibleBoard, pot: nextPot, highBet: nextHighBet, queue });
    setPendingBots(queue);

    if (!queue.length) {
      nextSeats = nextSeats.map((seat) => ({ ...seat }));
      advanceAfterStreet(nextSeats);
    }
  };

  const askCoach = () => {
    setCoachState('loading');
    window.setTimeout(() => {
      const nextAdvice = buildCoachAdvice(street, visibleBoard, seats, timeline);
      setCoachAdvice((current) => current === nextAdvice ? current : nextAdvice);
      setCoachState('ready');
    }, 450);
  };

  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedEvent((current) => Math.min(timeline.length - 1, current + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedEvent((current) => Math.max(0, current - 1)); }
  };

  const hero = seats.find((seat) => seat.isHero)!;
  const callCost = Math.max(0, highBet - hero.streetContribution);
  const raiseTarget = Math.max(highBet + 90, Math.round((pot + callCost) * 0.72));
  const actions: Array<{ action: PlayerAction; label: string }> = [
    { action: 'Fold', label: 'Fold' },
    { action: 'Call', label: callCost ? `Call ${formatMoney(callCost)}` : 'Check' },
    { action: 'Raise', label: `Raise to ${formatMoney(raiseTarget)}` },
  ];

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar">
          <div><p className="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div>
          <div className="status-group" aria-label="table state controls">{(['turn', 'bots', 'showdown', 'review'] as TableMode[]).map((state) => <button className={mode === state ? 'state-chip active' : 'state-chip'} disabled={state === 'bots'} key={state} onClick={() => setMode(state)} type="button">{state === 'turn' ? 'Player Turn' : state === 'bots' ? 'Bots' : state[0].toUpperCase() + state.slice(1)}</button>)}</div>
        </header>
        <div className={`table-stage mode-${mode}`}>
          <div className="state-banner" role="status" aria-live="polite"><span>{streetLabel}</span><p>{activeBot ? `${activeBot.name} is resolving action.` : mode === 'showdown' ? 'Showdown complete. Fresh hand is queued.' : 'Choose a line, ask the coach, or review the hand.'}</p></div>
          <div className="felt" aria-label="Poker table">
            <div className="board"><p>Board</p><div className="board-cards">{currentBoard.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= visibleBoard.length && mode !== 'showdown'} />)}</div><dl className="pot-summary"><div><dt>Pot</dt><dd>{formatMoney(pot)}</dd></div><div><dt>Active</dt><dd>{activePlayers.length}</dd></div></dl></div>
            <div className="seats-grid">{seats.map((seat) => <SeatView key={seat.id} seat={seat} mode={mode} />)}</div>
          </div>
        </div>
        <section className="action-panel" aria-labelledby="actions-title">
          <div><h2 id="actions-title">Player Actions</h2><p aria-live="polite">{activeBot ? `${activeBot.name} is thinking through range, pot odds, blockers, and board texture.` : lastAction}</p></div>
          <div className="action-grid">{actions.map(({ action, label }) => <button className="primary-action" disabled={mode !== 'turn' || pendingBots.length > 0} key={action} onClick={() => runAction(action)} type="button"><span>{label}</span><small>{mode === 'turn' && !pendingBots.length ? 'Available' : 'Locked'}</small></button>)}<button className="ghost-action" onClick={() => reset()} type="button">New Hand</button></div>
        </section>
      </section>
      <aside className="side-rail" aria-label="Training side panels">
        <section className="coach-panel" aria-labelledby="coach-title"><div className="panel-heading"><div><p className="eyebrow">Opt-in</p><h2 id="coach-title">Coach</h2></div><button onClick={askCoach} type="button">Ask</button></div>{coachState === 'idle' && <p className="muted">Coach is hidden until requested, so table decisions stay primary.</p>}{coachState === 'loading' && <div className="coach-state" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" />Loading range advice...</div>}{coachState === 'ready' && <div className="coach-card"><strong>Suggested line: pressure value, fold dominated lows</strong><p>{coachAdvice}</p></div>}{coachState === 'error' && <div className="error-box" role="alert">Coach failed to load. Keep playing or retry when the trainer reconnects.</div>}<button className="text-button" onClick={() => setCoachState('error')} type="button">Simulate coach error</button></section>
        <section className="review-panel" aria-labelledby="review-title"><div className="panel-heading"><div><p className="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button onClick={() => setHistoryVisible((visible) => !visible)} type="button">{historyVisible ? 'Hide' : 'Show'}</button></div>{historyVisible ? <><div aria-label="Hand timeline" className="timeline" onKeyDown={handleTimelineKey} role="listbox" tabIndex={0}>{timeline.map((event, index) => <button aria-selected={selectedEvent === index} className={selectedEvent === index ? 'timeline-item active' : 'timeline-item'} key={`${event.street}-${event.actor}-${index}`} onClick={() => { setSelectedEvent(index); setMode('review'); }} role="option" type="button"><span>{event.street}</span><strong>{event.actor}: {event.action}{event.amount ? ` ${formatMoney(event.amount)}` : ''}</strong></button>)}</div><article className="review-detail"><h3>{activeEvent.action} review</h3><p>{activeEvent.note}</p></article></> : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}</section>
      </aside>
    </main>
  );
}

export default App;
