import './styles.css';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Street = 'Preflop' | 'Flop' | 'Turn' | 'River';
type TableMode = 'turn' | 'showdown' | 'review';
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

const suitLabels: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const suitSymbols: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
const board: Card[] = [
  { rank: '10', suit: 'clubs' },
  { rank: 'K', suit: 'diamonds' },
  { rank: '4', suit: 'spades' },
  { rank: 'A', suit: 'clubs' },
  { rank: '7', suit: 'hearts' },
];
const baseSeats: Seat[] = [
  { id: 'mira', name: 'Mira', role: 'BTN', stack: 1240, contribution: 60, status: 'Calls wide', cards: [{ rank: 'Q', suit: 'diamonds' }, { rank: 'J', suit: 'diamonds' }], style: 'loose-aggressive' },
  { id: 'nash', name: 'Nash Bot', role: 'SB', stack: 930, contribution: 30, status: 'Thinking', cards: [{ rank: '9', suit: 'spades' }, { rank: '9', suit: 'clubs' }], style: 'balanced' },
  { id: 'hero', name: 'You', role: 'BB', stack: 1470, contribution: 120, status: 'Action on you', cards: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }], isHero: true },
  { id: 'atlas', name: 'Atlas', role: 'CO', stack: 860, contribution: 0, status: 'Folded', cards: [{ rank: 'A', suit: 'hearts' }, { rank: 'Q', suit: 'clubs' }], folded: true, style: 'pressure' },
];
const baseTimeline: TimelineEvent[] = [
  { street: 'Preflop', actor: 'Atlas', action: 'Fold', note: 'CO gives up after a 3-bet sizing cue.' },
  { street: 'Preflop', actor: 'Mira', action: 'Call', amount: 60, note: 'Button keeps suited broadways in range.' },
  { street: 'Flop', actor: 'You', action: 'Bet', amount: 90, note: 'Top pair, strong kicker; denies equity.' },
  { street: 'Turn', actor: 'Nash Bot', action: 'Check', note: 'Small blind range is capped after passive line.' },
];

let seats = structuredClone(baseSeats) as Seat[];
let timeline = structuredClone(baseTimeline) as TimelineEvent[];
let mode: TableMode = 'turn';
let street: Street = 'Flop';
let selectedEvent = 0;
let historyVisible = true;
let coach: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let coachAdvice = '';
let lastAction = 'No action selected yet.';
let pendingBots: string[] = [];
let botTimer = 0;

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const appRoot = root;

function money(value: number) {
  return `$${value.toLocaleString()}`;
}
function visibleBoard() {
  return board.slice(0, street === 'Preflop' ? 0 : street === 'Flop' ? 3 : street === 'Turn' ? 4 : 5);
}
function texture(cards: Card[]) {
  if (cards.length < 3) return 'no board yet; preflop ranges and position dominate';
  const suits = cards.reduce<Record<Suit, number>>((acc, card) => ({ ...acc, [card.suit]: acc[card.suit] + 1 }), { spades: 0, hearts: 0, diamonds: 0, clubs: 0 });
  const paired = new Set(cards.map((card) => card.rank)).size < cards.length;
  const flushy = Object.values(suits).some((count) => count >= 3);
  const broadway = cards.filter((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank)).length >= 2;
  return `${paired ? 'paired' : 'unpaired'}, ${flushy ? 'flush-heavy' : 'rainbow/two-tone'}, ${broadway ? 'broadway-connected' : 'low-card'} texture`;
}
function strength(cards: Card[], table: Card[]) {
  const ranks = [...cards, ...table].map((card) => card.rank);
  const pairs = new Set(ranks.filter((rank) => ranks.filter((item) => item === rank).length >= 2)).size;
  if (pairs >= 2) return 86;
  if (pairs && cards.some((card) => card.rank === 'A')) return 78;
  if (pairs) return 64;
  if (cards.some((card) => card.rank === 'A') && cards.every((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank))) return 58;
  return cards[0]?.suit === cards[1]?.suit ? 48 : 34;
}
function botDecision(seat: Seat) {
  const pot = seats.reduce((sum, item) => sum + item.contribution, 0);
  const high = Math.max(...seats.map((item) => item.contribution));
  const call = Math.max(0, high - seat.contribution);
  const score = strength(seat.cards, visibleBoard()) + (seat.style === 'loose-aggressive' ? 12 : seat.style === 'pressure' ? 8 : 0) + (seat.role === 'BTN' || seat.role === 'CO' ? 7 : 0) - (call > seat.stack * 0.22 ? 14 : 0) - (call > 0 && call / (pot + call) > 0.34 ? 8 : 0);
  if (call > 0 && score < 46) return { action: 'Fold', amount: 0, status: 'Folded under pressure', note: `${seat.role} releases versus ${money(call)} more: ${texture(visibleBoard())}, weak equity, and poor pot odds.` };
  if (score >= 74) {
    const amount = Math.min(seat.stack, Math.max(high + 120, Math.round(pot * 0.65)));
    return { action: call > 0 ? 'Raise' : 'Bet', amount, status: 'Pressuring range', note: `${seat.role} applies stack pressure with ${money(amount)}: strong range, ${texture(visibleBoard())}, and fold equity against capped lines.` };
  }
  if (call > 0) return { action: 'Call', amount: call, status: 'Continues with equity', note: `${seat.role} continues for ${money(call)} with playable equity and acceptable pot odds on ${texture(visibleBoard())}.` };
  return { action: 'Check', amount: 0, status: 'Checks range', note: `${seat.role} checks range on ${texture(visibleBoard())}, protecting medium-strength hands and inducing bets.` };
}
function cardHtml(card: Card, hidden = false) {
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return `<span class="card ${red ? 'card-red' : 'card-black'} ${hidden ? 'card-hidden' : ''}"><span class="card-rank">${hidden ? '?' : card.rank}</span><span class="card-suit" aria-hidden="true">${hidden ? '*' : suitSymbols[card.suit]}</span><span class="sr-only">${hidden ? 'hidden card' : `${card.rank} of ${card.suit}`}</span>${hidden ? '' : `<span class="suit-code">${suitLabels[card.suit]}</span>`}</span>`;
}
function seatHtml(seat: Seat) {
  const reveal = seat.isHero || mode === 'showdown' || mode === 'review';
  return `<article class="seat ${seat.isHero ? 'seat-hero' : ''}" aria-label="${seat.name} seat"><div><div class="seat-topline"><strong>${seat.name}</strong><span>${seat.role}</span></div><p>${seat.status}</p></div><div class="seat-cards" aria-label="${seat.name} cards">${seat.cards.map((card) => cardHtml(card, !reveal)).join('')}</div><dl class="seat-money"><div><dt>Stack</dt><dd>${money(seat.stack)}</dd></div><div><dt>In pot</dt><dd>${money(seat.contribution)}</dd></div></dl></article>`;
}
function render() {
  const pot = seats.reduce((sum, seat) => sum + seat.contribution, 0);
  const activeBot = pendingBots[0] ? seats.find((seat) => seat.id === pendingBots[0]) : null;
  const activeEvent = timeline[selectedEvent];
  appRoot.innerHTML = `<main class="app-shell"><section class="table-panel" aria-labelledby="table-title"><header class="top-bar"><div><p class="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div><div class="status-group" aria-label="table state controls">${(['turn', 'showdown', 'review'] as TableMode[]).map((state) => `<button class="state-chip ${mode === state ? 'active' : ''}" data-mode="${state}" type="button">${state === 'turn' ? 'Player Turn' : state[0].toUpperCase() + state.slice(1)}</button>`).join('')}</div></header><div class="table-stage mode-${mode}"><div class="state-banner" role="status" aria-live="polite"><span>${mode === 'turn' ? 'Player Turn' : mode}</span><p>${activeBot ? `${activeBot.name} is resolving action.` : 'Choose a line, ask the coach, or review the hand.'}</p></div><div class="felt" aria-label="Poker table"><div class="board"><p>Board</p><div class="board-cards">${board.map((card, index) => cardHtml(card, index >= visibleBoard().length)).join('')}</div><dl class="pot-summary"><div><dt>Pot</dt><dd>${money(pot)}</dd></div><div><dt>Blinds</dt><dd>$15 / $30</dd></div></dl></div><div class="seats-grid">${seats.map(seatHtml).join('')}</div></div></div><section class="action-panel" aria-labelledby="actions-title"><div><h2 id="actions-title">Player Actions</h2><p aria-live="polite">${activeBot ? `${activeBot.name} is thinking through position, pot odds, and board texture.` : lastAction}</p></div><div class="action-grid">${['Fold', 'Call $90', 'Raise $270'].map((action) => `<button class="primary-action" data-action="${action}" ${mode !== 'turn' || pendingBots.length ? 'disabled' : ''} type="button"><span>${action}</span><small>${mode === 'turn' && !pendingBots.length ? 'Available' : 'Locked'}</small></button>`).join('')}<button class="ghost-action" data-reset type="button">New Hand</button><button class="ghost-action" data-street type="button">Next Street</button></div></section></section><aside class="side-rail" aria-label="Training side panels"><section class="coach-panel" aria-labelledby="coach-title"><div class="panel-heading"><div><p class="eyebrow">Opt-in</p><h2 id="coach-title">Coach</h2></div><button data-coach type="button">Ask</button></div>${coach === 'idle' ? '<p class="muted">Coach is hidden until requested, so table decisions stay primary.</p>' : ''}${coach === 'loading' ? '<div class="coach-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span>Loading range advice...</div>' : ''}${coach === 'ready' ? `<div class="coach-card"><strong>Suggested line: raise for value to about 65-75% pot</strong><p>${coachAdvice}</p></div>` : ''}${coach === 'error' ? '<div class="error-box" role="alert">Coach failed to load. Keep playing or retry when the trainer reconnects.</div>' : ''}<button class="text-button" data-error type="button">Simulate coach error</button></section><section class="review-panel" aria-labelledby="review-title"><div class="panel-heading"><div><p class="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button data-history type="button">${historyVisible ? 'Hide' : 'Show'}</button></div>${historyVisible ? `<div aria-label="Hand timeline" class="timeline" role="listbox" tabindex="0">${timeline.map((event, index) => `<button aria-selected="${selectedEvent === index}" class="timeline-item ${selectedEvent === index ? 'active' : ''}" data-event="${index}" role="option" type="button"><span>${event.street}</span><strong>${event.actor}: ${event.action}${event.amount ? ` ${money(event.amount)}` : ''}</strong></button>`).join('')}</div><article class="review-detail"><h3>${activeEvent.action} review</h3><p>${activeEvent.note}</p></article>` : '<div class="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>'}</section></aside></main>`;
  bind();
}
function bind() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.mode as TableMode; render(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => button.addEventListener('click', () => heroAction(button.dataset.action || 'Fold')));
  document.querySelector<HTMLButtonElement>('[data-reset]')?.addEventListener('click', reset);
  document.querySelector<HTMLButtonElement>('[data-street]')?.addEventListener('click', () => { street = street === 'Flop' ? 'Turn' : 'River'; render(); });
  document.querySelector<HTMLButtonElement>('[data-coach]')?.addEventListener('click', askCoach);
  document.querySelector<HTMLButtonElement>('[data-error]')?.addEventListener('click', () => { coach = 'error'; render(); });
  document.querySelector<HTMLButtonElement>('[data-history]')?.addEventListener('click', () => { historyVisible = !historyVisible; render(); });
  document.querySelectorAll<HTMLButtonElement>('[data-event]').forEach((button) => button.addEventListener('click', () => { selectedEvent = Number(button.dataset.event); mode = 'review'; render(); }));
}
function heroAction(action: string) {
  const amount = action.includes('$') ? Number(action.split('$')[1]) : 0;
  seats = seats.map((seat) => seat.isHero ? { ...seat, contribution: action === 'Fold' ? seat.contribution : seat.contribution + amount, stack: action === 'Fold' ? seat.stack : Math.max(0, seat.stack - amount), folded: action === 'Fold', status: action === 'Fold' ? 'Folded' : 'Line chosen' } : seat);
  timeline.push({ street, actor: 'You', action: action.split(' ')[0], amount: amount || undefined, note: `Hero chooses ${action.toLowerCase()} after weighing ${texture(visibleBoard())} and prior action.` });
  pendingBots = ['mira', 'nash', 'atlas'].filter((id) => seats.some((seat) => seat.id === id && !seat.folded));
  lastAction = `Selected ${action}. Bots are resolving the rest of the street.`;
  render();
  resolveBot();
}
function resolveBot() {
  window.clearTimeout(botTimer);
  const bot = seats.find((seat) => seat.id === pendingBots[0]);
  if (!bot) return;
  botTimer = window.setTimeout(() => {
    const decision = botDecision(bot);
    seats = seats.map((seat) => seat.id === bot.id ? { ...seat, contribution: decision.action === 'Fold' ? seat.contribution : seat.contribution + decision.amount, stack: decision.action === 'Fold' ? seat.stack : Math.max(0, seat.stack - decision.amount), folded: decision.action === 'Fold' || seat.folded, status: decision.status } : seat);
    timeline.push({ street, actor: bot.name, action: decision.action, amount: decision.amount || undefined, note: decision.note });
    lastAction = `${bot.name} ${decision.action.toLowerCase()}${decision.amount ? `s ${money(decision.amount)}` : 's'}.`;
    pendingBots = pendingBots.slice(1);
    render();
    resolveBot();
  }, 650);
}
function askCoach() {
  coach = 'loading';
  render();
  window.setTimeout(() => {
    const hero = seats.find((seat) => seat.isHero)!;
    const pot = seats.reduce((sum, seat) => sum + seat.contribution, 0);
    const high = Math.max(...seats.map((seat) => seat.contribution));
    const call = Math.max(0, high - hero.contribution);
    const recent = timeline.slice(-3).map((event) => `${event.actor} ${event.action}${event.amount ? ` ${money(event.amount)}` : ''}`).join(', ');
    coachAdvice = `You have AKo from the BB on ${street.toLowerCase()} with ${money(pot)} in the pot, ${money(call)} to call, and ${Math.round(hero.stack / 30)}bb behind. Board is ${visibleBoard().map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ') || 'not dealt'} (${texture(visibleBoard())}). Recent action: ${recent || 'none'}. Your range keeps strong top-pair/two-pair advantage, but BTN can hold suited Broadway draws; prefer a sizing that charges draws while keeping dominated kings and aces in.`;
    coach = 'ready';
    render();
  }, 450);
}
function reset() {
  seats = structuredClone(baseSeats) as Seat[];
  timeline = structuredClone(baseTimeline) as TimelineEvent[];
  mode = 'turn';
  street = 'Flop';
  selectedEvent = 0;
  coach = 'idle';
  coachAdvice = '';
  pendingBots = [];
  lastAction = 'New hand loaded. Action is on you.';
  window.clearTimeout(botTimer);
  render();
}

render();
