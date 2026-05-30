import { KeyboardEvent, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  ActionKind,
  Card,
  DEFAULT_BUY_IN,
  HandEvent,
  HandState,
  TableState,
  addChipsToSeat,
  autoRecoverBotSeats,
  chooseBotAction,
  createInitialTable,
  createNextHand,
  getSeatLabel,
  getLegalActions,
  playableSeatCount,
  potSize,
  rebuyBustedSeat,
  submitAction,
  syncTableFromHand,
  visibleBoard,
} from './nlheEngine';
import { getSeatPosition, seatAngleForIndex } from './seatGeometry';
import { getPlayerId, persistCompletedHand, trackHandHistoryEvent } from './handHistoryAnalytics';
import { appendCompletedHand, buildHandRecord, calculateSessionStats, HandRecord, loadSessionHistory, PlayerSessionStats } from './handHistory';
import { formatMoney, clampWholeChip } from './utils/format';
import { CardView } from './components/CardView';
import { ChipStacksView } from './components/ChipViews';
import { SeatView, PlayerBetChips } from './components/SeatView';
import { ActionFeed, isUserFacingReplayEvent } from './components/ActionFeed';
import { CoachPanel } from './components/CoachPanel';
import { HandHistoryPanel } from './components/HandHistoryPanel';
import { RebuyModal, RebuyPanel, RecoveryNotice } from './components/RebuyPanel';
import { HistoryCards } from './components/CardView';

type TableMode = 'play' | 'review';
type CustomBetState = {
  isOpen: boolean;
  value: number;
  min: number;
  max: number;
};

const HERO_INITIAL_BUY_IN = 1500;

function sourceForAnalytics(event: HandEvent) {
  if (event.source === 'hero') return 'hero-action' as const;
  if (event.source === 'bot') return 'bot-action' as const;
  if (event.action === 'Deal street') return 'street-change' as const;
  if (event.action === 'Deal') return 'initial-state' as const;
  return 'reset' as const;
}

function App() {
  const [tableState, setTableState] = useState(() => {
    try {
      const saved = window.sessionStorage.getItem('poker-demo-game-state');
      if (saved) {
        const parsed = JSON.parse(saved) as { table: TableState; hand: HandState };
        if (parsed?.table?.seats && parsed?.hand?.stage) return parsed;
      }
    } catch { /* fall through to fresh start */ }
    const table = createInitialTable();
    const savedHandNumber = parseInt(window.sessionStorage.getItem('poker-demo-hand-number') || '0', 10);
    if (savedHandNumber > 0) table.handNumber = savedHandNumber;
    const next = createNextHand(table);
    if (!next) throw new Error('Unable to start table with fewer than two active players');
    return next;
  });
  const state = tableState.hand;
  const [mode, setMode] = useState<TableMode>('play');
  const [selectedEvent, setSelectedEvent] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [handHistoryOpen, setHandHistoryOpen] = useState(false);
  const [sessionHistory, setSessionHistory] = useState<HandRecord[]>(() => loadSessionHistory());
  const [selectedHandId, setSelectedHandId] = useState<string | null>(() => loadSessionHistory()[0]?.handId ?? null);
  const [customBet, setCustomBet] = useState<CustomBetState>({ isOpen: false, value: 0, min: 0, max: 0 });
  const [customBetError, setCustomBetError] = useState('');
  const [customBetFlash, setCustomBetFlash] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<RecoveryNotice | null>(null);
  const customBetRef = useRef<HTMLDivElement | null>(null);
  const persistedHandIds = useRef(new Set<string>());
  const currentRunHandIds = useRef(new Set<string>());
  const [historyView, setHistoryView] = useState<'session' | 'all'>('session');
  const [addOnAmount, setAddOnAmount] = useState(Math.floor(DEFAULT_BUY_IN / 2));
  const [addOnQueued, setAddOnQueued] = useState(false);
  const addOnQueuedRef = useRef(false);
  const addOnAmountRef = useRef(Math.floor(DEFAULT_BUY_IN / 2));
  const [rebuyModalOpen, setRebuyModalOpen] = useState(false);
  const [thinkingSeats, setThinkingSeats] = useState<Set<string>>(new Set());
  const [heroTotalInvested, setHeroTotalInvested] = useState(() => {
    const saved = parseInt(window.sessionStorage.getItem('poker-demo-total-invested') || '0', 10);
    return saved > 0 ? saved : HERO_INITIAL_BUY_IN;
  });

  useEffect(() => {
    const playerId = getPlayerId();
    fetch(`/api/hands?playerId=${encodeURIComponent(playerId)}`)
      .then((r) => r.json())
      .then((data: { hands?: HandRecord[] }) => {
        if (!Array.isArray(data.hands) || data.hands.length === 0) return;
        setSessionHistory((local) => {
          const localIds = new Set(local.map((h) => h.handId));
          const fromDb = data.hands!.filter((h) => !localIds.has(h.handId));
          const merged = [...local, ...fromDb].sort((a, b) => b.timestamp - a.timestamp);
          return merged;
        });
        setSelectedHandId((current) => current ?? data.hands![0]?.handId ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    try { window.sessionStorage.setItem('poker-demo-game-state', JSON.stringify(tableState)); } catch {}
  }, [tableState]);

  useEffect(() => {
    window.sessionStorage.setItem('poker-demo-total-invested', String(heroTotalInvested));
  }, [heroTotalInvested]);

  const board = visibleBoard(state);
  const pot = potSize(state);
  const hero = state.seats.find((seat) => seat.isHero)!;
  const playableSeats = playableSeatCount(tableState.table);
  const activeSeat = state.currentSeatId ? state.seats.find((seat) => seat.id === state.currentSeatId) : undefined;
  const legalActions = useMemo(() => getLegalActions(state, hero.id), [state, hero.id]);
  const customBetAction = legalActions.find((action) => action.kind === 'raise') ?? legalActions.find((action) => action.kind === 'bet');
  const customBetLimits = useMemo(() => {
    if (!customBetAction) return null;
    const min = customBetAction.min ?? (customBetAction.kind === 'bet' ? state.bigBlind : customBetAction.targetContribution);
    const max = customBetAction.max ?? hero.streetContribution + hero.stack;
    return { min, max };
  }, [customBetAction, hero.stack, hero.streetContribution, state.bigBlind]);
  const replayEvents = useMemo(() => state.events.filter(isUserFacingReplayEvent), [state.events]);
  const activePlayers = state.seats.filter((seat) => seat.status === 'active' || seat.status === 'all-in');
  const tableSeatCount = tableState.table.seats.length;
  const occupiedSeatIndices = tableState.table.seats.filter((seat) => seat.playerId && seat.isActive && seat.chips > 0).map((seat) => seat.seatIndex);
  const isHeroTurn = state.currentSeatId === hero.id && state.stage === 'awaiting-action';
  const modeLabel = state.stage === 'hand-complete' ? 'Showdown' : activeSeat?.isHero ? 'Player turn' : activeSeat ? 'Bot action' : 'Resolving';
  const visibleHistory = useMemo(
    () => historyView === 'session' ? sessionHistory.filter((h) => currentRunHandIds.current.has(h.handId)) : sessionHistory,
    [historyView, sessionHistory]
  );
  const sessionStats = useMemo(() => state.seats.map((seat) => calculateSessionStats(seat.id, visibleHistory, state.bigBlind)), [visibleHistory, state.seats, state.bigBlind]);

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

  const SUIT_CODES_BOT: Record<Card['suit'], string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };
  const cardCode = useCallback((c: Card) => `${c.rank}${SUIT_CODES_BOT[c.suit]}`, []);

  useEffect(() => {
    if (!activeSeat || activeSeat.isHero || state.stage !== 'awaiting-action') return;

    const seatId = activeSeat.id;
    const MIN_DELAY = 500;
    const startTime = Date.now();

    setThinkingSeats((prev) => new Set(prev).add(seatId));

    const legal = getLegalActions(state, seatId);
    const payload = {
      street: state.street,
      handNumber: state.handNumber,
      board: state.board.map(cardCode),
      pot: potSize(state),
      bigBlind: state.bigBlind,
      botStyle: activeSeat.style ?? 'balanced',
      botSeatId: seatId,
      seats: state.seats.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        stack: s.stack,
        streetContribution: s.streetContribution,
        status: s.status,
        isHero: s.isHero ?? false,
        isBot: !s.isHero,
        holeCards: s.id === seatId ? s.cards.map(cardCode) : null,
      })),
      legalActions: legal.map((a) => ({ kind: a.kind, label: a.label, targetContribution: a.targetContribution, min: a.min, max: a.max })),
      recentEvents: state.events.slice(-8).map((e) => `${e.actor} ${e.action}${e.amount ? ` $${e.amount}` : ''}`),
    };

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    fetch('/api/bot-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
      .then((r) => r.ok ? r.json() as Promise<{ kind: ActionKind; targetContribution?: number }> : Promise.reject())
      .then((decision) => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, MIN_DELAY - elapsed);
        window.setTimeout(() => {
          setThinkingSeats((prev) => { const next = new Set(prev); next.delete(seatId); return next; });
          setTableState((current) => {
            if (current.hand.currentSeatId !== seatId) return current;
            return { ...current, hand: submitAction(current.hand, seatId, decision.kind, decision.targetContribution) };
          });
        }, remaining);
      })
      .catch(() => {
        // Fallback to local engine on any error
        window.clearTimeout(timeout);
        setThinkingSeats((prev) => { const next = new Set(prev); next.delete(seatId); return next; });
        setTableState((current) => {
          if (current.hand.currentSeatId !== seatId) return current;
          const decision = chooseBotAction(current.hand, seatId);
          return { ...current, hand: submitAction(current.hand, seatId, decision.kind, decision.targetContribution) };
        });
      });

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      setThinkingSeats((prev) => { const next = new Set(prev); next.delete(seatId); return next; });
    };
  }, [activeSeat?.id, state.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSelectedEvent((current) => Math.max(0, Math.min(current, replayEvents.length - 1)));
  }, [replayEvents.length]);

  useEffect(() => {
    if (state.stage !== 'hand-complete') return;
    window.sessionStorage.setItem('poker-demo-hand-number', String(state.handNumber));
    if (!persistedHandIds.current.has(state.handId)) {
      persistedHandIds.current.add(state.handId);
      currentRunHandIds.current.add(state.handId);
      persistCompletedHand(buildHandRecord(state));
    }
    setSessionHistory((current) => {
      const next = appendCompletedHand(current, state);
      setSelectedHandId((selected) => selected ?? next[0]?.handId ?? null);
      return next;
    });
    const timer = window.setTimeout(() => {
      const heroFinalStack = state.seats.find((s) => s.isHero)?.stack ?? 0;
      const pendingAddOn = addOnQueuedRef.current && heroFinalStack > 0
        ? Math.min(addOnAmountRef.current, DEFAULT_BUY_IN - heroFinalStack)
        : 0;
      if (addOnQueuedRef.current) {
        addOnQueuedRef.current = false;
        setAddOnQueued(false);
      }
      setTableState((current) => {
        let syncedTable = autoRecoverBotSeats(syncTableFromHand(current.table, current.hand));
        if (pendingAddOn > 0) {
          syncedTable = addChipsToSeat(syncedTable, hero.id, pendingAddOn);
        }
        const heroSeat = syncedTable.seats.find((seat) => seat.isHero);
        if (heroSeat && heroSeat.chips <= 0) {
          setRebuyModalOpen(true);
          return { ...current, table: syncedTable };
        }
        const next = createNextHand(syncedTable);
        if (!next) {
          setRecoveryNotice({ tone: 'warning', message: 'Only one live seat remains. Rebuy or recover the table before the next hand.' });
          return { ...current, table: syncedTable };
        }
        return next;
      });
      if (pendingAddOn > 0) {
        setHeroTotalInvested((c) => c + pendingAddOn);
        setRecoveryNotice({ tone: 'info', message: `${formatMoney(pendingAddOn)} add-on posted before the next hand.` });
      }
      setSelectedEvent(0);
      setMode('play');
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [state.stage]);

  useEffect(() => {
    if (state.stage !== 'hand-complete') return;
    if (hero.stack <= 0 && addOnQueuedRef.current) {
      addOnQueuedRef.current = false;
      setAddOnQueued(false);
    }
    const fillAmount = DEFAULT_BUY_IN - hero.stack;
    if (fillAmount > 0) {
      addOnAmountRef.current = fillAmount;
      setAddOnAmount(fillAmount);
    }
  }, [state.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!customBet.isOpen || !customBetLimits) return;
    setCustomBet((current) => ({
      ...current,
      min: customBetLimits.min,
      max: customBetLimits.max,
      value: clampWholeChip(current.value || customBetLimits.min, customBetLimits.min, customBetLimits.max),
    }));
  }, [customBet.isOpen, customBetLimits]);

  useEffect(() => {
    if (!customBet.isOpen) return;
    const closeCustomBet = (event: MouseEvent) => {
      if (customBetRef.current?.contains(event.target as Node)) return;
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setCustomBet((current) => ({ ...current, isOpen: false }));
      setCustomBetError('');
    };
    document.addEventListener('mousedown', closeCustomBet);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', closeCustomBet);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [customBet.isOpen]);

  const runAction = (kind: ActionKind, targetContribution?: number) => {
    if (!isHeroTurn) return;
    setTableState((current) => ({ ...current, hand: submitAction(current.hand, hero.id, kind, targetContribution) }));
    setMode('play');
    setCustomBet((current) => ({ ...current, isOpen: false }));
    setCustomBetError('');
  };

  const rebuyHero = () => {
    setTableState((current) => {
      const syncedTable = syncTableFromHand(current.table, current.hand);
      const next = createNextHand(autoRecoverBotSeats(rebuyBustedSeat(syncedTable, hero.id)));
      if (!next) return current;
      return next;
    });
    setHeroTotalInvested((current) => current + DEFAULT_BUY_IN);
    setRebuyModalOpen(false);
    setRecoveryNotice(null);
    setSelectedEvent(0);
    setMode('play');
  };

  const toggleAddOnQueue = () => {
    const next = !addOnQueuedRef.current;
    addOnQueuedRef.current = next;
    setAddOnQueued(next);
  };

  const toggleCustomBet = () => {
    if (!customBetLimits) return;
    setCustomBet((current) => ({
      isOpen: !current.isOpen,
      min: customBetLimits.min,
      max: customBetLimits.max,
      value: clampWholeChip(current.value || customBetLimits.min, customBetLimits.min, customBetLimits.max),
    }));
    setCustomBetError('');
  };

  const setCustomBetValue = (value: number) => {
    setCustomBet((current) => ({ ...current, value: Math.round(value) }));
    setCustomBetError('');
  };

  const applyQuickSize = (size: number) => {
    if (!customBetLimits) return;
    setCustomBetValue(clampWholeChip(size, customBetLimits.min, customBetLimits.max));
  };

  const confirmCustomBet = () => {
    if (!customBetAction || !customBetLimits) return;
    const value = Math.round(customBet.value);
    if (value < customBetLimits.min) {
      setCustomBetError(`Minimum bet is ${formatMoney(customBetLimits.min)}`);
      setCustomBetFlash(true);
      window.setTimeout(() => setCustomBetFlash(false), 240);
      return;
    }
    runAction(customBetAction.kind, Math.min(value, customBetLimits.max));
  };

  const handleTimelineKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!historyVisible) return;
    if (replayEvents.length === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); setSelectedEvent((current) => Math.min(replayEvents.length - 1, current + 1)); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); setSelectedEvent((current) => Math.max(0, current - 1)); }
  };

  const showAllCards = state.stage === 'hand-complete';

  return (
    <main className="app-shell">
      <section className="table-panel" aria-labelledby="table-title">
        <header className="top-bar">
          <div><p className="eyebrow">Texas Hold'em trainer</p><h1 id="table-title">Training Table</h1></div>
          <button className="hand-history-toggle hand-history-top" onClick={() => setHandHistoryOpen((open) => !open)} type="button" aria-expanded={handHistoryOpen}>
            <span aria-hidden="true">H</span> Hand History
          </button>
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
            {state.seats.map((seat) => <PlayerBetChips key={`${seat.id}-chips`} seat={seat} seatAngle={seatAngleForIndex(seat.seatIndex, tableSeatCount)} />)}
            <div className="board">
              <p>Board</p>
              <div className="board-cards">{state.board.map((card, index) => <CardView key={`${card.rank}-${card.suit}`} card={card} hidden={index >= board.length && state.stage !== 'hand-complete'} />)}</div>
              <div className="board-pot"><ChipStacksView amount={pot} size="pot" /></div>
              <dl className="pot-summary"><div><dt>Active</dt><dd>{activePlayers.length}</dd></div></dl>
            </div>
            <div className="seats-grid">{state.seats.map((seat) => {
              const seatAngle = seatAngleForIndex(seat.seatIndex, tableSeatCount);
              // Top (0°) and bottom (180°) seats use a larger radius so chips fit in the gap between them and the board
              const seatRadius = Math.abs(Math.cos(seatAngle * Math.PI / 180)) > 0.7 ? 40 : 32;
              const position = getSeatPosition(seatAngle, { x: 50, y: 50 }, seatRadius);
              return (
                <SeatView
                  isButton={seat.seatIndex === state.buttonSeatIndex}
                  isThinking={thinkingSeats.has(seat.id)}
                  key={seat.id}
                  positionLabel={getSeatLabel(seat.seatIndex, state.buttonSeatIndex, occupiedSeatIndices)}
                  reveal={seat.isHero || showAllCards}
                  seat={seat}
                  street={state.street}
                  style={{ left: `${position.x}%`, top: `${position.y}%` }}
                />
              );
            })}</div>
          </div>
        </div>
        <section className="action-panel" aria-labelledby="actions-title">
          <div><h2 id="actions-title">Legal Actions</h2><p aria-live="polite">{activeSeat?.isHero ? 'Action is on you.' : activeSeat ? `${activeSeat.name} is resolving a legal engine action.` : state.message}</p></div>
          <div className="betting-controls" ref={customBetRef}>
            <dl className="session-investment" aria-label="Session investment">
              <div><dt>Current hand pot</dt><dd>{formatMoney(pot)}</dd></div>
              <div><dt>Your session invested</dt><dd>{formatMoney(heroTotalInvested)}</dd></div>
            </dl>
            {customBet.isOpen && customBetLimits && (
              <div className="custom-bet-panel" role="dialog" aria-labelledby="custom-bet-title">
                <div className="custom-bet-heading">
                  <h3 id="custom-bet-title">Custom Bet</h3>
                  <span>{formatMoney(customBetLimits.min)} - {formatMoney(customBetLimits.max)}</span>
                </div>
                <label className="custom-bet-input">
                  <span className="sr-only">Custom bet amount</span>
                  <input
                    aria-describedby={customBetError ? 'custom-bet-error' : undefined}
                    className={customBetFlash ? 'input-flash' : ''}
                    inputMode="numeric"
                    max={customBetLimits.max}
                    min={customBetLimits.min}
                    onChange={(event) => setCustomBetValue(Number(event.target.value))}
                    type="number"
                    value={Number.isNaN(customBet.value) ? '' : customBet.value}
                  />
                </label>
                <input
                  aria-label="Custom bet amount slider"
                  className="custom-bet-slider"
                  max={customBetLimits.max}
                  min={customBetLimits.min}
                  onChange={(event) => setCustomBetValue(Number(event.target.value))}
                  step={1}
                  type="range"
                  value={clampWholeChip(customBet.value || customBetLimits.min, customBetLimits.min, customBetLimits.max)}
                />
                <div className="custom-bet-range"><span>Min: {formatMoney(customBetLimits.min)}</span><span>Max: {formatMoney(customBetLimits.max)}</span></div>
                <div className="quick-sizes" aria-label="Quick bet sizes">
                  <span>Quick sizes:</span>
                  <button onClick={() => applyQuickSize(Math.floor(pot * 0.5))} type="button">1/2 Pot</button>
                  <button onClick={() => applyQuickSize(pot)} type="button">Pot</button>
                  <button onClick={() => applyQuickSize(pot * 2)} type="button">2x Pot</button>
                </div>
                {customBetError && <p className="custom-bet-error" id="custom-bet-error" role="alert">{customBetError}</p>}
                <button className="confirm-bet" disabled={!isHeroTurn} onClick={confirmCustomBet} type="button">Confirm Bet</button>
              </div>
            )}
            <div className="action-grid">
            {legalActions.map((action) => (
              <button className="primary-action" disabled={!isHeroTurn} key={action.kind} onClick={() => runAction(action.kind, action.targetContribution)} type="button">
                <span>{action.label}</span>
              </button>
            ))}
            {customBetAction && (
              <button aria-expanded={customBet.isOpen} className="primary-action custom-bet-toggle" disabled={!isHeroTurn} onClick={toggleCustomBet} type="button">
                <span>Custom Bet</span>
              </button>
            )}
            <span className="auto-hand-status" role="status">{state.stage === 'hand-complete' ? 'Next hand auto-starts' : 'Hand in progress'}</span>
            </div>
          </div>
        </section>
        <RebuyPanel
          addOnAmount={addOnAmount}
          addOnQueued={addOnQueued}
          canRebuy={state.stage === 'hand-complete' && hero.stack <= 0}
          heroStack={hero.stack}
          notice={recoveryNotice}
          onAddOnAmountChange={(amount) => { addOnAmountRef.current = amount; setAddOnAmount(amount); }}
          onAddOnToggle={toggleAddOnQueue}
          onRebuy={rebuyHero}
          playableSeats={playableSeats}
        />
      </section>
      <aside className="side-rail" aria-label="Training side panels">
        <CoachPanel state={state} />
        <section className="review-panel" aria-labelledby="review-title">
          <div className="panel-heading"><div><p className="eyebrow">Replay</p><h2 id="review-title">Hand Timeline</h2></div><button onClick={() => setHistoryVisible((visible) => !visible)} type="button">{historyVisible ? 'Hide' : 'Show'}</button></div>
          {historyVisible ? (
            <>
              <ActionFeed
                events={replayEvents}
                onKeyDown={handleTimelineKey}
                onSelect={(index) => { setSelectedEvent(index); setMode('review'); }}
                selectedEvent={selectedEvent}
              />
              <div className="timeline-hero-hand" aria-label="Your hole cards">
                <span>Your hand</span>
                <HistoryCards cards={hero.cards} />
              </div>
            </>
          ) : <div className="empty-state"><strong>Empty history</strong><p>No hand events are selected for review.</p></div>}
        </section>
      </aside>
      {handHistoryOpen && <HandHistoryPanel history={visibleHistory} selectedHandId={selectedHandId} setSelectedHandId={setSelectedHandId} stats={sessionStats} historyView={historyView} onHistoryViewChange={setHistoryView} onClose={() => setHandHistoryOpen(false)} />}
      {rebuyModalOpen && <RebuyModal onRebuy={rebuyHero} />}
    </main>
  );
}

export default App;
