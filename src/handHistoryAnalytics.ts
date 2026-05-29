import type { HandRecord } from './handHistory';

export type HandHistoryAnalyticsEvent = {
  id: string;
  handId: string;
  occurredAt: string;
  street: string;
  actor: string;
  action: string;
  amount?: number;
  note: string;
  source: 'initial-state' | 'hero-action' | 'bot-action' | 'street-change' | 'reset';
};

type TrackInput = Omit<HandHistoryAnalyticsEvent, 'id' | 'handId' | 'occurredAt'> & {
  handId?: string;
  occurredAt?: string;
};

const ANALYTICS_ENDPOINT = '';

// Persistent across browser sessions — identifies the player until auth is added.
export function getSessionId() {
  const key = 'poker-demo-session-id';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = window.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, next);
  return next;
}

// Fresh each app launch — used to make DB hand IDs globally unique.
// hand-1 from run A and hand-1 from run B must not collide in the DB.
function getRunId() {
  const key = 'poker-demo-run-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const next = window.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem(key, next);
  return next;
}

function createEvent(input: TrackInput): HandHistoryAnalyticsEvent {
  return {
    ...input,
    id: window.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    handId: input.handId ?? 'demo-hand',
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export function persistCompletedHand(record: HandRecord) {
  const sessionId = getSessionId();
  const dbHandId = `${getRunId()}:${record.handId}`;
  const payload = JSON.stringify({
    sessionId,
    hand: { ...record, handId: dbHandId },
  });
  void fetch('/api/hand-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // Persistence must never block gameplay.
  });
}

export function trackHandHistoryEvent(input: TrackInput) {
  const event = createEvent(input);
  if (!ANALYTICS_ENDPOINT) return event;

  const payload = {
    sessionId: getSessionId(),
    handId: event.handId,
    events: [event],
  };
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon && navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: 'application/json' }))) {
    return event;
  }

  void fetch(ANALYTICS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Analytics must never block gameplay.
  });

  return event;
}
