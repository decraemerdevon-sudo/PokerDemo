import { ActionKind, Card, HandEvent, HandState, Street } from './nlheEngine';

export type StreetKey = 'preflop' | 'flop' | 'turn' | 'river';

export type HandRecord = {
  handId: string;
  handNumber: number;
  timestamp: number;
  buttonSeatIndex: number;
  players: Array<{
    playerId: string;
    displayName: string;
    position: string;
    stackAtHandStart: number;
    holeCards: Card[] | null;
    finalStack: number;
    netResult: number;
    foldedStreet: StreetKey | null;
    isHero: boolean;
  }>;
  flopCards: Card[] | null;
  turnCard: Card | null;
  riverCard: Card | null;
  streets: {
    preflop: StreetRecord;
    flop: StreetRecord | null;
    turn: StreetRecord | null;
    river: StreetRecord | null;
  };
  pots: Array<{
    label: string;
    amount: number;
    winnerId: string;
    winnerHandDescription: string | null;
    wentToShowdown: boolean;
  }>;
  sawFlop: string[];
  wentToShowdown: string[];
  voluntaryPutInPot: string[];
};

export type StreetRecord = {
  actions: Array<{
    playerId: string;
    displayName: string;
    position: string;
    actionType: ActionKind | 'small-blind' | 'big-blind';
    amount: number | null;
    potBefore: number;
    potAfter: number;
    stackBefore: number;
    betSizingPct: number | null;
  }>;
  potAtStreetEnd: number;
};

export type PlayerSessionStats = {
  playerId: string;
  displayName: string;
  handsPlayed: number;
  VPIP: number;
  PFR: number;
  threebet: number;
  foldTo3bet: number;
  AF: number;
  CBet_flop: number;
  foldToCBet: number;
  WTSD: number;
  WSD: number;
  WON_NO_SD: number;
  totalNetChips: number;
  bbPer100: number;
  biggestWin: number;
  biggestLoss: number;
};

const STORAGE_KEY = 'poker-demo-hand-history-v1';
const streetKeyByStreet: Partial<Record<Street, StreetKey>> = {
  Preflop: 'preflop',
  Flop: 'flop',
  Turn: 'turn',
  River: 'river',
};

function emptyStreet(): StreetRecord {
  return { actions: [], potAtStreetEnd: 0 };
}

function actionEvents(events: HandEvent[]) {
  return events.filter((event) => event.playerId && event.position && event.actionType && !['deal', 'award-pot'].includes(event.actionType));
}

function foldedStreetFor(playerId: string, events: HandEvent[]): StreetKey | null {
  const fold = actionEvents(events).find((event) => event.playerId === playerId && event.actionType === 'fold');
  return fold ? streetKeyByStreet[fold.street] ?? null : null;
}

function buildStreetRecord(street: Street, events: HandEvent[]): StreetRecord | null {
  const actions = actionEvents(events)
    .filter((event) => event.street === street)
    .map((event) => ({
      playerId: event.playerId!,
      displayName: event.actor,
      position: event.position!,
      actionType: event.actionType as ActionKind | 'small-blind' | 'big-blind',
      amount: event.amount ?? null,
      potBefore: event.potBefore ?? 0,
      potAfter: event.potAfter ?? event.potBefore ?? 0,
      stackBefore: event.stackBefore ?? 0,
      betSizingPct: event.betSizingPct ?? null,
    }));

  if (street !== 'Preflop' && actions.length === 0) return null;
  return { actions, potAtStreetEnd: actions.at(-1)?.potAfter ?? 0 };
}

function playerPutChipsInPreflop(event: HandEvent) {
  if (event.street !== 'Preflop') return false;
  if (!['call', 'bet', 'raise'].includes(String(event.actionType))) return false;
  return (event.amount ?? 0) > 0;
}

function isShowdown(state: HandState) {
  return state.board.length === 5 && state.seats.filter((seat) => seat.status !== 'folded').length > 1;
}

function rankHandDescription(showdown: boolean) {
  return showdown ? 'Best five-card hand' : null;
}

export function loadSessionHistory(): HandRecord[] {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) as HandRecord[] : [];
  } catch {
    return [];
  }
}

export function saveSessionHistory(records: HandRecord[]) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function appendCompletedHand(history: HandRecord[], state: HandState): HandRecord[] {
  if (history.some((record) => record.handId === state.handId)) return history;
  const events = state.events;
  const showdown = isShowdown(state);
  const wentToShowdown = showdown ? state.seats.filter((seat) => seat.status !== 'folded').map((seat) => seat.id) : [];
  const sawFlop = state.board.length >= 3 ? state.seats.filter((seat) => foldedStreetFor(seat.id, events) !== 'preflop').map((seat) => seat.id) : [];
  const preflopPutIn = new Set(actionEvents(events).filter(playerPutChipsInPreflop).map((event) => event.playerId!));

  const record: HandRecord = {
    handId: state.handId,
    handNumber: state.handNumber,
    timestamp: Date.now(),
    buttonSeatIndex: state.buttonSeatIndex,
    players: state.seats.map((seat) => ({
      playerId: seat.id,
      displayName: seat.name,
      position: seat.role,
      stackAtHandStart: seat.stackAtHandStart,
      holeCards: seat.isHero || wentToShowdown.includes(seat.id) ? seat.cards : null,
      finalStack: seat.stack,
      netResult: seat.stack - seat.stackAtHandStart,
      foldedStreet: foldedStreetFor(seat.id, events),
      isHero: Boolean(seat.isHero),
    })),
    flopCards: state.board.length >= 3 ? state.board.slice(0, 3) : null,
    turnCard: state.board[3] ?? null,
    riverCard: state.board[4] ?? null,
    streets: {
      preflop: buildStreetRecord('Preflop', events) ?? emptyStreet(),
      flop: buildStreetRecord('Flop', events),
      turn: buildStreetRecord('Turn', events),
      river: buildStreetRecord('River', events),
    },
    pots: state.potAwards.flatMap((pot) => pot.winnerIds.map((winnerId) => ({
      label: pot.label,
      amount: pot.payouts[winnerId] ?? Math.floor(pot.amount / Math.max(1, pot.winnerIds.length)),
      winnerId,
      winnerHandDescription: pot.winnerHandDescription ?? rankHandDescription(showdown),
      wentToShowdown: pot.wentToShowdown,
    }))),
    sawFlop,
    wentToShowdown,
    voluntaryPutInPot: Array.from(preflopPutIn),
  };

  const next = [record, ...history];
  saveSessionHistory(next);
  return next;
}

function pct(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

export function calculateSessionStats(playerId: string, history: HandRecord[], bigBlind: number): PlayerSessionStats {
  const hands = history.filter((hand) => hand.players.some((player) => player.playerId === playerId));
  const player = hands[0]?.players.find((candidate) => candidate.playerId === playerId);
  const preflopRaises = hands.filter((hand) => hand.streets.preflop.actions.some((action) => action.playerId === playerId && action.actionType === 'raise'));
  const postflopActions = hands.flatMap((hand) => [hand.streets.flop, hand.streets.turn, hand.streets.river].flatMap((street) => street?.actions ?? []));
  const playerPostflop = postflopActions.filter((action) => action.playerId === playerId);
  const aggressive = playerPostflop.filter((action) => action.actionType === 'bet' || action.actionType === 'raise').length;
  const calls = playerPostflop.filter((action) => action.actionType === 'call').length;
  const sawFlopHands = hands.filter((hand) => hand.sawFlop.includes(playerId));
  const showdownHands = hands.filter((hand) => hand.wentToShowdown.includes(playerId));
  const showdownWins = showdownHands.filter((hand) => hand.pots.some((pot) => pot.winnerId === playerId && pot.wentToShowdown));
  const noShowdownWins = sawFlopHands.filter((hand) => hand.pots.some((pot) => pot.winnerId === playerId && !pot.wentToShowdown));
  const netResults = hands.map((hand) => hand.players.find((candidate) => candidate.playerId === playerId)?.netResult ?? 0);
  const totalNetChips = netResults.reduce((sum, result) => sum + result, 0);

  return {
    playerId,
    displayName: player?.displayName ?? playerId,
    handsPlayed: hands.length,
    VPIP: pct(hands.filter((hand) => hand.voluntaryPutInPot.includes(playerId)).length, hands.length),
    PFR: pct(preflopRaises.length, hands.length),
    threebet: pct(hands.filter((hand) => hand.streets.preflop.actions.filter((action) => action.actionType === 'raise').at(1)?.playerId === playerId).length, hands.length),
    foldTo3bet: pct(hands.filter((hand) => {
      const raises = hand.streets.preflop.actions.filter((action) => action.actionType === 'raise');
      return raises[0]?.playerId === playerId && raises[1] && hand.streets.preflop.actions.some((action) => action.playerId === playerId && action.actionType === 'fold' && action.potBefore >= raises[1].potAfter);
    }).length, Math.max(1, preflopRaises.length)),
    AF: calls > 0 ? Number((aggressive / calls).toFixed(1)) : aggressive,
    CBet_flop: pct(hands.filter((hand) => hand.streets.preflop.actions.some((action) => action.playerId === playerId && action.actionType === 'raise') && hand.streets.flop?.actions.some((action) => action.playerId === playerId && action.actionType === 'bet')).length, preflopRaises.length),
    foldToCBet: pct(hands.filter((hand) => hand.streets.flop?.actions.some((action) => action.actionType === 'bet') && hand.streets.flop?.actions.some((action) => action.playerId === playerId && action.actionType === 'fold')).length, sawFlopHands.length),
    WTSD: pct(showdownHands.length, sawFlopHands.length),
    WSD: pct(showdownWins.length, showdownHands.length),
    WON_NO_SD: pct(noShowdownWins.length, sawFlopHands.length),
    totalNetChips,
    bbPer100: hands.length > 0 ? Number(((totalNetChips / bigBlind / hands.length) * 100).toFixed(1)) : 0,
    biggestWin: Math.max(0, ...netResults),
    biggestLoss: Math.min(0, ...netResults),
  };
}
