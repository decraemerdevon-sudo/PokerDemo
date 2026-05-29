import { createHand, createInitialTable, getSeatLabel, syncTableFromHand, type SeatRole, type TableState } from '../src/nlheEngine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function seatForRole(hand: ReturnType<typeof createHand>, role: SeatRole) {
  return hand.seats.find((seat) => seat.role === role)?.seatIndex;
}

function sync(table: TableState, hand: ReturnType<typeof createHand>) {
  const nextTable = syncTableFromHand(table, hand);
  table.buttonSeatIndex = nextTable.buttonSeatIndex;
  table.handNumber = nextTable.handNumber;
  table.seats = nextTable.seats;
}

const defaultTable = createInitialTable();
assert(defaultTable.seats.length === 6, `default table should be six-handed, got ${defaultTable.seats.length}`);
const defaultHand = createHand(defaultTable);
assert(defaultHand.seats.length === 6, `default hand should deal six active seats, got ${defaultHand.seats.length}`);
assert(seatForRole(defaultHand, 'BTN') !== undefined, 'six-handed hand should assign a button');
assert(seatForRole(defaultHand, 'SB') !== undefined, 'six-handed hand should assign a small blind');
assert(seatForRole(defaultHand, 'BB') !== undefined, 'six-handed hand should assign a big blind');
assert(seatForRole(defaultHand, 'UTG') !== undefined, 'six-handed hand should assign UTG');
assert(seatForRole(defaultHand, 'MP') !== undefined, 'six-handed hand should assign MP');
assert(seatForRole(defaultHand, 'CO') !== undefined, 'six-handed hand should assign CO');

const botRemovalTable = createInitialTable([
  { seatIndex: 0, playerId: 'hero', name: 'Hero', chips: 1000, isActive: true, isHero: true },
  { seatIndex: 1, playerId: 'busted-bot', name: 'Busted Bot', chips: 1000, isActive: true },
  { seatIndex: 2, playerId: 'live-bot', name: 'Live Bot', chips: 1000, isActive: true },
  { seatIndex: 3, playerId: null, name: 'Empty 3', chips: 0, isActive: false },
  { seatIndex: 4, playerId: null, name: 'Empty 4', chips: 0, isActive: false },
  { seatIndex: 5, playerId: null, name: 'Empty 5', chips: 0, isActive: false },
]);
const botRemovalHand = createHand(botRemovalTable);
const botRemovalSynced = syncTableFromHand(botRemovalTable, {
  ...botRemovalHand,
  seats: botRemovalHand.seats.map((seat) => seat.id === 'busted-bot' ? { ...seat, stack: 0 } : seat),
});
assert(botRemovalSynced.seats.length === 6, 'bot removal should preserve six physical table seats');
assert(botRemovalSynced.seats[1].playerId === null, 'busted bot seat should become empty');
assert(botRemovalSynced.seats[1].isActive === false, 'busted bot seat should be inactive');
assert(botRemovalSynced.seats[0].playerId === 'hero', 'hero seat should remain occupied');

const table = createInitialTable([
  { seatIndex: 0, playerId: 'seat-0', name: 'Seat 0', chips: 1000, isActive: true },
  { seatIndex: 1, playerId: null, name: 'Empty 1', chips: 0, isActive: false },
  { seatIndex: 2, playerId: null, name: 'Empty 2', chips: 0, isActive: false },
  { seatIndex: 3, playerId: 'seat-3', name: 'Seat 3', chips: 1000, isActive: true },
  { seatIndex: 4, playerId: null, name: 'Empty 4', chips: 0, isActive: false },
  { seatIndex: 5, playerId: null, name: 'Empty 5', chips: 0, isActive: false },
  { seatIndex: 6, playerId: 'seat-6', name: 'Seat 6', chips: 1000, isActive: true },
]);

const expectedButtons = [0, 3, 6, 0, 3, 6, 0, 3, 6];
let previousCombination = '';

for (let index = 0; index < expectedButtons.length; index += 1) {
  const hand = createHand(table);
  const button = seatForRole(hand, 'BTN');
  const smallBlind = seatForRole(hand, 'SB');
  const bigBlind = seatForRole(hand, 'BB');
  const combination = `${button}-${smallBlind}-${bigBlind}`;

  assert(hand.buttonSeatIndex === expectedButtons[index], `hand ${index + 1}: expected button ${expectedButtons[index]}, got ${hand.buttonSeatIndex}`);
  assert(button === expectedButtons[index], `hand ${index + 1}: BTN role did not match button seat`);
  assert(combination !== previousCombination, `hand ${index + 1}: repeated BTN/SB/BB combination ${combination}`);

  previousCombination = combination;
  sync(table, hand);
}

const headsUpTable = createInitialTable([
  { seatIndex: 0, playerId: 'button', name: 'Button', chips: 1000, isActive: true },
  { seatIndex: 1, playerId: 'blind', name: 'Blind', chips: 1000, isActive: true },
]);
const headsUpHand = createHand(headsUpTable);
assert(seatForRole(headsUpHand, 'BTN/SB') === 0, 'heads-up button must post the small blind');
assert(seatForRole(headsUpHand, 'BB') === 1, 'heads-up non-button player must post the big blind');
assert(headsUpHand.currentSeatId === 'button', 'heads-up button/small blind must act first preflop');

const skipTable = createInitialTable([
  { seatIndex: 0, playerId: 'a', name: 'A', chips: 1000, isActive: true },
  { seatIndex: 1, playerId: 'bust', name: 'Bust', chips: 0, isActive: true },
  { seatIndex: 2, playerId: 'c', name: 'C', chips: 1000, isActive: true },
]);
const skipHand = createHand(skipTable);
assert(skipHand.buttonSeatIndex === 0, 'button should skip zero-chip seats while advancing');

const nineSeatIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const activeSeatIndices = [...nineSeatIndices];
const expectedByButton = [
  { button: 2, labels: { 2: 'BTN', 3: 'SB', 4: 'BB', 5: 'UTG', 6: 'UTG+1', 7: 'MP', 8: 'MP+1', 0: 'HJ', 1: 'CO' } },
  { button: 3, labels: { 3: 'BTN', 4: 'SB', 5: 'BB', 6: 'UTG', 7: 'UTG+1', 8: 'MP', 0: 'MP+1', 1: 'HJ', 2: 'CO' } },
  { button: 4, labels: { 4: 'BTN', 5: 'SB', 6: 'BB', 7: 'UTG', 8: 'UTG+1', 0: 'MP', 1: 'MP+1', 2: 'HJ', 3: 'CO' } },
] as const;

expectedByButton.forEach(({ button, labels }) => {
  Object.entries(labels).forEach(([seatIndex, label]) => {
    assert(
      getSeatLabel(Number(seatIndex), button, activeSeatIndices) === label,
      `button ${button}: expected seat ${seatIndex} to render ${label}, got ${getSeatLabel(Number(seatIndex), button, activeSeatIndices)}`,
    );
  });
});

console.log('position rotation verification passed');
