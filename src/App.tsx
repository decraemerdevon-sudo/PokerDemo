import { KeyboardEvent, useEffect, useMemo, useState } from 'react';
import {
  ActionKind,
  Card,
  HandEvent,
  HandState,
  Seat,
  Street,
  chooseBotAction,
  createHand,
  getLegalActions,
  potSize,
  submitAction,
  visibleBoard,
} from './nlheEngine';
import { trackHandHistoryEvent } from './handHistoryAnalytics';

type TableMode = 'play' | 'review';
type CoachState = 'idle' | 'loading' | 'ready' | 'error';

const suitLabels: Record<Card['suit'], string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const suitSymbols: Record<Card['suit'], string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
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

function SeatView({ seat, street, reveal }: { seat: Seat; street: Street; reveal: boolean }) {
  const isCurrent = seat.status === 'active' && seat.lastAction.toLowerCase().includes('waiting');
  return (
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''} ${seat.status === 'folded' ? 'seat-folded' : ''} ${isCurrent ? 'seat-current' : ''}`} aria-label={`${seat.name} seat`}>
      <div>
        <div className="seat-topline"><strong>{seat.name}</strong><span>{seat.role}</span></div>
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

function sourceForAnalytics(event: HandEvent) {
  if (event.source === 'hero') return 'hero-action' as const;
  if (event.source === 'bot') return 'bot-action' as const;
  if (event.action === 'Deal street') return 'street-change' as const;
  if (event.action === 'Deal') return 'initial-state' as const;
  return 'reset' as const;
}

function App() {
  const [state, setState] = useState(() => createHand(1));
  const [mode, setMode] = useState<TableMode>('play');
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [coachState, setCoachState] = useState<CoachState>('idle');
  const [coachAdvice, setCoachAdvice] = useState('');

  const board = visibleBoard(state);
  const pot = potSize(state);
  const hero = state.seats.find((seat) => seat.isHero)!;
  const activeSeat = state.currentSeatId ? state.seats.find((seat) => seat.id === state.currentSeatId) : undefined;
  const legalActions = useMemo(() => getLegalActions(state, hero.id), [state, hero.id]);
  const activeEvent = state.events[selectedEvent] || state.events[state.events.length - 1];
  const activePlayers = state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in');
  const isHeroTurn = state.currentSeatId === hero.id && state.stage === 'awaiting-action';
  const modeLabel = state.stage === 'hand-complete' ? 'Showdown' : activeSeat?.isHero ? 'Player turn' : activeSeat ? 'Bot action' : 'Resolving';

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
      setState((current) => {
        if (current.currentSeatId !== activeSeat.id) return current;
        const decision = chooseBotAction(current, activeSeat.id);
        return submitAction(current, activeSeat.id, decision.kind, decision.targetContribution);
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeSeat, state.stage]);

  useEffect(() => {
    setSelectedEvent((current) => Math.min(current, state.events.length - 1));
  }, [state.events.length]);

  const reset = () => {
    setState((current) => createHand(current.handNumber + 1));
    setSelectedEvent(0);
    setMode('play');
    setCoachState('idle');
    setCoachAdvice('');
  };

  const runAction = (kind: ActionKind, targetContribution?: number) => {
    if (!isHeroTurn) return;
    setState((current) => submitAction(current, hero.id, kind, targetContribution));
    setMode('play');
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
            <div className="board">
              <p>Board</p>
              <div className="board-cards">{state.board.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= board.length && state.stage !== 'hand-complete'} />)}</div>
              <dl className="pot-summary"><div><dt>Pot</dt><dd>{formatMoney(pot)}</dd></div><div><dt>Active</dt><dd>{activePlayers.length}</dd></div></dl>
            </div>
            <div className="seats-grid">{state.seats.map((seat) => <SeatView key={seat.id} seat={seat} street={state.street} reveal={seat.isHero || showAllCards} />)}</div>
          </div>
        </div>
        <section className="action-panel" aria-labelledby="actions-title">
          <div><h2 id="actions-title">Legal Actions</h2><p aria-live="polite">{activeSeat?.isHero ? 'Action is on you.' : activeSeat ? `${activeSeat.name} is resolving a legal engine action.` : state.message}</p></div>
          <div className="action-grid">
            {legalActions.map((action) => (
              <button className="primary-action" disabled={!isHeroTurn} key={action.kind} onClick={() => runAction(action.kind, action.targetContribution)} type="button">
                <span>{action.label}</span>
                <small>{isHeroTurn ? 'Legal' : 'Locked'}</small>
              </button>
            ))}
            <button className="ghost-action" onClick={reset} type="button">New Hand</button>
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
              <div aria-label="Hand timeline" className="timeline" onKeyDown={handleTimelineKey} role="listbox" tabIndex={0}>
                {state.events.map((event, index) => (
                  <button aria-selected={selectedEvent === index} className={selectedEvent === index ? 'timeline-item active' : 'timeline-item'} key={event.id} onClick={() => { setSelectedEvent(index); setMode('review'); }} role="option" type="button">
                    <span>{event.street}</span><strong>{event.actor}: {event.action}{event.amount ? ` ${formatMoney(event.amount)}` : ''}</strong>
                  </button>
                ))}
              </div>
              <article className="review-detail"><h3>{activeEvent.action} review</h3><p>{activeEvent.note}</p></article>
            </>
          ) : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}
        </section>
      </aside>
    </main>
  );
}

export default App;
