export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | 'K' | 'Q' | 'J' | '10' | '9' | '8' | '7' | '6' | '5' | '4' | '3' | '2';
export type Street = 'Preflop' | 'Flop' | 'Turn' | 'River' | 'Showdown';
export type SeatRole = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'MP' | 'MP+1' | 'HJ' | 'CO' | 'BTN/SB';
export type PlayerStatus = 'active' | 'folded' | 'all-in' | 'out';
export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';
export type EngineStage = 'awaiting-action' | 'hand-complete';
export type BotStyle = 'loose-aggressive' | 'balanced' | 'pressure';

export type Card = { rank: Rank; suit: Suit };
export type Seat = {
  seatIndex: number;
  id: string;
  name: string;
  role: SeatRole;
  stack: number;
  stackAtHandStart: number;
  contribution: number;
  streetContribution: number;
  status: PlayerStatus;
  cards: Card[];
  isHero?: boolean;
  style?: BotStyle;
  lastAction: string;
};

export type TableSeat = {
  seatIndex: number;
  playerId: string | null;
  name: string;
  chips: number;
  isActive: boolean;
  isHero?: boolean;
  style?: BotStyle;
};

export type TableState = {
  seats: TableSeat[];
  buttonSeatIndex: number;
  handNumber: number;
};

export type PositionMap = {
  positions: Partial<Record<SeatRole, number>>;
  preflopActionOrder: number[];
  postflopActionOrder: number[];
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
  playerId?: string;
  position?: SeatRole;
  actionType?: ActionKind | 'small-blind' | 'big-blind' | 'award-pot' | 'deal';
  potBefore?: number;
  potAfter?: number;
  stackBefore?: number;
  betSizingPct?: number | null;
  note: string;
  source: 'engine' | 'hero' | 'bot';
};

export type HandState = {
  handId: string;
  handNumber: number;
  buttonSeatIndex: number;
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

const playerBlueprints: TableSeat[] = [
  { seatIndex: 0, playerId: 'mira', name: 'Mira', chips: 1500, isActive: true, style: 'loose-aggressive' },
  { seatIndex: 1, playerId: 'nash', name: 'Nash Bot', chips: 1000, isActive: true, style: 'balanced' },
  { seatIndex: 2, playerId: 'hero', name: 'You', chips: 1500, isActive: true, isHero: true },
  { seatIndex: 3, playerId: 'atlas', name: 'Atlas', chips: 1080, isActive: true, style: 'pressure' },
];

let eventCounter = 0;

function makeEvent(
  handId: string,
  street: Street,
  actor: string,
  action: string,
  note: string,
  source: HandEvent['source'],
  amount?: number,
  metadata: Partial<HandEvent> = {},
): HandEvent {
  eventCounter += 1;
  return { id: `${handId}-${eventCounter}`, handId, street, actor, action, amount, note, source, ...metadata };
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

function activeTableSeats(table: TableState) {
  return table.seats.filter((seat) => seat.playerId !== null && seat.chips > 0 && seat.isActive);
}

export function createInitialTable(seats: TableSeat[] = playerBlueprints): TableState {
  const normalizedSeats = seats.map((seat, index) => ({ ...seat, seatIndex: seat.seatIndex ?? index }));
  const activeSeats = normalizedSeats.filter((seat) => seat.playerId !== null && seat.chips > 0 && seat.isActive);
  if (activeSeats.length < 2) throw new Error('At least two active players are required to start a table');
  const firstSeatIndex = activeSeats.sort((a, b) => a.seatIndex - b.seatIndex)[0].seatIndex;
  return {
    seats: normalizedSeats,
    buttonSeatIndex: (firstSeatIndex - 1 + normalizedSeats.length) % normalizedSeats.length,
    handNumber: 0,
  };
}

export function syncTableFromHand(table: TableState, hand: HandState): TableState {
  const stacksBySeatIndex = new Map(hand.seats.map((seat) => [seat.seatIndex, seat.stack]));
  return {
    ...table,
    seats: table.seats.map((seat) => {
      const chips = stacksBySeatIndex.get(seat.seatIndex) ?? seat.chips;
      return { ...seat, chips, isActive: seat.isActive && chips > 0 };
    }),
  };
}

export function advanceButton(table: TableState): number {
  const totalSeats = table.seats.length;
  const playableSeats = activeTableSeats(table);
  if (playableSeats.length < 2) throw new Error('Cannot advance button with fewer than two active players');

  for (let offset = 1; offset <= totalSeats; offset += 1) {
    const candidateIndex = (table.buttonSeatIndex + offset) % totalSeats;
    const seat = table.seats[candidateIndex];
    if (seat.playerId !== null && seat.chips > 0 && seat.isActive) {
      table.buttonSeatIndex = candidateIndex;
      return candidateIndex;
    }
  }

  throw new Error('No valid seat for button advancement');
}

function rotateSoFirstIsAfter(activeSeatIndices: number[], buttonSeatIndex: number) {
  const buttonPosition = activeSeatIndices.indexOf(buttonSeatIndex);
  if (buttonPosition === -1) throw new Error('Button must be on an active seat before assigning positions');
  return [...activeSeatIndices.slice(buttonPosition + 1), ...activeSeatIndices.slice(0, buttonPosition + 1)];
}

export function getPositionLabel(distanceFromButton: number, numActive: number): SeatRole {
  if (numActive === 2) return distanceFromButton === 0 ? 'BTN/SB' : 'BB';
  const labels: SeatRole[] = numActive >= 9
    ? ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO']
    : numActive === 8
      ? ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO']
      : numActive === 7
        ? ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'CO']
        : numActive === 6
          ? ['BTN', 'SB', 'BB', 'UTG', 'MP', 'CO']
          : numActive === 5
            ? ['BTN', 'SB', 'BB', 'UTG', 'CO']
            : ['BTN', 'SB', 'BB', 'UTG'];
  return labels[distanceFromButton] ?? 'UTG';
}

export function getSeatLabel(seatIndex: number, buttonSeatIndex: number, activeSeatIndices: number[]): SeatRole | '' {
  const sortedActiveSeatIndices = [...activeSeatIndices].sort((a, b) => a - b);
  const buttonPosInActive = sortedActiveSeatIndices.indexOf(buttonSeatIndex);
  const thisPosInActive = sortedActiveSeatIndices.indexOf(seatIndex);
  if (buttonPosInActive === -1 || thisPosInActive === -1) return '';
  const distanceFromButton = (thisPosInActive - buttonPosInActive + sortedActiveSeatIndices.length) % sortedActiveSeatIndices.length;
  return getPositionLabel(distanceFromButton, sortedActiveSeatIndices.length);
}

export function assignBlindsAndPositions(table: TableState): PositionMap {
  const activeSeatIndices = activeTableSeats(table).map((seat) => seat.seatIndex).sort((a, b) => a - b);
  const orderedFromButton = rotateSoFirstIsAfter(activeSeatIndices, table.buttonSeatIndex);
  const numActive = orderedFromButton.length;

  if (numActive < 2) throw new Error('At least two active players are required to assign positions');

  if (numActive === 2) {
    return {
      positions: {
        BTN: table.buttonSeatIndex,
        SB: table.buttonSeatIndex,
        BB: orderedFromButton[0],
        UTG: table.buttonSeatIndex,
      },
      preflopActionOrder: [table.buttonSeatIndex, orderedFromButton[0]],
      postflopActionOrder: [orderedFromButton[0], orderedFromButton[1]],
    };
  }

  const positions = activeSeatIndices.reduce<Partial<Record<SeatRole, number>>>((acc, seatIndex) => {
    const label = getSeatLabel(seatIndex, table.buttonSeatIndex, activeSeatIndices);
    if (label) acc[label] = seatIndex;
    return acc;
  }, {});

  return {
    positions,
    preflopActionOrder: [...orderedFromButton.slice(2), orderedFromButton[0], orderedFromButton[1]],
    postflopActionOrder: orderedFromButton,
  };
}

function roleForSeat(seatIndex: number, positions: PositionMap['positions']): SeatRole {
  if (positions.BTN === seatIndex && positions.SB === seatIndex) return 'BTN/SB';
  const role = Object.entries(positions).find(([, positionedSeat]) => positionedSeat === seatIndex)?.[0] as SeatRole | undefined;
  if (!role) throw new Error(`No position assigned for seat ${seatIndex}`);
  return role;
}

export function createHand(tableOrHandNumber: TableState | number = createInitialTable()): HandState {
  const table = typeof tableOrHandNumber === 'number' ? createInitialTable() : tableOrHandNumber;
  advanceButton(table);
  table.handNumber = typeof tableOrHandNumber === 'number' ? tableOrHandNumber : table.handNumber + 1;
  const positionMap = assignBlindsAndPositions(table);
  let deck = buildDeck();
  const seats = activeTableSeats(table).sort((a, b) => a.seatIndex - b.seatIndex).map((tableSeat) => {
    let cards: Card[];
    [cards, deck] = draw(deck, 2);
    return {
      seatIndex: tableSeat.seatIndex,
      id: tableSeat.playerId!,
      name: tableSeat.name,
      role: roleForSeat(tableSeat.seatIndex, positionMap.positions),
      stack: tableSeat.chips,
      stackAtHandStart: tableSeat.chips,
      contribution: 0,
      streetContribution: 0,
      status: 'active' as PlayerStatus,
      cards,
      isHero: tableSeat.isHero,
      style: tableSeat.style,
      lastAction: 'Waiting',
    };
  });

  const withBlinds = seats.map((seat) => {
    if (seat.role === 'SB' || seat.role === 'BTN/SB') return postBlind(seat, 15);
    if (seat.role === 'BB') return postBlind(seat, 30);
    return seat;
  });

  const handId = `hand-${table.handNumber}`;
  const smallBlindSeat = withBlinds.find((seat) => seat.role === 'SB' || seat.role === 'BTN/SB');
  const bigBlindSeat = withBlinds.find((seat) => seat.role === 'BB');
  const firstToActSeatIndex = positionMap.preflopActionOrder[0];
  const firstToAct = withBlinds.find((seat) => seat.seatIndex === firstToActSeatIndex) ?? withBlinds.find((seat) => seat.status === 'active');
  return {
    handId,
    handNumber: table.handNumber,
    buttonSeatIndex: table.buttonSeatIndex,
    smallBlind: 15,
    bigBlind: 30,
    street: 'Preflop',
    board: [],
    deck,
    burnCards: [],
    seats: withBlinds,
    currentSeatId: firstToAct?.id ?? null,
    lastAggressorId: bigBlindSeat?.id ?? null,
    actedThisRound: [],
    minRaise: 30,
    events: [
      makeEvent(handId, 'Preflop', 'Dealer', 'Deal', 'New NLHE hand dealt.', 'engine', undefined, { actionType: 'deal' }),
      smallBlindSeat ? makeEvent(handId, 'Preflop', smallBlindSeat.name, 'Small blind', `${smallBlindSeat.name} posts the small blind.`, 'engine', Math.min(15, smallBlindSeat.contribution), {
        playerId: smallBlindSeat.id,
        position: smallBlindSeat.role,
        actionType: 'small-blind',
        potBefore: 0,
        potAfter: smallBlindSeat.contribution,
        stackBefore: smallBlindSeat.stackAtHandStart,
        betSizingPct: null,
      }) : null,
      bigBlindSeat ? makeEvent(handId, 'Preflop', bigBlindSeat.name, 'Big blind', `${bigBlindSeat.name} posts the big blind.`, 'engine', Math.min(30, bigBlindSeat.contribution), {
        playerId: bigBlindSeat.id,
        position: bigBlindSeat.role,
        actionType: 'big-blind',
        potBefore: smallBlindSeat?.contribution ?? 0,
        potAfter: (smallBlindSeat?.contribution ?? 0) + bigBlindSeat.contribution,
        stackBefore: bigBlindSeat.stackAtHandStart,
        betSizingPct: null,
      }) : null,
    ].filter((event): event is HandEvent => event !== null),
    stage: 'awaiting-action',
    winnerIds: [],
    potAwarded: 0,
    message: firstToAct ? `Action starts preflop with ${firstToAct.name} ${firstToAct.role === 'UTG' ? 'under the gun' : 'to act first'}.` : 'Hand is ready.',
  };
}

export function createNextHand(table: TableState): { table: TableState; hand: HandState } | null {
  if (activeTableSeats(table).length < 2) return null;
  const nextTable = { ...table, seats: table.seats.map((seat) => ({ ...seat })) };
  return { table: nextTable, hand: createHand(nextTable) };
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
    events: [...state.events, makeEvent(state.handId, street, 'Dealer', 'Deal street', `Burned one and dealt ${street}. Betting round starts from the small blind side.`, 'engine', undefined, { actionType: 'deal' })],
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
    events: [...state.events, makeEvent(state.handId, 'Showdown', 'Dealer', 'Award pot', `${reason} ${winnerNames} wins ${pot}.`, 'engine', pot, { actionType: 'award-pot', potBefore: pot, potAfter: 0 })],
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
  const potBefore = potSize(state);
  const stackBefore = seat.stack;
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
    events: [...state.events, makeEvent(state.handId, state.street, actor, actionLabel, `${actor} ${kind}${amount ? `s ${amount}` : 's'}.`, seat.isHero ? 'hero' : 'bot', amount || undefined, {
      playerId: seat.id,
      position: seat.role,
      actionType: kind,
      potBefore,
      potAfter: potBefore + amount,
      stackBefore,
      betSizingPct: kind === 'fold' || kind === 'check' || potBefore <= 0 ? null : amount / potBefore,
    })],
    message: `${actor} ${kind}${amount ? `s ${amount}` : 's'}.`,
  };

  return settleAfterAction(nextState, seatId);
}

type HandTier = 1 | 2 | 3 | 4 | 5;
type HandKey = string;

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
  const highRank = handRank(first.rank);
  const lowRank = handRank(second.rank);
  return {
    high: first,
    low: second,
    suited,
    pair,
    key: pair ? `${highRank}${lowRank}` : `${highRank}${lowRank}${suited ? 's' : 'o'}`,
  };
}

function handRank(rank: Rank) {
  return rank === '10' ? 'T' : rank;
}

const handRanks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

function expandRange(shorthand: string[]): Set<HandKey> {
  const hands = new Set<HandKey>();
  shorthand.forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    if (trimmed.endsWith('+')) {
      const base = trimmed.slice(0, -1);
      const suitedness = base.endsWith('s') || base.endsWith('o') ? base.slice(-1) : '';
      const ranksOnly = suitedness ? base.slice(0, -1) : base;
      const [first, second] = ranksOnly;

      if (first === second) {
        const start = handRanks.indexOf(first);
        for (let index = start; index >= 0; index -= 1) hands.add(`${handRanks[index]}${handRanks[index]}`);
        return;
      }

      const start = handRanks.indexOf(second);
      const stop = handRanks.indexOf(first);
      for (let index = start; index > stop; index -= 1) hands.add(`${first}${handRanks[index]}${suitedness}`);
      return;
    }
    hands.add(trimmed);
  });
  return hands;
}

function unionRanges(...ranges: Set<HandKey>[]) {
  return new Set(ranges.flatMap((range) => [...range]));
}

const UTG_OPEN_RANGE = expandRange([
  '55+', 'AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'A7s', 'A6s', 'A5s', 'A4s', 'A3s', 'A2s',
  'KQs', 'KJs', 'KTs', 'K9s', 'QJs', 'QTs', 'Q9s', 'JTs', 'J9s', 'T9s', 'T8s', '98s', '97s',
  '87s', '86s', '76s', '75s', '65s', '64s', '54s', 'AKo', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo', 'QJo',
]);

const UTG_PLUS_ONE_OPEN_RANGE = unionRanges(UTG_OPEN_RANGE, expandRange(['44', 'Q8s', 'J8s', 'T7s', '53s', 'KTo', 'QTo', 'JTo']));
const MP_OPEN_RANGE = unionRanges(UTG_PLUS_ONE_OPEN_RANGE, expandRange(['22+', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s', 'Q7s', 'J7s', 'T6s', '96s', '85s', '74s', '63s', '43s', 'T9o']));
const HJ_OPEN_RANGE = unionRanges(MP_OPEN_RANGE, expandRange(['Q6s', 'Q5s', 'Q4s', 'Q3s', 'Q2s', 'J6s', 'J5s', 'J4s', 'T5s', 'T4s', '95s', '84s', '73s', '62s', '52s', '42s', 'K9o', 'Q9o', 'J9o', 'T8o', '98o']));
const CO_OPEN_RANGE = unionRanges(HJ_OPEN_RANGE, expandRange(['J3s', 'J2s', 'T3s', 'T2s', '93s', '83s', '72s', 'K8o', 'K7o', 'Q8o', 'J8o', 'T7o', '97o', '87o']));
const BTN_OPEN_RANGE = unionRanges(CO_OPEN_RANGE, expandRange(['92s', '82s', '32s', 'K6o', 'K5o', 'K4o', 'K3o', 'K2o', 'Q7o', 'Q6o', 'Q5o', 'Q4o', 'J7o', 'J6o', 'T6o', '96o', '86o', '76o', 'A9o', 'A8o', 'A7o', 'A6o', 'A5o', 'A4o', 'A3o', 'A2o']));
const SB_OPEN_RANGE = new Set([...BTN_OPEN_RANGE].filter((hand) => !['K2o', 'K3o', 'K4o', 'Q4o', 'Q5o', 'J6o', 'T5o', 'T4o', 'T3o', 'T2o', '95o', '85o', '75o', '64o', '53o', '43o', '32o'].includes(hand)));

const OPEN_RANGES: Record<SeatRole, Set<HandKey>> = {
  UTG: UTG_OPEN_RANGE,
  'UTG+1': UTG_PLUS_ONE_OPEN_RANGE,
  MP: MP_OPEN_RANGE,
  'MP+1': MP_OPEN_RANGE,
  HJ: HJ_OPEN_RANGE,
  CO: CO_OPEN_RANGE,
  BTN: BTN_OPEN_RANGE,
  SB: SB_OPEN_RANGE,
  BB: new Set(),
  'BTN/SB': BTN_OPEN_RANGE,
};

const BB_CALL_VS_BTN = expandRange([
  '22+', 'AKs+', 'AQs+', 'AJs+', 'ATs+', 'A9s+', 'A8s+', 'A7s+', 'A6s+', 'A5s+', 'A4s+', 'A3s+', 'A2s+',
  'KQs', 'KJs', 'KTs', 'K9s', 'K8s', 'K7s', 'K6s', 'K5s', 'K4s', 'K3s', 'K2s',
  'QJs', 'QTs', 'Q9s', 'Q8s', 'Q7s', 'Q6s', 'Q5s', 'Q4s', 'Q3s',
  'JTs', 'J9s', 'J8s', 'J7s', 'J6s', 'J5s', 'J4s',
  'T9s', '98s', '87s', '76s', '65s', '54s', '43s', '32s',
  'AJo', 'AQo', 'AKo', 'KQo', 'KJo', 'KTo', 'QJo', 'QTo', 'JTo', 'T9o', '98o', '87o', '76o', '65o', '54o',
]);
const BB_CALL_VS_CO = new Set([...BB_CALL_VS_BTN].filter((hand) => !['Q3s', 'J4s', '32s', '65o', '54o', 'K2s', 'K3s'].includes(hand)));
const BB_CALL_RANGES: Record<string, Set<HandKey>> = {
  BTN: BB_CALL_VS_BTN,
  CO: BB_CALL_VS_CO,
  HJ: unionRanges(MP_OPEN_RANGE, expandRange(['A9o', 'KTo', 'QTo', 'JTo', '98o', '87o', '76o', '65o', '54o'])),
  MP: unionRanges(UTG_PLUS_ONE_OPEN_RANGE, expandRange(['22', '33', '44', 'KTo', 'QTo', 'JTo', 'T9o', '98o', '87o', '76o'])),
  'MP+1': unionRanges(UTG_PLUS_ONE_OPEN_RANGE, expandRange(['22', '33', '44', 'KTo', 'QTo', 'JTo', 'T9o', '98o', '87o', '76o'])),
  UTG: unionRanges(UTG_OPEN_RANGE, expandRange(['22', '33', '44', 'KTo', 'QTo', 'JTo', 'T9o', '98o'])),
  'UTG+1': unionRanges(UTG_OPEN_RANGE, expandRange(['22', '33', '44', 'KTo', 'QTo', 'JTo', 'T9o', '98o'])),
  SB: BB_CALL_VS_BTN,
  'BTN/SB': BB_CALL_VS_BTN,
};

const BB_3BET_VALUE = expandRange(['TT+', 'AKs', 'AKo', 'AQs']);
const BB_3BET_BLUFF = expandRange(['A5s', 'A4s', 'A3s', 'A2s', 'K5s', 'K4s', 'K3s', 'K2s', '76s', '65s', '54s']);
const NON_BB_3BET_VALUE = expandRange(['JJ+', 'AKs', 'AKo']);
const LATE_3BET_BLUFFS = expandRange(['A5s', 'A4s', 'A3s', 'A2s', '76s', '65s', '54s']);
const IN_POSITION_CALL_RANGE = expandRange(['22+', 'AQs', 'AJs', 'ATs', 'A9s', 'KQs', 'KJs', 'KTs', 'QJs', 'QTs', 'JTs', 'T9s', '98s', '87s', '76s', '65s', '54s', '43s', 'J9s', 'T8s', '97s', '86s', '75s', '64s', 'AQo', 'AJo', 'ATo', 'KQo', 'KJo', 'QJo']);
const OUT_OF_POSITION_CALL_RANGE = expandRange(['TT', '99', '88', 'AQs', 'AJs', 'KQs', 'AQo', '22', '33', '44', '55', '66', '77']);
const THREE_BET_CONTINUE_RANGE = expandRange(['TT', '99', 'AQs']);

function getCallRange(position: SeatRole, openerPosition: SeatRole | undefined) {
  const openerIsEarlier = openerPosition ? positionOrder(openerPosition) < positionOrder(position) : true;
  return openerIsEarlier ? IN_POSITION_CALL_RANGE : OUT_OF_POSITION_CALL_RANGE;
}

function positionOrder(role: SeatRole) {
  const normalized = role === 'BTN/SB' ? 'BTN' : role;
  return ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'MP+1', 'HJ', 'CO', 'BTN'].indexOf(normalized);
}

function countRaisesThisStreet(state: HandState) {
  return state.events.filter((event) => event.street === state.street && (event.action === 'Raise' || event.action === 'Bet')).length;
}

function countLimpers(state: HandState) {
  return state.seats.filter((candidate) => candidate.streetContribution === state.bigBlind && candidate.role !== 'BB' && candidate.lastAction.startsWith('Call')).length;
}

function openerPosition(state: HandState): SeatRole | undefined {
  if (!state.lastAggressorId) return undefined;
  return state.seats.find((candidate) => candidate.id === state.lastAggressorId)?.role;
}

function calcOpenSize(state: HandState, position: SeatRole) {
  const baseSize = (position === 'SB' || position === 'BTN/SB' ? 3 : 2.5) * state.bigBlind;
  return baseSize + countLimpers(state) * state.bigBlind;
}

function isPocketPair(hand: HandKey) {
  return hand.length === 2 && hand[0] === hand[1];
}

function isSuitedConnectorHand(hand: HandKey) {
  if (!hand.endsWith('s')) return false;
  const high = handRanks.indexOf(hand[0]);
  const low = handRanks.indexOf(hand[1]);
  return low - high === 1;
}

function isPureSpeculative(hand: HandKey) {
  return isPocketPair(hand) || hand.endsWith('s') || isSuitedConnectorHand(hand);
}

function preflopRangeAdvantage(state: HandState, seat: Seat): 'strong' | 'neutral' | 'wide' {
  const opener = openerPosition(state);
  if (!opener) return ['UTG', 'UTG+1', 'MP'].includes(seat.role) ? 'strong' : ['BTN', 'CO', 'BB'].includes(seat.role) ? 'wide' : 'neutral';
  if (state.lastAggressorId === seat.id && positionOrder(opener) <= positionOrder('MP')) return 'strong';
  if (seat.role === 'BB') return 'wide';
  return 'neutral';
}

function textureFavorsPreflopAggressor(board: Card[]) {
  const boardValues = board.map((card) => rankValue(card.rank));
  const highCards = boardValues.filter((value) => value >= 10).length;
  const paired = new Set(boardValues).size < boardValues.length;
  return highCards >= 2 || (highCards >= 1 && paired);
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
  if (role === 'UTG' || role === 'UTG+1') return 'early';
  if (role === 'MP' || role === 'MP+1' || role === 'HJ') return 'middle';
  if (role === 'CO') return 'middle';
  if (role === 'BTN' || role === 'BTN/SB') return 'late';
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
    const hand = canonicalHole(seat.cards).key;
    const facingRaise = currentTableBet > state.bigBlind;
    const stackToPot = seat.stack / Math.max(1, pot);
    const position = seat.role;
    const callers = countCallers(state);
    const raisesThisStreet = countRaisesThisStreet(state);
    const openAction = raise ?? bet;

    if (!facingRaise) {
      if (openAction && OPEN_RANGES[position].has(hand)) return { kind: openAction.kind, targetContribution: clampTotalTarget(openAction, calcOpenSize(state, position)) };
      if (check) return { kind: 'check' };
      return { kind: 'fold' };
    }

    const facingThreeBet = raisesThisStreet >= 2;
    if (facingThreeBet) {
      if (raise && ['AA', 'KK'].includes(hand)) return { kind: 'raise', targetContribution: raise.max };
      if (['QQ', 'JJ', 'AKs', 'AKo'].includes(hand)) {
        if (raise && randomFloat() < 0.5) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 2.5 * currentTableBet) };
        if (call) return { kind: 'call' };
      }
      if (call && THREE_BET_CONTINUE_RANGE.has(hand)) return { kind: 'call' };
      if (raise && ['A5s', 'A4s'].includes(hand) && randomFloat() < 0.3) return { kind: 'raise', targetContribution: raise.max };
      return { kind: 'fold' };
    }

    const openPosition = openerPosition(state);
    if (position === 'BB') {
      const bbCallRange = BB_CALL_RANGES[openPosition ?? 'BTN'] ?? BB_CALL_VS_BTN;
      if (raise && BB_3BET_VALUE.has(hand)) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 3 * currentTableBet) };
      if (raise && BB_3BET_BLUFF.has(hand) && randomFloat() < 0.35) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 2.5 * currentTableBet) };
      if (call && bbCallRange.has(hand)) return { kind: 'call' };
      return { kind: 'fold' };
    }

    if (raise && NON_BB_3BET_VALUE.has(hand)) return { kind: 'raise', targetContribution: clampTotalTarget(raise, 3 * currentTableBet) };
    if (raise && ['BTN', 'CO'].includes(position) && LATE_3BET_BLUFFS.has(hand) && randomFloat() < 0.4) {
      return { kind: 'raise', targetContribution: clampTotalTarget(raise, 2.8 * currentTableBet) };
    }

    const callRange = getCallRange(position, openPosition);
    if (call && callRange.has(hand)) {
      if (callers >= 2 && isPureSpeculative(hand)) {
        if (['22', '33', '44', '55'].includes(hand) || isSuitedConnectorHand(hand)) return { kind: 'call' };
        return { kind: 'fold' };
      }
      if (callRange === OUT_OF_POSITION_CALL_RANGE && ['22', '33', '44', '55', '66', '77'].includes(hand) && stackToPot <= 20) {
        return { kind: 'fold' };
      }
      if (call) return { kind: 'call' };
    }
    return { kind: 'fold' };
  }

  const board = visibleBoard(state);
  const rangeAdvantage = preflopRangeAdvantage(state, seat);
  let tier = classifyPostflopHand(seat.cards, board, state.street);
  if (rangeAdvantage === 'strong' && tier > 1 && board.length >= 3 && textureFavorsPreflopAggressor(board)) tier = (tier - 1) as HandTier;
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
