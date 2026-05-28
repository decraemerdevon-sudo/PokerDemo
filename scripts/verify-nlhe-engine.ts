import {
  createFreshDeck,
  createHand,
  createInitialTable,
  autoRecoverBotSeats,
  getLegalActions,
  playableSeatCount,
  potSize,
  rebuyBustedSeat,
  shuffleDeck,
  submitAction,
  type HandState,
} from '../src/nlheEngine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function totalChips(state: HandState) {
  return state.seats.reduce((sum, seat) => sum + seat.stack + seat.contribution, 0);
}

const deck = createFreshDeck();
const keys = new Set(deck.map((card) => `${card.rank}-${card.suit}`));
assert(deck.length === 52, `expected 52 cards, got ${deck.length}`);
assert(keys.size === 52, 'fresh deck must contain 52 unique cards');
assert(shuffleDeck(deck).length === 52, 'shuffle must preserve deck size');

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
try {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  let rejectedInsecureShuffle = false;
  try {
    shuffleDeck(deck);
  } catch (error) {
    rejectedInsecureShuffle = error instanceof Error && error.message.includes('Secure crypto RNG is required');
  }
  assert(rejectedInsecureShuffle, 'shuffle must reject runtimes without crypto RNG');
} finally {
  if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
}

const table = createInitialTable([
  { seatIndex: 0, playerId: 'hero', name: 'Hero', chips: 1000, isActive: true, isHero: true },
  { seatIndex: 1, playerId: 'villain', name: 'Villain', chips: 1000, isActive: true },
]);
const hand = createHand(table);
const actorId = hand.currentSeatId!;
const raise = getLegalActions(hand, actorId).find((action) => action.kind === 'raise');
assert(raise?.max, 'opening actor should have a bounded raise action');
const beforeIllegal = totalChips(hand);
const rejected = submitAction(hand, actorId, 'raise', raise.max + 1);
assert(rejected.message.includes('outside the legal range'), 'oversized raise target should be rejected');
assert(totalChips(rejected) === beforeIllegal, 'rejected actions must not move chips');

const base = createHand(createInitialTable([
  { seatIndex: 0, playerId: 'a', name: 'A', chips: 1000, isActive: true },
  { seatIndex: 1, playerId: 'b', name: 'B', chips: 1000, isActive: true },
  { seatIndex: 2, playerId: 'c', name: 'C', chips: 1000, isActive: true },
]));
const sidePotState: HandState = {
  ...base,
  street: 'River',
  board: [
    { rank: 'A', suit: 'clubs' },
    { rank: 'K', suit: 'diamonds' },
    { rank: '9', suit: 'spades' },
    { rank: '8', suit: 'clubs' },
    { rank: '7', suit: 'hearts' },
  ],
  seats: [
    {
      ...base.seats[0],
      id: 'a',
      name: 'A',
      cards: [{ rank: '2', suit: 'clubs' }, { rank: '2', suit: 'diamonds' }],
      stack: 900,
      stackAtHandStart: 1000,
      contribution: 100,
      streetContribution: 0,
      status: 'active',
    },
    {
      ...base.seats[1],
      id: 'b',
      name: 'B',
      cards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }],
      stack: 0,
      stackAtHandStart: 50,
      contribution: 50,
      streetContribution: 0,
      status: 'all-in',
    },
    {
      ...base.seats[2],
      id: 'c',
      name: 'C',
      cards: [{ rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
      stack: 900,
      stackAtHandStart: 1000,
      contribution: 100,
      streetContribution: 0,
      status: 'active',
    },
  ],
  currentSeatId: 'a',
  actedThisRound: ['c'],
  minRaise: 30,
  stage: 'awaiting-action',
};
const chipsBeforeAward = sidePotState.seats.reduce((sum, seat) => sum + seat.stack + seat.contribution, 0);
const completed = submitAction(sidePotState, 'a', 'check');
const chipsAfterAward = completed.seats.reduce((sum, seat) => sum + seat.stack, 0);
assert(completed.stage === 'hand-complete', 'river close should complete the hand');
assert(completed.potAwards.length === 2, `expected main + side pot, got ${completed.potAwards.length}`);
assert(completed.potAwards[0].amount === 150, `expected 150 main pot, got ${completed.potAwards[0].amount}`);
assert(completed.potAwards[0].winnerIds.includes('b'), 'short all-in player should win the main pot');
assert(completed.potAwards[1].amount === 100, `expected 100 side pot, got ${completed.potAwards[1].amount}`);
assert(completed.potAwards[1].winnerIds.includes('c'), 'side pot should exclude short all-in player and award best eligible hand');
assert(chipsAfterAward === chipsBeforeAward, 'chip conservation must hold after side-pot payout');
assert(potSize(completed) === 250, 'completed hand keeps contribution ledger for history');

const oddChipState: HandState = {
  ...base,
  buttonSeatIndex: 1,
  street: 'River',
  board: [
    { rank: 'A', suit: 'clubs' },
    { rank: 'K', suit: 'diamonds' },
    { rank: 'Q', suit: 'spades' },
    { rank: 'J', suit: 'clubs' },
    { rank: '10', suit: 'hearts' },
  ],
  seats: [
    {
      ...base.seats[0],
      id: 'a',
      name: 'A',
      cards: [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'diamonds' }],
      stack: 899,
      stackAtHandStart: 1000,
      contribution: 101,
      streetContribution: 0,
      status: 'active',
    },
    {
      ...base.seats[1],
      id: 'b',
      name: 'B',
      cards: [{ rank: '2', suit: 'spades' }, { rank: '3', suit: 'hearts' }],
      stack: 899,
      stackAtHandStart: 1000,
      contribution: 101,
      streetContribution: 0,
      status: 'folded',
    },
    {
      ...base.seats[2],
      id: 'c',
      name: 'C',
      cards: [{ rank: '4', suit: 'spades' }, { rank: '5', suit: 'hearts' }],
      stack: 899,
      stackAtHandStart: 1000,
      contribution: 101,
      streetContribution: 0,
      status: 'active',
    },
  ],
  currentSeatId: 'a',
  actedThisRound: ['c'],
  minRaise: 30,
  stage: 'awaiting-action',
};
const oddChipCompleted = submitAction(oddChipState, 'a', 'check');
const mainPotPayouts = oddChipCompleted.potAwards[0].payouts;
assert(mainPotPayouts.c === 152, `odd chip should go first left of button, expected C to receive 152 got ${mainPotPayouts.c}`);
assert(mainPotPayouts.a === 151, `remaining tied winner should receive 151, got ${mainPotPayouts.a}`);

const bustedTable = createInitialTable([
  { seatIndex: 0, playerId: 'hero', name: 'Hero', chips: 1000, isActive: true, isHero: true },
  { seatIndex: 1, playerId: 'bot', name: 'Bot', chips: 1000, isActive: true },
]);
const bustedHeroTable = { ...bustedTable, seats: bustedTable.seats.map((seat) => seat.isHero ? { ...seat, chips: 0, isActive: false } : seat) };
const reloadedHeroTable = rebuyBustedSeat(bustedHeroTable, 'hero', 1500);
assert(reloadedHeroTable.seats.find((seat) => seat.isHero)?.chips === 1500, 'rebuy should restore a busted hero to the configured buy-in');
assert(reloadedHeroTable.seats.find((seat) => seat.isHero)?.isActive === true, 'rebuy should reactivate a busted hero');
assert(playableSeatCount(reloadedHeroTable) === 2, 'rebuy should restore the table to two playable seats');

const bustedBotTable = { ...bustedTable, seats: bustedTable.seats.map((seat) => !seat.isHero ? { ...seat, chips: 0, isActive: false } : seat) };
const recoveredBotTable = autoRecoverBotSeats(bustedBotTable, 1200);
assert(recoveredBotTable.seats.find((seat) => !seat.isHero)?.chips === 1200, 'bot recovery should reload busted training opponents');

console.log('NLHE engine verification passed');
