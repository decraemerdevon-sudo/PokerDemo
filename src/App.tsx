import { KeyboardEvent, useMemo, useState } from 'react';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type TableMode = 'waiting' | 'turn' | 'showdown' | 'review';
type CoachState = 'idle' | 'loading' | 'ready' | 'error';

type Card = {
  rank: string;
  suit: Suit;
};

type Seat = {
  name: string;
  role: string;
  stack: number;
  contribution: number;
  status: string;
  cards: Card[];
  isHero?: boolean;
};

type TimelineEvent = {
  street: string;
  actor: string;
  action: string;
  amount?: number;
  note: string;
};

const suitLabels: Record<Suit, string> = {
  spades: 'S',
  hearts: 'H',
  diamonds: 'D',
  clubs: 'C',
};

const suitSymbols: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

const heroCards: Card[] = [
  { rank: 'A', suit: 'spades' },
  { rank: 'K', suit: 'hearts' },
];

const board: Card[] = [
  { rank: '10', suit: 'clubs' },
  { rank: 'K', suit: 'diamonds' },
  { rank: '4', suit: 'spades' },
  { rank: 'A', suit: 'clubs' },
  { rank: '7', suit: 'hearts' },
];

const seats: Seat[] = [
  {
    name: 'Mira',
    role: 'BTN',
    stack: 1240,
    contribution: 60,
    status: 'Calls wide',
    cards: [
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'J', suit: 'diamonds' },
    ],
  },
  {
    name: 'Nash Bot',
    role: 'SB',
    stack: 930,
    contribution: 30,
    status: 'Thinking',
    cards: [
      { rank: '?', suit: 'spades' },
      { rank: '?', suit: 'clubs' },
    ],
  },
  {
    name: 'You',
    role: 'BB',
    stack: 1470,
    contribution: 120,
    status: 'Action on you',
    cards: heroCards,
    isHero: true,
  },
  {
    name: 'Atlas',
    role: 'CO',
    stack: 860,
    contribution: 0,
    status: 'Folded',
    cards: [
      { rank: '?', suit: 'hearts' },
      { rank: '?', suit: 'diamonds' },
    ],
  },
];

const timeline: TimelineEvent[] = [
  {
    street: 'Preflop',
    actor: 'Atlas',
    action: 'Fold',
    note: 'CO gives up after a 3-bet sizing cue.',
  },
  {
    street: 'Preflop',
    actor: 'Mira',
    action: 'Call',
    amount: 60,
    note: 'Button keeps suited broadways in range.',
  },
  {
    street: 'Flop',
    actor: 'You',
    action: 'Bet',
    amount: 90,
    note: 'Top pair, strong kicker; denies equity.',
  },
  {
    street: 'Turn',
    actor: 'Nash Bot',
    action: 'Check',
    note: 'Small blind range is capped after passive line.',
  },
];

const modeCopy: Record<TableMode, { label: string; message: string }> = {
  waiting: {
    label: 'Waiting',
    message: 'Next hand is queued. Review the previous hand or start a new deal.',
  },
  turn: {
    label: 'Player Turn',
    message: 'Action is on you in the big blind. Choose fold, call, raise, or ask the coach.',
  },
  showdown: {
    label: 'Showdown',
    message: 'Cards are face up. Compare ranges and outcome before opening review.',
  },
  review: {
    label: 'Review',
    message: 'Replay key hand events and inspect the decision trail.',
  },
};

function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

function CardView({ card, hidden = false }: { card: Card; hidden?: boolean }) {
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds';

  return (
    <span className={`card ${isRed ? 'card-red' : 'card-black'} ${hidden ? 'card-hidden' : ''}`}>
      <span className="card-rank">{hidden ? '?' : card.rank}</span>
      <span aria-hidden="true" className="card-suit">
        {hidden ? '•' : suitSymbols[card.suit]}
      </span>
      <span className="sr-only">{hidden ? 'hidden card' : `${card.rank} of ${card.suit}`}</span>
      {!hidden && <span className="suit-code">{suitLabels[card.suit]}</span>}
    </span>
  );
}

function SeatView({ seat, mode }: { seat: Seat; mode: TableMode }) {
  const revealCards = seat.isHero || mode === 'showdown' || mode === 'review';

  return (
    <article className={`seat ${seat.isHero ? 'seat-hero' : ''}`} aria-label={`${seat.name} seat`}>
      <div>
        <div className="seat-topline">
          <strong>{seat.name}</strong>
          <span>{seat.role}</span>
        </div>
        <p>{seat.status}</p>
      </div>
      <div className="seat-cards" aria-label={`${seat.name} cards`}>
        {seat.cards.map((card, index) => (
          <CardView key={`${seat.name}-${index}`} card={card} hidden={!revealCards} />
        ))}
      </div>
      <dl className="seat-money">
        <div>
          <dt>Stack</dt>
          <dd>{formatMoney(seat.stack)}</dd>
        </div>
        <div>
          <dt>In pot</dt>
          <dd>{formatMoney(seat.contribution)}</dd>
        </div>
      </dl>
    </article>
  );
}

function App() {
  const [mode, setMode] = useState<TableMode>('turn');
  const [coachState, setCoachState] = useState<CoachState>('idle');
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [lastAction, setLastAction] = useState('No action selected yet.');

  const pot = useMemo(() => seats.reduce((sum, seat) => sum + seat.contribution, 0), []);
  const activeEvent = timeline[selectedEvent];

  const runAction = (action: string) => {
    setLastAction(`Selected ${action}. Trainer state remains replayable for review.`);
    if (mode === 'waiting') {
      setMode('turn');
    }
  };

  const requestCoach = () => {
    setCoachState('loading');
    window.setTimeout(() => {
      setCoachState('ready');
    }, 700);
  };

  const triggerCoachError = () => {
    setCoachState('error');
  };

  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible || timeline.length === 0) return;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedEvent((current) => Math.min(timeline.length - 1, current + 1));
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedEvent((current) => Math.max(0, current - 1));
    }
  };

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Texas Hold'em trainer</p>
            <h1 id="table-title">Training Table</h1>
          </div>
          <div className="status-group" aria-label="table state controls">
            {(['waiting', 'turn', 'showdown', 'review'] as TableMode[]).map((state) => (
              <button
                className={mode === state ? 'state-chip active' : 'state-chip'}
                key={state}
                onClick={() => setMode(state)}
                type="button"
              >
                {modeCopy[state].label}
              </button>
            ))}
          </div>
        </header>

        <div className={`table-stage mode-${mode}`}>
          <div className="state-banner" role="status" aria-live="polite">
            <span>{modeCopy[mode].label}</span>
            <p>{modeCopy[mode].message}</p>
          </div>

          <div className="felt" aria-label="Poker table">
            <div className="board">
              <p>Board</p>
              <div className="board-cards">
                {board.map((card, index) => (
                  <CardView
                    key={`${card.rank}-${card.suit}`}
                    card={card}
                    hidden={mode === 'waiting' || (mode === 'turn' && index > 2)}
                  />
                ))}
              </div>
              <dl className="pot-summary">
                <div>
                  <dt>Pot</dt>
                  <dd>{formatMoney(pot)}</dd>
                </div>
                <div>
                  <dt>Blinds</dt>
                  <dd>$15 / $30</dd>
                </div>
              </dl>
            </div>

            <div className="seats-grid">
              {seats.map((seat) => (
                <SeatView key={seat.name} seat={seat} mode={mode} />
              ))}
            </div>
          </div>
        </div>

        <section className="action-panel" aria-labelledby="actions-title">
          <div>
            <h2 id="actions-title">Player Actions</h2>
            <p aria-live="polite">{lastAction}</p>
          </div>
          <div className="action-grid">
            {['Fold', 'Call $90', 'Raise $270'].map((action) => (
              <button
                className="primary-action"
                disabled={mode !== 'turn'}
                key={action}
                onClick={() => runAction(action)}
                type="button"
              >
                <span>{action}</span>
                <small>{mode === 'turn' ? 'Available' : 'Locked'}</small>
              </button>
            ))}
            <button className="ghost-action" onClick={() => setMode('waiting')} type="button">
              New Hand
            </button>
          </div>
        </section>
      </section>

      <aside className="side-rail" aria-label="Training side panels">
        <section className="coach-panel" aria-labelledby="coach-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Opt-in</p>
              <h2 id="coach-title">Coach</h2>
            </div>
            <button onClick={requestCoach} type="button">
              Ask
            </button>
          </div>

          {coachState === 'idle' && (
            <p className="muted">Coach is hidden until requested, so table decisions stay primary.</p>
          )}
          {coachState === 'loading' && (
            <div className="coach-state" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              Loading range advice...
            </div>
          )}
          {coachState === 'ready' && (
            <div className="coach-card">
              <strong>Suggested line: raise small</strong>
              <p>
                You block top-pair combos and keep worse kings in. A smaller raise pressures capped
                blinds without folding dominated hands.
              </p>
            </div>
          )}
          {coachState === 'error' && (
            <div className="error-box" role="alert">
              Coach failed to load. Keep playing or retry when the trainer reconnects.
            </div>
          )}
          <button className="text-button" onClick={triggerCoachError} type="button">
            Simulate coach error
          </button>
        </section>

        <section className="review-panel" aria-labelledby="review-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Replay</p>
              <h2 id="review-title">Hand Timeline</h2>
            </div>
            <button onClick={() => setHistoryVisible((visible) => !visible)} type="button">
              {historyVisible ? 'Hide' : 'Show'}
            </button>
          </div>

          {!historyVisible ? (
            <div className="empty-state">
              <strong>Empty history</strong>
              <p>No hand events are selected for review.</p>
            </div>
          ) : (
            <div
              aria-label="Hand timeline"
              className="timeline"
              onKeyDown={handleTimelineKey}
              role="listbox"
              tabIndex={0}
            >
              {timeline.map((event, index) => (
                <button
                  aria-selected={selectedEvent === index}
                  className={selectedEvent === index ? 'timeline-item active' : 'timeline-item'}
                  key={`${event.street}-${event.actor}-${event.action}`}
                  onClick={() => {
                    setSelectedEvent(index);
                    setMode('review');
                  }}
                  role="option"
                  type="button"
                >
                  <span>{event.street}</span>
                  <strong>
                    {event.actor}: {event.action}
                    {event.amount ? ` ${formatMoney(event.amount)}` : ''}
                  </strong>
                </button>
              ))}
            </div>
          )}

          {historyVisible && activeEvent && (
            <article className="review-detail">
              <h3>{activeEvent.action} review</h3>
              <p>{activeEvent.note}</p>
            </article>
          )}
        </section>
      </aside>
    </main>
  );
}

export default App;
