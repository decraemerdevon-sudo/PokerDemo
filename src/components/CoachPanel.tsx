import { useEffect, useRef, useState } from 'react';
import { Card, HandState, getLegalActions, potSize } from '../nlheEngine';

export type CoachMessage = { role: 'user' | 'assistant'; content: string };

const QUICK_PROMPTS = [
  "What's my best play?",
  "What are my pot odds?",
  "Am I ahead or behind?",
  "Analyse my range here",
  "Was that last action a mistake?",
];

const SUIT_CODES: Record<Card['suit'], string> = { spades: 's', hearts: 'h', diamonds: 'd', clubs: 'c' };

function buildGameStateForCoach(state: HandState) {
  const hero = state.seats.find((seat) => seat.isHero)!;
  const cardCode = (c: Card) => `${c.rank}${SUIT_CODES[c.suit]}`;
  return {
    street: state.street,
    handNumber: state.handNumber,
    board: state.board.map(cardCode),
    pot: potSize(state),
    heroCards: hero.cards.map(cardCode),
    heroRole: hero.role,
    heroStack: hero.stack,
    heroStreetContribution: hero.streetContribution,
    legalActions: getLegalActions(state, hero.id).map((a) => a.label),
    players: state.seats.map((s) => ({
      name: s.name,
      role: s.role,
      stack: s.stack,
      streetContribution: s.streetContribution,
      status: s.status,
      isHero: s.isHero,
      lastAction: s.lastAction,
    })),
    recentEvents: state.events.slice(-8).map((e) => `${e.actor} ${e.action}${e.amount ? ` $${e.amount}` : ''}`),
    bigBlind: state.bigBlind,
  };
}

export function CoachPanel({ state }: { state: HandState }) {
  const [coachMessages, setCoachMessages] = useState<CoachMessage[]>([]);
  const [coachStreaming, setCoachStreaming] = useState(false);
  const [coachStreamText, setCoachStreamText] = useState('');
  const [coachInput, setCoachInput] = useState('');
  const coachMessagesRef = useRef<HTMLDivElement | null>(null);
  const abortCoachRef = useRef<AbortController | null>(null);

  useEffect(() => {
    coachMessagesRef.current?.scrollTo({ top: coachMessagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [coachMessages, coachStreamText]);

  const sendCoachMessage = async (message: string) => {
    if (coachStreaming) return;
    abortCoachRef.current?.abort();
    abortCoachRef.current = new AbortController();
    setCoachStreaming(true);
    setCoachStreamText('');
    const historySnapshot = coachMessages.slice(-8);
    try {
      const resp = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameState: buildGameStateForCoach(state), userMessage: message, history: historySnapshot }),
        signal: abortCoachRef.current.signal,
      });
      if (!resp.ok || !resp.body) throw new Error('Coach request failed');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let assistantText = '';
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        finished = done;
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { finished = true; break; }
          try {
            const parsed = JSON.parse(data) as { text?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.text) { assistantText += parsed.text; setCoachStreamText(assistantText); }
          } catch { /* skip malformed chunk */ }
        }
      }
      if (assistantText) {
        setCoachMessages((prev) => [
          ...prev,
          { role: 'user', content: message },
          { role: 'assistant', content: assistantText },
        ]);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setCoachMessages((prev) => [
        ...prev,
        { role: 'user', content: message },
        { role: 'assistant', content: 'Coach unavailable — ensure ANTHROPIC_API_KEY is set in your Vercel environment.' },
      ]);
    } finally {
      setCoachStreaming(false);
      setCoachStreamText('');
    }
  };

  return (
    <section className="coach-panel" aria-labelledby="coach-title">
      <div className="panel-heading">
        <div><p className="eyebrow">AI Powered</p><h2 id="coach-title">Coach</h2></div>
        <span className={`coach-status${coachStreaming ? ' coach-status-thinking' : ''}`}>{coachStreaming ? 'Thinking…' : 'Ready'}</span>
      </div>
      <div className="coach-messages" ref={coachMessagesRef}>
        {coachMessages.length === 0 && !coachStreaming && (
          <p className="coach-empty">Tap a prompt or ask a question to get strategy advice.</p>
        )}
        {coachMessages.map((msg, i) => (
          <div key={i} className={`coach-msg coach-msg-${msg.role}`}>
            <p>{msg.content}</p>
          </div>
        ))}
        {coachStreaming && (
          <div className="coach-msg coach-msg-assistant coach-msg-streaming">
            <p>{coachStreamText || '…'}</p>
          </div>
        )}
      </div>
      <div className="coach-chips" aria-label="Quick prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button className="coach-chip" disabled={coachStreaming} key={prompt} onClick={() => sendCoachMessage(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>
      <form className="coach-input-row" onSubmit={(e) => { e.preventDefault(); const msg = coachInput.trim(); if (msg) { sendCoachMessage(msg); setCoachInput(''); } }}>
        <input
          aria-label="Ask your coach"
          className="coach-input"
          disabled={coachStreaming}
          onChange={(e) => setCoachInput(e.target.value)}
          placeholder="Ask your coach…"
          type="text"
          value={coachInput}
        />
        <button className="coach-send" disabled={coachStreaming || !coachInput.trim()} type="submit">→</button>
      </form>
    </section>
  );
}
