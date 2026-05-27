import { createHand, createInitialTable, syncTableFromHand, type SeatRole, type TableState } from '../src/nlheEngine';

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

console.log('position rotation verification passed');
