import { useEffect, useRef, useState } from 'react';
import { HandRecord, PlayerSessionStats, StreetKey } from '../handHistory';
import { formatMoney, signedMoney, cardText } from '../utils/format';
import { HistoryCards } from './CardView';
import { CoachMessage } from './CoachPanel';

const SESSION_QUICK_PROMPTS = [
  "What are my biggest leaks?",
  "How's my 3-bet game?",
  "Where am I losing most?",
  "Is my postflop play good?",
];

const HAND_QUICK_PROMPTS = [
  "What did I do wrong?",
  "Was the flop bet correct?",
  "What's villain's range here?",
  "What's the optimal line?",
];

const STREET_QUICK_PROMPTS = [
  "What's the best sizing here?",
  "Should I have c-bet?",
  "Was this the right line?",
  "What hands call/fold here?",
];

function streetTitle(street: StreetKey, hand: HandRecord) {
  if (street === 'flop') return `FLOP ${hand.flopCards ? `[${cardText(hand.flopCards)}]` : ''}`;
  if (street === 'turn') return `TURN ${hand.turnCard ? `[${cardText([hand.turnCard])}]` : ''}`;
  if (street === 'river') return `RIVER ${hand.riverCard ? `[${cardText([hand.riverCard])}]` : ''}`;
  return 'PREFLOP';
}

export function HandHistoryPanel({
  history,
  selectedHandId,
  setSelectedHandId,
  stats,
  historyView,
  onHistoryViewChange,
  onClose,
}: {
  history: HandRecord[];
  selectedHandId: string | null;
  setSelectedHandId: (handId: string) => void;
  stats: PlayerSessionStats[];
  historyView: 'session' | 'all';
  onHistoryViewChange: (view: 'session' | 'all') => void;
  onClose: () => void;
}) {
  const selected = history.find((hand) => hand.handId === selectedHandId) ?? history[0] ?? null;
  const heroId = selected?.players.find((player) => player.isHero)?.playerId;

  const [coachContext, setCoachContext] = useState<'session' | 'hand' | 'street'>('session');
  const [focusStreet, setFocusStreet] = useState<StreetKey | null>(null);

  const contextKey =
    coachContext === 'street' && selected && focusStreet ? `street:${selected.handId}:${focusStreet}`
    : coachContext === 'hand' && selected ? `hand:${selected.handId}`
    : `session:${historyView}`;

  const isHandMode = coachContext !== 'session';
  const quickPrompts =
    coachContext === 'street' ? STREET_QUICK_PROMPTS
    : coachContext === 'hand' ? HAND_QUICK_PROMPTS
    : SESSION_QUICK_PROMPTS;

  const [historyCoachThreads, setHistoryCoachThreads] = useState<Record<string, CoachMessage[]>>({});
  const [historyCoachStreaming, setHistoryCoachStreaming] = useState(false);
  const [historyCoachStreamText, setHistoryCoachStreamText] = useState('');
  const [historyCoachInput, setHistoryCoachInput] = useState('');
  const historyCoachMessagesRef = useRef<HTMLDivElement | null>(null);
  const abortHistoryCoachRef = useRef<AbortController | null>(null);

  const coachMessages = historyCoachThreads[contextKey] ?? [];

  useEffect(() => {
    historyCoachMessagesRef.current?.scrollTo({ top: historyCoachMessagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [historyCoachThreads, historyCoachStreamText, contextKey]);

  const sendHistoryCoachMessage = async (message: string) => {
    if (historyCoachStreaming) return;
    if (!message.trim()) return;

    abortHistoryCoachRef.current?.abort();
    const controller = new AbortController();
    abortHistoryCoachRef.current = controller;

    const userMsg: CoachMessage = { role: 'user', content: message };
    const prevMessages = historyCoachThreads[contextKey] ?? [];
    setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...prevMessages, userMsg] }));
    setHistoryCoachStreaming(true);
    setHistoryCoachStreamText('');

    const body = coachContext === 'street'
      ? { mode: 'hand', hand: selected, focusStreet, userMessage: message, history: prevMessages.slice(-8) }
      : coachContext === 'hand'
      ? { mode: 'hand', hand: selected, userMessage: message, history: prevMessages.slice(-8) }
      : { mode: 'session', stats, hands: history, userMessage: message, history: prevMessages.slice(-8) };

    try {
      const resp = await fetch('/api/coach-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) throw new Error('Coach unavailable');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload) as { text?: string; error?: string };
            if (parsed.error) { accumulated = parsed.error; break; }
            if (parsed.text) { accumulated += parsed.text; setHistoryCoachStreamText(accumulated); }
          } catch { /* ignore malformed SSE */ }
        }
      }

      const assistantMsg: CoachMessage = { role: 'assistant', content: accumulated };
      setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...(prev[contextKey] ?? []), assistantMsg] }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const assistantMsg: CoachMessage = { role: 'assistant', content: 'Coach unavailable — please try again.' };
        setHistoryCoachThreads((prev) => ({ ...prev, [contextKey]: [...(prev[contextKey] ?? []), assistantMsg] }));
      }
    } finally {
      setHistoryCoachStreaming(false);
      setHistoryCoachStreamText('');
    }
  };

  return (
    <aside className="hand-history-panel" aria-label="Hand history panel">
      <header className="hand-history-header">
        <div><p className="eyebrow">Hand History</p><h2>{historyView === 'session' ? 'This Session' : 'All Sessions'}</h2></div>
        <div className="history-view-toggle" role="group" aria-label="History view">
          <button type="button" className={historyView === 'session' ? 'active' : ''} onClick={() => { onHistoryViewChange('session'); setCoachContext('session'); }} aria-pressed={historyView === 'session'}>This Session</button>
          <button type="button" className={historyView === 'all' ? 'active' : ''} onClick={() => { onHistoryViewChange('all'); setCoachContext('session'); }} aria-pressed={historyView === 'all'}>All Sessions</button>
        </div>
        <button onClick={onClose} type="button" aria-label="Close hand history">Close</button>
      </header>
      <div className="hand-history-body">
        <div className="hand-history-content">
          <section className="session-stats" aria-labelledby="session-stats-title">
            <h3 id="session-stats-title">{historyView === 'session' ? 'Session Stats' : 'All-Time Stats'}</h3>
            <div className="stats-table" role="table" aria-label="Session statistics">
              <div className="stats-row stats-head" role="row"><span>Player</span><span>VPIP</span><span>PFR</span><span>Net</span></div>
              {stats.map((stat) => (
                <div className="stats-row" role="row" key={stat.playerId}>
                  <strong>{stat.displayName}</strong><span>{stat.VPIP}%</span><span>{stat.PFR}%</span><span className={stat.totalNetChips >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(stat.totalNetChips)}</span>
                </div>
              ))}
            </div>
            <details>
              <summary>Full Stats</summary>
              <div className="full-stats">
                {stats.map((stat) => (
                  <dl key={stat.playerId}>
                    <dt>{stat.displayName}</dt>
                    <dd>3Bet {stat.threebet}%</dd><dd>Fold 3Bet {stat.foldTo3bet}%</dd><dd>AF {stat.AF}</dd><dd>CBet {stat.CBet_flop}%</dd><dd>WTSD {stat.WTSD}%</dd><dd>WSD {stat.WSD}%</dd><dd>bb/100 {stat.bbPer100}</dd>
                  </dl>
                ))}
              </div>
            </details>
          </section>
          <section className="hand-list" aria-labelledby="hand-list-title">
            <h3 id="hand-list-title">Hand List</h3>
            {history.length === 0 ? <p className="muted">Completed hands will appear here.</p> : history.map((hand) => {
              const hero = hand.players.find((player) => player.isHero);
              const winnerNames = hand.pots.map((pot) => hand.players.find((player) => player.playerId === pot.winnerId)?.displayName ?? 'Unknown').join(', ');
              return (
                <button className={selected?.handId === hand.handId ? 'hand-list-item active' : 'hand-list-item'} key={hand.handId} onClick={() => { setSelectedHandId(hand.handId); setCoachContext('hand'); setFocusStreet(null); }} type="button">
                  <strong>#{hand.handNumber}</strong><span>{winnerNames} won</span>{hero && <em className={hero.netResult >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(hero.netResult)}</em>}
                </button>
              );
            })}
          </section>
          <section className="hand-detail" aria-labelledby="hand-detail-title">
            {!selected ? <div className="empty-state"><strong>No hands yet</strong><p>Play a hand to populate the append-only session log.</p></div> : (
              <>
                <h3 id="hand-detail-title">Hand #{selected.handNumber}</h3>
                <p className="position-line">{selected.players.map((player) => `${player.position}: ${player.displayName}`).join(' | ')}</p>
                <div className="player-snapshots">
                  {selected.players.map((player) => (
                    <div className="player-snapshot" key={player.playerId}>
                      <strong>{player.displayName}</strong><HistoryCards cards={player.holeCards} />
                      <span>Stack: {formatMoney(player.stackAtHandStart)} to {formatMoney(player.finalStack)}</span>
                      <em className={player.netResult >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(player.netResult)}</em>
                      {player.foldedStreet && <small>folded {player.foldedStreet}</small>}
                    </div>
                  ))}
                </div>
                {(['preflop', 'flop', 'turn', 'river'] as StreetKey[]).map((street) => {
                  const record = selected.streets[street];
                  if (!record) return null;
                  return (
                    <div className={`street-block${coachContext === 'street' && focusStreet === street ? ' street-block-active' : ''}`} key={street} onClick={() => { setCoachContext('street'); setFocusStreet(street); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setCoachContext('street'); setFocusStreet(street); } }} aria-label={`Focus coach on ${street}`}>
                      <h4>{streetTitle(street, selected)}<span className="street-coach-hint">Click to coach</span></h4>
                      {record.actions.length === 0 ? <p className="muted">No actions.</p> : record.actions.map((action, index) => (
                        <div className="history-action" key={`${street}-${action.playerId}-${index}`}>
                          <span>{action.position}</span><strong>{action.displayName}</strong><span>{action.actionType.replace('-', ' ')}</span>
                          <span>{action.amount ? formatMoney(action.amount) : ''}</span>
                          <em>{action.betSizingPct ? `${Math.round(action.betSizingPct * 100)}% pot` : ''}</em>
                          <small>Pot: {formatMoney(action.potAfter)}</small>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <div className="street-block result-block">
                  <h4>RESULT</h4>
                  {selected.pots.map((pot) => {
                    const winner = selected.players.find((player) => player.playerId === pot.winnerId);
                    const heroNet = selected.players.find((player) => player.playerId === heroId)?.netResult ?? 0;
                    return <p key={`${pot.label}-${pot.winnerId}`}>{winner?.displayName ?? pot.winnerId} wins {formatMoney(pot.amount)}{pot.winnerHandDescription ? ` (${pot.winnerHandDescription})` : ' without showdown'}. Net: <strong className={heroNet >= 0 ? 'net-positive' : 'net-negative'}>{signedMoney(heroNet)}</strong></p>;
                  })}
                </div>
              </>
            )}
          </section>
        </div>
        <div className="history-coach">
          <div className="history-coach-header">
            <span className="eyebrow">AI Coach</span>
            <span className="history-coach-context">
              {coachContext === 'street' && selected && focusStreet
                ? `Hand #${selected.handNumber} · ${focusStreet.toUpperCase()}`
                : coachContext === 'hand' && selected
                ? `Hand #${selected.handNumber}`
                : historyView === 'session' ? 'This Session' : 'All Sessions'}
            </span>
            <span className={`coach-status${historyCoachStreaming ? ' coach-status-thinking' : ''}`}>{historyCoachStreaming ? 'Thinking…' : 'Ready'}</span>
          </div>
          <div className="history-coach-messages" ref={historyCoachMessagesRef}>
            {coachMessages.length === 0 && !historyCoachStreaming && (
              <p className="history-coach-empty">
                {coachContext === 'street' && focusStreet ? `Ask about the ${focusStreet} — sizing, lines, alternatives.`
                : coachContext === 'hand' ? 'Ask about this hand — sizing, lines, mistakes.'
                : 'Ask about your overall play, leaks, and trends.'}
              </p>
            )}
            {coachMessages.map((msg, i) => (
              <div className={`coach-msg-${msg.role}`} key={i}>{msg.content}</div>
            ))}
            {historyCoachStreaming && historyCoachStreamText && (
              <div className="coach-msg-assistant">{historyCoachStreamText}<span className="coach-cursor">▌</span></div>
            )}
            {historyCoachStreaming && !historyCoachStreamText && (
              <div className="coach-msg-assistant coach-thinking">Thinking…</div>
            )}
          </div>
          <div className="coach-chips">
            {quickPrompts.map((prompt) => (
              <button className="coach-chip" disabled={historyCoachStreaming} key={prompt} onClick={() => sendHistoryCoachMessage(prompt)} type="button">{prompt}</button>
            ))}
          </div>
          <form className="coach-input-row" onSubmit={(e) => { e.preventDefault(); const msg = historyCoachInput.trim(); if (msg) { sendHistoryCoachMessage(msg); setHistoryCoachInput(''); } }}>
            <input
              className="coach-input"
              placeholder={coachContext === 'street' && focusStreet ? `Ask about the ${focusStreet}…` : coachContext === 'hand' ? 'Ask about this hand…' : 'Ask about your session…'}
              value={historyCoachInput}
              onChange={(e) => setHistoryCoachInput(e.target.value)}
              disabled={historyCoachStreaming}
            />
            <button className="coach-send" disabled={historyCoachStreaming || !historyCoachInput.trim()} type="submit">→</button>
          </form>
        </div>
      </div>
    </aside>
  );
}
