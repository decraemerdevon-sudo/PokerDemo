type HandHistoryEvent = {
  id?: string;
  handId?: string;
  occurredAt?: string;
  street?: string;
  actor?: string;
  action?: string;
  amount?: number;
  note?: string;
  source?: string;
};

type HandHistoryPayload = {
  sessionId?: string;
  handId?: string;
  events?: HandHistoryEvent[];
};

type VercelRequest = {
  method?: string;
  body?: unknown;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

function parsePayload(body: unknown): HandHistoryPayload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as HandHistoryPayload;
    } catch {
      return null;
    }
  }
  return body as HandHistoryPayload;
}

export default function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parsePayload(request.body);
  const events = Array.isArray(payload?.events) ? payload.events : [];

  if (!payload?.sessionId || events.length === 0) {
    response.status(400).json({ error: 'invalid_hand_history_payload' });
    return;
  }

  // Foundation endpoint only: Vercel accepts the contract now; durable storage can be attached later.
  response.status(202).json({
    accepted: true,
    sessionId: payload.sessionId,
    handId: payload.handId ?? null,
    eventCount: events.length,
  });
}
