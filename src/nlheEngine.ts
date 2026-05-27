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
  burnCards: Card[];
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

function randomIndex(maxExclusive: number) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % maxExclusive;
  }
  return Math.floor(Math.random() * maxExclusive);
}

function buildDeck() {
  const deck = suits.flatMap((suit) => ranks.map((rank) => ({ rank, suit })));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
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
  let deck = buildDeck();
  const seats = playerBlueprints.map((blueprint) => {
    let cards: Card[];
    [cards, deck] = draw(deck, 2);
    return { ...blueprint, contribution: 0, streetContribution: 0, status: 'active' as PlayerStatus, cards, lastAction: 'Waiting' };
  });

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
    board: [],
    deck,
    burnCards: [],
    seats: withBlinds,
    currentSeatId: 'atlas',
    lastAggressorId: 'hero',
    actedThisRound: [],
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
  return state.board;
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

function dealStreetCards(state: HandState, street: Street) {
  const burnCards = state.deck.slice(0, 1);
  const cardCount = street === 'Flop' ? 3 : 1;
  const dealt = state.deck.slice(1, 1 + cardCount);
  return {
    board: [...state.board, ...dealt],
    burnCards: [...state.burnCards, ...burnCards],
    deck: state.deck.slice(1 + cardCount),
  };
}

function resetForStreet(state: HandState, street: Street): HandState {
  const firstToAct = state.seats.find((seat) => seat.role === 'SB' && seat.status === 'active')?.id ?? state.seats.find((seat) => seat.status === 'active')?.id ?? null;
  const dealt = dealStreetCards(state, street);
  return {
    ...state,
    street,
    board: dealt.board,
    burnCards: dealt.burnCards,
    deck: dealt.deck,
    currentSeatId: firstToAct,
    lastAggressorId: null,
    actedThisRound: [],
    minRaise: state.bigBlind,
    seats: state.seats.map((seat) => ({ ...seat, streetContribution: 0, lastAction: seat.status === 'folded' ? 'Folded' : `Waiting on ${street}` })),
    events: [...state.events, makeEvent(state.handId, street, 'Dealer', 'Deal street', `Burned one and dealt ${street}. Betting round starts from the small blind side.`, 'engine')],
    message: `${street} dealt. ${firstToAct ? seatById(state, firstToAct).name : 'No player'} acts first.`,
  };
}

function rankValue(rank: Rank) {
  return 14 - ranks.indexOf(rank);
}

type HandScore = number[];

function compareScores(a: HandScore, b: HandScore) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function findStraightHigh(values: number[]) {
  const unique = Array.from(new Set(values)).sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const window = unique.slice(index, index + 5);
    if (window[0] - window[4] === 4) return window[0];
  }
  return 0;
}

function evaluateFive(cards: Card[]): HandScore {
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straightHigh = findStraightHigh(values);
  const groups = Array.from(values.reduce<Map<number, number>>((acc, value) => acc.set(value, (acc.get(value) ?? 0) + 1), new Map()).entries())
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (flush && straightHigh) return [8, straightHigh];
  if (groups[0][1] === 4) return [7, groups[0][0], groups.find(([, count]) => count === 1)?.[0] ?? 0];
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...values];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][1] === 3) return [3, groups[0][0], ...groups.filter(([, count]) => count === 1).map(([value]) => value).sort((a, b) => b - a)];
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value).sort((a, b) => b - a);
    return [2, ...pairs, groups.find(([, count]) => count === 1)?.[0] ?? 0];
  }
  if (groups[0][1] === 2) return [1, groups[0][0], ...groups.filter(([, count]) => count === 1).map(([value]) => value).sort((a, b) => b - a)];
  return [0, ...values];
}

export function evaluateBestHand(cards: Card[]): HandScore {
  if (cards.length < 5) return [0, ...cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a)];
  let best: HandScore = [0];
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const score = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (compareScores(score, best) > 0) best = score;
          }
        }
      }
    }
  }
  return best;
}

function awardHand(state: HandState, reason: string): HandState {
  const contenders = activeSeats(state).filter((seat) => seat.status !== 'folded');
  const bestScore = contenders.reduce<HandScore | null>((best, seat) => {
    const score = evaluateBestHand([...seat.cards, ...state.board]);
    return !best || compareScores(score, best) > 0 ? score : best;
  }, null);
  const winners = contenders.length === 1 ? contenders : contenders.filter((seat) => compareScores(evaluateBestHand([...seat.cards, ...state.board]), bestScore ?? [0]) === 0);
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

type HandTier = 1 | 2 | 3 | 4 | 5;

function randomFloat() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] / (0xffffffff + 1);
  }
  return Math.random();
}

function weightedChoice(options: number[], weights: number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = randomFloat() * total;
  for (let index = 0; index < options.length; index += 1) {
    roll -= weights[index];
    if (roll <= 0) return options[index];
  }
  return options[options.length - 1];
}

function canonicalHole(cards: Card[]) {
  const sorted = [...cards].sort((a, b) => rankValue(b.rank) - rankValue(a.rank));
  const first = sorted[0];
  const second = sorted[1];
  const suited = first.suit === second.suit;
  const pair = first.rank === second.rank;
  return {
    high: first,
    low: second,
    suited,
    pair,
    key: pair ? `${first.rank}${second.rank}` : `${first.rank}${second.rank}${suited ? 's' : 'o'}`,
  };
}

function classifyPreflopHand(cards: Card[]): HandTier {
  const { key, pair, high, low, suited } = canonicalHole(cards);
  const highValue = rankValue(high.rank);
  const lowValue = rankValue(low.rank);
  const gap = highValue - lowValue;

  if (['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo'].includes(key)) return 1;
  if (['TT', '99', 'AQs', 'AQo', 'AJs', 'KQs', 'ATs'].includes(key)) return 2;
  if (['88', '77', '66', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', 'KQo', 'AJo', 'ATo'].includes(key)) return 3;
  if (high.rank === 'A' && suited && lowValue >= 2 && lowValue <= 9) return 3;
  if (['55', '44', '33', '22', '98s', '87s', '76s', '65s', '54s', 'KJo', 'QJo', 'K9s', 'Q9s', 'J9s'].includes(key)) return 4;
  if (pair && highValue <= 5) return 4;
  if (suited && gap === 1 && highValue <= 9 && lowValue >= 4) return 4;
  return 5;
}

function rankCounts(cards: Card[]) {
  return cards.reduce<Map<number, number>>((counts, card) => counts.set(rankValue(card.rank), (counts.get(rankValue(card.rank)) ?? 0) + 1), new Map());
}

function hasFlushDraw(cards: Card[]) {
  const suitCounts = cards.reduce<Record<Suit, number>>((counts, card) => ({ ...counts, [card.suit]: counts[card.suit] + 1 }), { spades: 0, hearts: 0, diamonds: 0, clubs: 0 });
  return Object.values(suitCounts).some((count) => count === 4);
}

function straightDrawKind(cards: Card[]): 'oesd' | 'gutshot' | null {
  const values = Array.from(new Set(cards.flatMap((card) => rankValue(card.rank) === 14 ? [14, 1] : [rankValue(card.rank)])));
  for (let low = 1; low <= 10; low += 1) {
    const window = [low, low + 1, low + 2, low + 3, low + 4];
    const held = window.filter((value) => values.includes(value)).length;
    if (held !== 4) continue;
    const missing = window.find((value) => !values.includes(value)) ?? 0;
    if (missing === low || missing === low + 4) return 'oesd';
    return 'gutshot';
  }
  return null;
}

function hasTwoOvercards(holeCards: Card[], board: Card[]) {
  if (board.length === 0) return false;
  const boardHigh = Math.max(...board.map((card) => rankValue(card.rank)));
  return holeCards.every((card) => rankValue(card.rank) > boardHigh);
}

function madeHandBaseEquity(score: HandScore) {
  if (score[0] >= 4) return 0.88;
  if (score[0] === 3) return 0.82;
  if (score[0] === 2) return 0.72;
  if (score[0] === 1) return 0.48;
  return 0.08;
}

function countOuts(holeCards: Card[], board: Card[]) {
  const cards = [...holeCards, ...board];
  let outs = 0;
  if (hasFlushDraw(cards)) outs += 9;
  const straightDraw = straightDrawKind(cards);
  if (straightDraw === 'oesd') outs += 8;
  else if (straightDraw === 'gutshot') outs += 4;
  if (hasTwoOvercards(holeCards, board) && outs === 0) outs += 6;

  const counts = rankCounts(cards);
  if (holeCards.some((card) => counts.get(rankValue(card.rank)) === 2)) outs += 2;
  return Math.min(15, outs);
}

function estimateEquity(holeCards: Card[], board: Card[], street: Street) {
  const outs = countOuts(holeCards, board);
  const drawEquity = street === 'Flop' ? outs * 0.04 : street === 'Turn' ? outs * 0.02 : 0;
  return Math.max(drawEquity, madeHandBaseEquity(evaluateBestHand([...holeCards, ...board])));
}

function classifyPostflopHand(holeCards: Card[], board: Card[], street: Street): HandTier {
  const score = evaluateBestHand([...holeCards, ...board]);
  const boardRanks = board.map((card) => rankValue(card.rank));
  const topBoard = Math.max(...boardRanks);
  const counts = rankCounts([...holeCards, ...board]);
  const holeValues = holeCards.map((card) => rankValue(card.rank));
  const hasPairWithBoard = holeValues.some((value) => boardRanks.includes(value));
  const topPair = holeValues.includes(topBoard);
  const bestKicker = Math.max(...holeValues.filter((value) => value !== topBoard), 0);
  const overpair = holeCards[0].rank === holeCards[1].rank && holeValues[0] > topBoard;
  const draw = straightDrawKind([...holeCards, ...board]);
  const flushDraw = hasFlushDraw([...holeCards, ...board]);

  if (score[0] >= 3 || score[0] === 2) return 1;
  if (topPair && bestKicker >= 14) return 1;
  if (topPair || overpair || (hasPairWithBoard && Math.max(...holeValues) >= topBoard - 1)) return 2;
  if (street === 'Flop' && (flushDraw || draw === 'oesd')) return 2;
  if (hasPairWithBoard || flushDraw || draw || holeValues.some((value) => counts.get(value) === 2)) return 3;
  if (hasTwoOvercards(holeCards, board) || holeCards.some((card) => rankValue(card.rank) >= 12)) return 4;
  return 5;
}

function positionCategory(role: SeatRole): 'early' | 'middle' | 'late' | 'blind' {
  if (role === 'CO') return 'middle';
  if (role === 'BTN') return 'late';
  return 'blind';
}

function isInPosition(state: HandState, seat: Seat) {
  if (state.street === 'Preflop') return positionCategory(seat.role) === 'late';
  if (state.seats.filter((candidate) => candidate.status === 'active').length <= 2) return seat.role === 'BTN';
  return seat.role === 'BTN' || seat.role === 'CO';
}

function countCallers(state: HandState) {
  const highBet = currentBet(state);
  return state.seats.filter((seat) => seat.id !== state.lastAggressorId && seat.streetContribution === highBet && highBet > state.bigBlind).length;
}

function hasSuitedConnector(cards: Card[]) {
  const { suited, high, low } = canonicalHole(cards);
  return suited && rankValue(high.rank) - rankValue(low.rank) === 1;
}

function clampTarget(action: LegalAction, desiredAmountToAdd: number, currentContribution: number) {
  const desiredTarget = currentContribution + Math.max(0, Math.round(desiredAmountToAdd));
  return Math.min(action.max ?? desiredTarget, Math.max(action.min ?? action.targetContribution, desiredTarget));
}

function clampTotalTarget(action: LegalAction, desiredTarget: number) {
  const roundedTarget = Math.round(desiredTarget);
  return Math.min(action.max ?? roundedTarget, Math.max(action.min ?? action.targetContribution, roundedTarget));
}

function valueBetSize(pot: number, street: Street, tier: HandTier) {
  if (street === 'Flop') return weightedChoice([0.33, 0.5, 0.75], [0.3, 0.4, 0.3]) * pot;
  if (street === 'Turn') return 0.66 * pot;
  if (street === 'River') return (tier === 1 ? 0.75 : 0.5) * pot;
  return 0.5 * pot;
}

function impliedOdds(state: HandState, seat: Seat, street: Street) {
  if (street === 'River') return 0;
  const stackToPot = seat.stack / Math.max(1, potSize(state));
  return Math.min(0.18, stackToPot / 100 + (street === 'Flop' ? 0.08 : 0.03));
}

export function chooseBotAction(state: HandState, seatId: string): { kind: ActionKind; targetContribution?: number } {
  const seat = seatById(state, seatId);
  const legal = getLegalActions(state, seatId);
  const call = legal.find((action) => action.kind === 'call');
  const check = legal.find((action) => action.kind === 'check');
  const raise = legal.find((action) => action.kind === 'raise');
  const bet = legal.find((action) => action.kind === 'bet');
  const pot = potSize(state);
  const currentTableBet = currentBet(state);

  if (state.street === 'Preflop') {
    const tier = classifyPreflopHand(seat.cards);
    const facingRaise = currentTableBet > state.bigBlind;
    const potOdds = call ? call.amountToPutIn / Math.max(1, pot + call.amountToPutIn) : 0;
    const stackToPot = seat.stack / Math.max(1, pot);
    const position = seat.role;
    const callers = countCallers(state);
    const openAction = raise ?? bet;

    if (!facingRaise) {
      if (openAction && (tier === 1 || tier === 2)) return { kind: openAction.kind, targetContribution: clampTotalTarget(openAction, 2.5 * state.bigBlind) };
      if (openAction && tier === 3 && (['CO', 'BTN', 'HJ'].includes(position) || position === 'SB')) {
        return { kind: openAction.kind, targetContribution: clampTotalTarget(openAction, (position === 'SB' ? 3 : 2.5) * state.bigBlind) };
      }
      if (openAction && tier === 4 && (position === 'BTN' || (['CO', 'HJ'].includes(position) && callers === 0))) {
        return { kind: openAction.kind, targetContribution: clampTotalTarget(openAction, 2.5 * state.bigBlind) };
      }
      if (check) return { kind: 'check' };
      return { kind: 'fold' };
    }

    const facingThreeBet = currentTableBet >= state.bigBlind * 7.5;
    if (facingThreeBet) {
      if (raise && tier === 1) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 2.5 * currentTableBet) };
      if (call && tier <= 2) return { kind: 'call' };
      return { kind: 'fold' };
    }

    if (raise && tier === 1) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 3 * currentTableBet) };
    if (tier === 2) {
      if (raise && ['BTN', 'CO'].includes(position)) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 3 * currentTableBet) };
      if (call) return { kind: 'call' };
    }
    if (call && tier === 3 && potOdds < 0.25) return { kind: 'call' };
    if (call && tier === 4 && hasSuitedConnector(seat.cards) && potOdds < 0.15 && stackToPot > 15) return { kind: 'call' };
    return { kind: 'fold' };
  }

  const board = visibleBoard(state);
  const tier = classifyPostflopHand(seat.cards, board, state.street);
  const ip = isInPosition(state, seat);

  if (!call) {
    if (bet && tier === 1) {
      if (ip && randomFloat() >= 0.7 && check) return { kind: 'check' };
      return { kind: 'bet', targetContribution: clampTarget(bet, valueBetSize(pot, state.street, tier), seat.streetContribution) };
    }
    if (bet && tier === 2) {
      if (ip) return { kind: 'bet', targetContribution: clampTarget(bet, 0.5 * pot, seat.streetContribution) };
      if (state.street === 'Flop') return { kind: 'bet', targetContribution: clampTarget(bet, 0.4 * pot, seat.streetContribution) };
      if (check) return { kind: 'check' };
    }
    if (bet && tier === 3 && !ip && state.street === 'Flop' && (hasFlushDraw([...seat.cards, ...board]) || straightDrawKind([...seat.cards, ...board]) === 'oesd')) {
      return { kind: 'bet', targetContribution: clampTarget(bet, 0.5 * pot, seat.streetContribution) };
    }
    if (bet && tier === 4 && ip) {
      const bluffFrequency = state.street === 'River' ? 0.25 : 0.33;
      const bluffSize = state.street === 'River' ? 0.75 : 0.5;
      if (randomFloat() < bluffFrequency) return { kind: 'bet', targetContribution: clampTarget(bet, bluffSize * pot, seat.streetContribution) };
    }
    if (check) return { kind: 'check' };
    return { kind: 'fold' };
  }

  const potOdds = call.amountToPutIn / Math.max(1, pot + call.amountToPutIn);
  const equity = estimateEquity(seat.cards, board, state.street);

  if (tier === 1) {
    if (raise) return { kind: 'raise', targetContribution: clampTarget(raise, (call.amountToPutIn < 0.3 * pot ? 3 : 2.5) * call.amountToPutIn, seat.streetContribution) };
    return { kind: 'call' };
  }
  if (tier === 2) return equity > potOdds ? { kind: 'call' } : { kind: 'fold' };
  if (tier === 3) {
    if (state.street !== 'River' && equity + impliedOdds(state, seat, state.street) > potOdds) return { kind: 'call' };
    return { kind: 'fold' };
  }
  if (tier === 4 && potOdds < 0.2) return { kind: 'call' };
  return { kind: 'fold' };
}
