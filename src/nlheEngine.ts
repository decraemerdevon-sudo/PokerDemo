export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Street = 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';
export type SeatRole = 'BTN' | 'SB' | 'BB' | 'CO';
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'out';
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type EngineStage = 'awaiting-action' | 'hand-complete';
export type BotStyle = 'loose-aggressive' | 'balanced' | 'pressure';

export type Card = { rank: Rank; suit: Suit };
export type Seat = {
  id: string;
  name: string;
  role: SeatRole;
  stack: number;
  contribution: number;
  streetContribution: number;
  status: PlayerStatus;
  cards: Card[];
  isHero?: boolean;
  style?: BotStyle;
  lastAction: string;
};

export type LegalAction = {
  kind: ActionKind;
  label: string;
  amountToPutIn: number;
  targetContribution: number;
  min?: number;
  max?: number;
};

export type HandEvent = {
  id: string;
  handId: string;
  street: Street;
  actor: string;
  action: string;
  amount?: number;
  note: string;
  source: 'engine' | 'hero' | 'bot';
};

export type HandState = {
  handId: string;
  handNumber: number;
  dealerIndex: number;
  smallBlind: number;
  bigBlind: number;
  street: Street;
  board: Card[];
  deck: Card[];
  seats: Seat[];
  currentSeatId: string | null;
  lastAggressorId: string | null;
  actedThisRound: string[];
  minRaise: number;
  events: HandEvent[];
  stage: EngineStage;
  winnerIds: string[];
  potAwarded: number;
  message: string;
};

const ranks: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const streetOrder: Street[] = ['Preflop', 'Flop', 'Turn', 'River'];

const playerBlueprints = [
  { id: 'mira', name: 'Mira', role: 'BTN' as SeatRole, stack: 1500, style: 'loose-aggressive' as BotStyle },
  { id: 'nash', name: 'Nash Bot', role: 'SB' as SeatRole, stack: 1000, style: 'balanced' as BotStyle },
  { id: 'hero', name: 'You', role: 'BB' as SeatRole, stack: 1500, isHero: true },
  { id: 'atlas', name: 'Atlas', role: 'CO' as SeatRole, stack: 1080, style: 'pressure' as BotStyle },
];

let eventCounter = 0;

function makeEvent(handId: string, street: Street, actor: string, action: string, note: string, source: HandEvent['source'], amount?: number): HandEvent {
  eventCounter += 1;
  return { id: `${handId}-${eventCounter}`, handId, street, actor, action, amount, note, source };
}

function buildDeck(seed: number) {
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = (seed * 31 + i * 17 + seed * i) % (i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck: Card[], count: number): [Card[], Card[]] {
  return [deck.slice(0, count), deck.slice(count)];
}

function postBlind(seat: Seat, blind: number) {
  const amount = Math.min(seat.stack, blind);
  return { ...seat, stack: seat.stack - amount, contribution: amount, streetContribution: amount, status: amount < blind ? 'all-in' as PlayerStatus : seat.status, lastAction: `Posted ${amount}` };
}

export function createHand(handNumber = 1): HandState {
  let deck = buildDeck(handNumber + 13);
  const seats = playerBlueprints.map((blueprint) => {
    let cards: Card[];
    [cards, deck] = draw(deck, 2);
    return { ...blueprint, contribution: 0, streetContribution: 0, status: 'active' as PlayerStatus, cards, lastAction: 'Waiting' };
  });

  const board: Card[] = [];
  let boardCards: Card[];
  [boardCards, deck] = draw(deck, 5);
  board.push(...boardCards);

  const withBlinds = seats.map((seat) => {
    if (seat.role === 'SB') return postBlind(seat, 15);
    if (seat.role === 'BB') return postBlind(seat, 30);
    return seat;
  });

  const handId = `hand-${handNumber}`;
  return {
    handId,
    handNumber,
    dealerIndex: 0,
    smallBlind: 15,
    bigBlind: 30,
    street: 'Preflop',
    board,
    deck,
    seats: withBlinds,
    currentSeatId: 'atlas',
    lastAggressorId: 'hero',
    actedThisRound: ['nash', 'hero'],
    minRaise: 30,
    events: [
      makeEvent(handId, 'Preflop', 'Dealer', 'Deal', 'New NLHE hand dealt.', 'engine'),
      makeEvent(handId, 'Preflop', 'Nash Bot', 'Small blind', 'Nash posts the small blind.', 'engine', 15),
      makeEvent(handId, 'Preflop', 'You', 'Big blind', 'Hero posts the big blind.', 'engine', 30),
    ],
    stage: 'awaiting-action',
    winnerIds: [],
    potAwarded: 0,
    message: 'Action starts preflop with Atlas under the gun.',
  };
}

export function visibleBoard(state: HandState) {
  const count = state.street === 'Preflop' ? 0 : state.street === 'Flop' ? 3 : state.street === 'Turn' ? 4 : 5;
  return state.board.slice(0, count);
}

export function potSize(state: HandState) {
  return state.seats.reduce((sum, seat) => sum + seat.contribution, 0);
}

function activeSeats(state: HandState) {
  return state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in');
}

function seatById(state: HandState, seatId: string) {
  const seat = state.seats.find((candidate) => candidate.id === seatId);
  if (!seat) throw new Error(`Unknown seat ${seatId}`);
  return seat;
}

function currentBet(state: HandState) {
  return Math.max(...state.seats.map((seat) => seat.streetContribution));
}

export function getLegalActions(state: HandState, seatId = state.currentSeatId): LegalAction[] {
  if (!seatId || state.stage !== 'awaiting-action') return [];
  const seat = seatById(state, seatId);
  if (seat.status !== 'active') return [];
  const highBet = currentBet(state);
  const callCost = Math.min(seat.stack, Math.max(0, highBet - seat.streetContribution));
  const actions: LegalAction[] = [{ kind: 'fold', label: 'Fold', amountToPutIn: 0, targetContribution: seat.streetContribution }];

  if (callCost === 0) {
    actions.push({ kind: 'check', label: 'Check', amountToPutIn: 0, targetContribution: seat.streetContribution });
    const minBet = Math.min(seat.stack, state.bigBlind);
    if (minBet > 0) actions.push({ kind: 'bet', label: `Bet ${minBet}`, amountToPutIn: minBet, targetContribution: seat.streetContribution + minBet, min: minBet, max: seat.stack });
  } else {
    actions.push({ kind: 'call', label: `Call ${callCost}`, amountToPutIn: callCost, targetContribution: seat.streetContribution + callCost });
    const minTarget = highBet + state.minRaise;
    const minRaiseCost = minTarget - seat.streetContribution;
    if (seat.stack > callCost && minRaiseCost <= seat.stack) {
      actions.push({ kind: 'raise', label: `Raise to ${minTarget}`, amountToPutIn: minRaiseCost, targetContribution: minTarget, min: minTarget, max: seat.streetContribution + seat.stack });
    }
  }

  return actions;
}

function nextSeatId(state: HandState, fromSeatId: string) {
  const start = state.seats.findIndex((seat) => seat.id === fromSeatId);
  for (let offset = 1; offset <= state.seats.length; offset += 1) {
    const candidate = state.seats[(start + offset) % state.seats.length];
    if (candidate.status === 'active') return candidate.id;
  }
  return null;
}

function roundClosed(state: HandState) {
  const contenders = state.seats.filter((seat) => seat.status === 'active');
  if (contenders.length <= 1) return true;
  const highBet = currentBet(state);
  return contenders.every((seat) => state.actedThisRound.includes(seat.id) && seat.streetContribution === highBet);
}

function nextStreet(state: HandState): Street | null {
  const index = streetOrder.indexOf(state.street);
  return index >= 0 && index < streetOrder.length - 1 ? streetOrder[index + 1] : null;
}

function resetForStreet(state: HandState, street: Street): HandState {
  const firstToAct = state.seats.find((seat) => seat.role === 'SB' && seat.status === 'active')?.id ?? state.seats.find((seat) => seat.status === 'active')?.id ?? null;
  return {
    ...state,
    street,
    currentSeatId: firstToAct,
    lastAggressorId: null,
    actedThisRound: [],
    minRaise: state.bigBlind,
    seats: state.seats.map((seat) => ({ ...seat, streetContribution: 0, lastAction: seat.status === 'folded' ? 'Folded' : `Waiting on ${street}` })),
    events: [...state.events, makeEvent(state.handId, street, 'Dealer', 'Deal street', `${street} dealt. Betting round starts from the small blind side.`, 'engine')],
    message: `${street} dealt. ${firstToAct ? seatById(state, firstToAct).name : 'No player'} acts first.`,
  };
}

function rankValue(rank: Rank) {
  return ranks.length - ranks.indexOf(rank);
}

function evaluateStrength(cards: Card[]) {
  const counts = cards.reduce<Record<string, number>>((acc, card) => ({ ...acc, [card.rank]: (acc[card.rank] ?? 0) + 1 }), {});
  const pairs = Object.values(counts).filter((count) => count === 2).length;
  const trips = Object.values(counts).some((count) => count === 3);
  const quads = Object.values(counts).some((count) => count === 4);
  const flush = suits.some((suit) => cards.filter((card) => card.suit === suit).length >= 5);
  const high = Math.max(...cards.map((card) => rankValue(card.rank)));
  return (quads ? 700 : trips && pairs ? 600 : flush ? 500 : trips ? 400 : pairs >= 2 ? 300 : pairs === 1 ? 200 : 100) + high;
}

function awardHand(state: HandState, reason: string): HandState {
  const contenders = activeSeats(state).filter((seat) => seat.status !== 'folded');
  const winners = contenders.length === 1
    ? contenders
    : [...contenders].sort((a, b) => evaluateStrength([...b.cards, ...state.board]) - evaluateStrength([...a.cards, ...state.board])).slice(0, 1);
  const pot = potSize(state);
  const winnerIds = winners.map((winner) => winner.id);
  // Side-pot/all-in splitting is intentionally deferred for this slice; all contributions are awarded as one main pot.
  const share = winners.length ? Math.floor(pot / winners.length) : 0;
  const seats = state.seats.map((seat) => winnerIds.includes(seat.id) ? { ...seat, stack: seat.stack + share, lastAction: `Won ${share}` } : seat);
  const winnerNames = winners.map((winner) => winner.name).join(', ') || 'No winner';

  return {
    ...state,
    street: 'Showdown',
    seats,
    currentSeatId: null,
    stage: 'hand-complete',
    winnerIds,
    potAwarded: pot,
    events: [...state.events, makeEvent(state.handId, 'Showdown', 'Dealer', 'Award pot', `${reason} ${winnerNames} wins ${pot}.`, 'engine', pot)],
    message: `${winnerNames} wins ${pot}.`,
  };
}

function settleAfterAction(state: HandState, actedSeatId: string): HandState {
  if (state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in').length <= 1) {
    return awardHand(state, 'Everyone else folded.');
  }

  if (!roundClosed(state)) {
    return { ...state, currentSeatId: nextSeatId(state, actedSeatId), message: 'Action moves to the next live seat.' };
  }

  const street = nextStreet(state);
  if (!street) return awardHand(state, 'River betting is closed.');
  return resetForStreet(state, street);
}

export function submitAction(state: HandState, seatId: string, kind: ActionKind, targetContribution?: number): HandState {
  if (state.currentSeatId !== seatId) return { ...state, message: `Action is not on ${seatId}.` };
  const legal = getLegalActions(state, seatId);
  const selected = legal.find((action) => action.kind === kind);
  if (!selected) return { ...state, message: `${kind} is not legal right now.` };

  const seat = seatById(state, seatId);
  const target = kind === 'bet' || kind === 'raise' ? Math.max(selected.min ?? selected.targetContribution, targetContribution ?? selected.targetContribution) : selected.targetContribution;
  const amount = kind === 'fold' || kind === 'check' ? 0 : Math.min(seat.stack, Math.max(0, target - seat.streetContribution));
  const nextStreetContribution = seat.streetContribution + amount;
  const aggressive = kind === 'bet' || kind === 'raise';
  const actor = seat.name;
  const actionLabel = kind[0].toUpperCase() + kind.slice(1);
  const seats = state.seats.map((candidate) => candidate.id === seatId ? {
    ...candidate,
    stack: candidate.stack - amount,
    contribution: candidate.contribution + amount,
    streetContribution: nextStreetContribution,
    status: kind === 'fold' ? 'folded' : candidate.stack - amount === 0 ? 'all-in' : candidate.status,
    lastAction: amount ? `${actionLabel} ${amount}` : actionLabel,
  } : candidate);

  const nextState: HandState = {
    ...state,
    seats,
    actedThisRound: aggressive ? [seatId] : Array.from(new Set([...state.actedThisRound, seatId])),
    lastAggressorId: aggressive ? seatId : state.lastAggressorId,
    minRaise: aggressive ? Math.max(state.bigBlind, nextStreetContribution - currentBet(state)) : state.minRaise,
    events: [...state.events, makeEvent(state.handId, state.street, actor, actionLabel, `${actor} ${kind}${amount ? `s ${amount}` : 's'}.`, seat.isHero ? 'hero' : 'bot', amount || undefined)],
    message: `${actor} ${kind}${amount ? `s ${amount}` : 's'}.`,
  };

  return settleAfterAction(nextState, seatId);
}

export function chooseBotAction(state: HandState, seatId: string): { kind: ActionKind; targetContribution?: number } {
  const seat = seatById(state, seatId);
  const legal = getLegalActions(state, seatId);
  const board = visibleBoard(state);
  const strength = evaluateStrength([...seat.cards, ...board]);
  const call = legal.find((action) => action.kind === 'call');
  const check = legal.find((action) => action.kind === 'check');
  const raise = legal.find((action) => action.kind === 'raise');
  const bet = legal.find((action) => action.kind === 'bet');

  if (call && call.amountToPutIn > seat.stack * 0.22 && strength < 220) return { kind: 'fold' };
  if (raise && (strength >= 305 || seat.style === 'pressure')) return { kind: 'raise', targetContribution: Math.min(raise.max ?? raise.targetContribution, raise.targetContribution + (seat.style === 'pressure' ? 30 : 0)) };
  if (bet && strength >= 250) return { kind: 'bet', targetContribution: Math.min(bet.max ?? bet.targetContribution, Math.max(bet.targetContribution, Math.round(potSize(state) * 0.55))) };
  if (call) return { kind: 'call' };
  if (check) return { kind: 'check' };
  return { kind: 'fold' };
}
