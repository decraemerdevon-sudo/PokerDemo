import Anthropic from '@anthropic-ai/sdk';

type VercelReq = { method?: string; body?: unknown };
type VercelRes = {
  status: (code: number) => VercelRes;
  json: (body: unknown) => void;
};

const client = new Anthropic();

const RANK_VAL: Record<string, number> = {
  A: 14, K: 13, Q: 12, J: 11, T: 10,
  '9': 9, '8': 8, '7': 7, '6': 6, '5': 5, '4': 4, '3': 3, '2': 2,
};

// Postflop action order (earlier index = acts first = OOP)
const ROLE_ORDER: Record<string, number> = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };

const STYLE_PERSONA: Record<string, string> = {
  'loose-aggressive':
    'STYLE: Loose-Aggressive (LAG) — widen all preflop ranges by ~8%, 3-bet liberally (add ATs, KJs, all suited aces, QJs), c-bet nearly every flop IP, fire second barrels with equity or blockers, apply constant pressure and build big pots.',
  'balanced':
    'STYLE: Balanced GTO — follow the preflop ranges and postflop frequencies in the guide precisely, mix bets and checks with strong hands to balance your range, use correct bet sizing, do not over-bluff or over-fold.',
  'pressure':
    'STYLE: Tight-Aggressive (TAG) — open only the top 70% of each range, 3-bet only QQ+/AKs (add JJ/AQs in position), never bluff without real equity, but play aggressively with value hands and semi-bluffs.',
};

const BASE_SYSTEM = `You are an expert 6-max No-Limit Texas Hold'em cash game player making a single action decision.

{PERSONA}

## PREFLOP STRATEGY (6-max, 100BB effective stacks)
Open-raise 2.5BB or fold — NEVER limp.
- UTG (~14%): 88+, AJs+, AQo+, KQs. Fold everything else.
- HJ (~20%): 66+, ATs+, AJo+, KJs+, KQo, QJs.
- CO (~28%): 44+, A8s+, ATo+, KTs+, KJo+, QTs+, JTs, T9s.
- BTN (~45%): 22+, A2s+, A8o+, K9s+, KTo+, Q9s+, QTo+, J9s+, T9s, 98s, 87s, 76s.
- SB (~35%): 22+, A4s+, A9o+, K9s+, KJo+, QTs+, JTs, J9s+, T9s, 98s. Raise or fold.
- BB: Defend wide vs late-position steals (call with pairs, suited connectors, Axs, broadway). 3-bet: QQ+, AKs; squeeze with JJ/AQs when squeeze opportunity exists.

Facing a raise:
- 3-bet: QQ+, AKs always; add JJ, AQs, KQs in position or as squeeze.
- Call IP: 22-JJ (below 3-bet range), AJs, AQo, KQs, JTs, T9s, 98s, 87s, suited aces.
- Fold OOP unless premium (QQ+, AKs) or in BB with a price to pay.

## POSTFLOP STRATEGY
SPR (stack-to-pot) — how committed you should be:
- SPR < 2: commit with any pair or better (top pair OK to go all-in)
- SPR 2-5: commit with TPTK+, two pair+, sets, strong combo draws
- SPR > 5: need two pair+ to commit; one pair is a bluff-catcher, do NOT over-invest

C-bet frequencies as the preflop aggressor:
- IP, dry board (rainbow, low cards, unpaired): bet 1/3 pot (near full range)
- IP, coordinated/wet board (flush draw, straight draws, high cards): bet 2/3 pot with value+strong draws, check weak/marginal
- OOP: check ~55% of range; only bet strong made hands, nut draws, or as protection
- Multiway (3+ players): check 70%+ — bluffing into multiple players is losing

Bet sizing:
- 1/3 pot: thin value, dry board c-bets, blocking bets on river
- 2/3 pot: standard value bet, balanced bluffs on wet boards
- Pot-size: polarised range (nuts or air), protect equity, force folds
- Do NOT min-bet — it gives opponents good odds and reveals weakness

Pot odds: if context shows "Pot odds X%", you need at least X% equity to call profitably.
- Flush draw: ~36% equity (2 cards left) / ~18% (1 card left)
- Open-ended straight draw: ~32% / ~16%
- Gutshot straight draw: ~16% / ~8%
- Two overcards: ~24% / ~12%
- Overcards + flush draw: ~54% / ~27%

## BLUFFING AND VALUE RULES
Bluff-to-value ratio: for a 2/3 pot bet you need ~40% bluffs; for pot-sized bet ~50%.
Good bluff spots: IP with equity (draws), blockers to the nuts, opponent shows weakness (checked twice).
Bad bluff spots: multiway, OOP without equity, vs calling stations, very low SPR.

Value betting: extract value from all made hands that are ahead of villain's calling range.
Thin value: bet 1/3 pot with weak top pairs, middle pairs that are likely best.

## KEY RULES
1. Never bluff into 2+ active players — check or fold.
2. Fold bottom pair and no-equity hands facing aggression, especially OOP.
3. Raise draws aggressively (semi-bluff) on the flop when you have 8+ outs.
4. River: only call if your hand beats villain's bluffs — fold if you cannot beat value.
5. Protect strong hands on wet boards; do NOT slow-play flushes/straights on draw boards.
6. Respect aggression — when a tight player raises, give them credit for a strong hand.

OUTPUT RULES:
Respond ONLY with valid JSON: {"kind":"fold"|"check"|"call"|"raise"|"bet","targetContribution":<number|null>}
- "raise" and "bet" require targetContribution = total chips committed this street AFTER the action (must be within min-max shown)
- "fold", "check", "call" must have targetContribution: null
- No explanation, no markdown, only the raw JSON object on one line`;

type SeatInfo = {
  id: string;
  name: string;
  role: string;
  stack: number;
  streetContribution: number;
  status: string;
  isHero: boolean;
  isBot: boolean;
  holeCards: string[] | null;
};

type LegalAction = {
  kind: string;
  label: string;
  targetContribution?: number;
  min?: number;
  max?: number;
};

type BotActionPayload = {
  street: string;
  handNumber: number;
  board: string[];
  pot: number;
  bigBlind: number;
  botStyle: string;
  botSeatId: string;
  seats: SeatInfo[];
  legalActions: LegalAction[];
  recentEvents: string[];
};

function parseBody(body: unknown): BotActionPayload | null {
  if (!body) return null;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as BotActionPayload; } catch { return null; }
  }
  return body as BotActionPayload;
}

function getPositionLabel(bot: SeatInfo, seats: SeatInfo[]): string {
  const active = seats.filter((s) => s.status !== 'out' && s.status !== 'folded');
  const botOrder = ROLE_ORDER[bot.role] ?? -1;
  const maxOrder = Math.max(...active.map((s) => ROLE_ORDER[s.role] ?? -1));
  return botOrder === maxOrder ? 'IP (last to act this street)' : 'OOP (acts before opponents)';
}

function getPreflopHandTier(cards: string[] | null): string {
  if (!cards || cards.length < 2) return '';
  const r1 = cards[0][0], r2 = cards[1][0];
  const s1 = cards[0][1], s2 = cards[1][1];
  const suited = s1 === s2;
  const v1 = RANK_VAL[r1] ?? 0, v2 = RANK_VAL[r2] ?? 0;
  const hi = Math.max(v1, v2), lo = Math.min(v1, v2);
  const isPair = r1 === r2;
  const gap = hi - lo;

  if (isPair) {
    if (hi >= 12) return 'PREMIUM pair (QQ+) — 3-bet/raise always';
    if (hi >= 10) return 'STRONG pair (TT-JJ) — raise, consider 3-bet IP';
    if (hi >= 7) return 'MEDIUM pair (77-99) — raise in position, set-mine';
    return 'SMALL pair (22-66) — raise LP only, set-mine, fold to 3-bets';
  }
  if (hi === 14) {
    if (lo === 13) return suited ? 'PREMIUM (AKs) — 3-bet always' : 'PREMIUM (AKo) — 3-bet always';
    if (lo === 12) return suited ? 'STRONG (AQs) — raise/3-bet' : 'STRONG (AQo) — raise, 3-bet IP';
    if (lo === 11) return suited ? 'STRONG (AJs) — raise/3-bet IP' : 'MEDIUM (AJo) — raise CO+';
    if (lo === 10) return suited ? 'MEDIUM (ATs) — raise CO+' : 'MARGINAL (ATo) — raise BTN/SB only';
    if (lo >= 7) return suited ? `PLAYABLE (A${lo}s) — raise LP, suited nut-flush blocker` : `WEAK (A${lo}o) — fold most positions`;
    return suited ? `SPECULATIVE (A${lo}s) — BTN/SB only` : `FOLD (A${lo}o) — too weak OOP`;
  }
  if (hi === 13) {
    if (lo === 12) return suited ? 'STRONG (KQs) — raise/3-bet IP' : 'STRONG (KQo) — raise, 3-bet squeeze';
    if (lo === 11) return suited ? 'MEDIUM (KJs) — raise CO+' : 'MARGINAL (KJo) — raise CO+';
    if (lo === 10) return suited ? 'PLAYABLE (KTs) — raise CO+' : 'MARGINAL (KTo) — BTN only';
    return suited ? `SPECULATIVE (K${lo}s) — BTN/SB` : `FOLD (K${lo}o)`;
  }
  if (suited && gap === 1) return hi >= 10 ? `STRONG suited connector (${r1}${r2}s) — raise all positions` : `PLAYABLE suited connector (${r1}${r2}s) — raise CO+`;
  if (suited && gap <= 2) return `PLAYABLE suited one-gapper (${r1}${r2}s) — BTN/CO`;
  if (suited) return `SPECULATIVE suited hand (${r1}${r2}s) — BTN/SB only for implied odds`;
  if (gap <= 1 && hi >= 11) return `MEDIUM broadway (${r1}${r2}o) — raise CO+`;
  return `WEAK offsuit (${r1}${r2}o) — fold most positions`;
}

function getPotOdds(bot: SeatInfo, legalActions: LegalAction[], pot: number): string {
  const callAction = legalActions.find((a) => a.kind === 'call');
  if (!callAction || callAction.targetContribution == null) return '';
  const callAmount = callAction.targetContribution - bot.streetContribution;
  if (callAmount <= 0) return '';
  const pct = Math.round((callAmount / (pot + callAmount)) * 100);
  return `Pot odds: ${pct}% — need at least ${pct}% equity to call profitably`;
}

function getBoardTexture(board: string[]): string {
  if (board.length < 3) return '';
  const suits = board.slice(0, 3).map((c) => c[1]);
  const suitCounts: Record<string, number> = {};
  for (const s of suits) suitCounts[s] = (suitCounts[s] ?? 0) + 1;
  const maxSuit = Math.max(...Object.values(suitCounts));

  const vals = board.map((c) => RANK_VAL[c[0]] ?? 0).sort((a, b) => b - a);
  const spread = vals[0] - vals[Math.min(2, vals.length - 1)];

  const parts: string[] = [];
  if (maxSuit === 3) parts.push('MONOTONE — flush possible now');
  else if (maxSuit === 2) parts.push('flush draw present');

  if (spread <= 4) parts.push('CONNECTED — straight draws possible');
  else if (spread <= 6) parts.push('semi-connected');
  else parts.push('RAINBOW/DRY — few draws');

  const highCard = vals[0];
  if (highCard >= 13) parts.push('broadway high (K/A — hits preflop raiser range)');
  else if (highCard >= 10) parts.push('high-card board (T-Q)');
  else parts.push('low-card board (9 and under — hits caller/BB range)');

  return `Board texture: ${parts.join(', ')}`;
}

function buildContext(p: BotActionPayload): string {
  const bot = p.seats.find((s) => s.id === p.botSeatId)!;
  const spr = bot.stack > 0 && p.pot > 0 ? (bot.stack / p.pot).toFixed(1) : '∞';
  const posLabel = p.street !== 'preflop' ? getPositionLabel(bot, p.seats) : '';
  const handTier = p.street === 'preflop' ? getPreflopHandTier(bot.holeCards) : '';
  const potOdds = getPotOdds(bot, p.legalActions, p.pot);
  const boardTexture = getBoardTexture(p.board);
  const activePlayers = p.seats.filter((s) => s.status !== 'out' && s.status !== 'folded').length;

  const lines: string[] = [
    `=== HAND #${p.handNumber} | ${p.street.toUpperCase()} | Blinds $${p.bigBlind / 2}/$${p.bigBlind} ===`,
    `Board: ${p.board.length ? p.board.join(' ') : '(preflop)'} | Pot: $${p.pot} | Active players: ${activePlayers}`,
  ];
  if (boardTexture) lines.push(boardTexture);
  lines.push('');
  const youLine = `YOU [${bot.role}]${posLabel ? ` ${posLabel}` : ''}: ${bot.holeCards?.join(' ') ?? '??'} | Stack $${bot.stack} | Committed this street $${bot.streetContribution} | SPR ${spr}`;
  lines.push(youLine);
  if (handTier) lines.push(`Preflop hand tier: ${handTier}`);
  if (potOdds) lines.push(potOdds);
  lines.push('');
  lines.push('TABLE (active seats):');
  lines.push(...p.seats
    .filter((s) => s.status !== 'out')
    .map((s) => `  ${s.id === bot.id ? '→ YOU' : s.name} [${s.role}]: ${s.status} | stack $${s.stack} | committed $${s.streetContribution}${s.holeCards ? ` | cards ${s.holeCards.join(' ')}` : ''}`)
  );
  lines.push('');
  lines.push('RECENT ACTION:');
  lines.push(...p.recentEvents.slice(-6).map((e) => `  ${e}`));
  lines.push('');
  lines.push('YOUR LEGAL OPTIONS:');
  lines.push(...p.legalActions.map((a) => {
    const range = (a.min != null && a.max != null) ? ` (min $${a.min}, max $${a.max})` : '';
    return `  ${a.kind}: ${a.label}${range}`;
  }));

  return lines.join('\n');
}

// Forcing tool use guarantees the model returns schema-valid JSON in the
// tool_use input block — no fragile text/markdown parsing of free-form output,
// which was silently failing and dropping every bot onto the fallback.
const ACTION_TOOL = {
  name: 'submit_action',
  description: 'Submit your poker action decision for this spot.',
  input_schema: {
    type: 'object' as const,
    properties: {
      kind: {
        type: 'string',
        enum: ['fold', 'check', 'call', 'raise', 'bet'],
        description: 'The action to take. Must be one of the legal options shown.',
      },
      targetContribution: {
        type: ['number', 'null'],
        description: 'For "raise"/"bet": total chips committed this street after acting (within the shown min-max). For "fold"/"check"/"call": null.',
      },
    },
    required: ['kind'],
  },
};

export default async function handler(req: VercelReq, res: VercelRes) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload?.botSeatId || !payload?.legalActions?.length) {
    res.status(400).json({ error: 'missing_fields' });
    return;
  }

  const persona = STYLE_PERSONA[payload.botStyle] ?? STYLE_PERSONA['balanced'];
  const system = BASE_SYSTEM.replace('{PERSONA}', persona);
  const context = buildContext(payload);

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system,
      tools: [ACTION_TOOL],
      tool_choice: { type: 'tool', name: 'submit_action' },
      messages: [{ role: 'user', content: context }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('no tool_use block in response');
    }
    const decision = toolUse.input as { kind: string; targetContribution?: number | null };

    const validKinds = new Set(payload.legalActions.map((a) => a.kind));
    if (!validKinds.has(decision.kind)) {
      throw new Error(`model chose illegal action "${decision.kind}"`);
    }

    // Clamp raise/bet targetContribution to the legal range
    let targetContribution = decision.targetContribution ?? undefined;
    if ((decision.kind === 'raise' || decision.kind === 'bet') && targetContribution != null) {
      const action = payload.legalActions.find((a) => a.kind === decision.kind);
      if (action?.min != null && action?.max != null) {
        targetContribution = Math.max(action.min, Math.min(action.max, targetContribution));
      }
    }

    res.status(200).json({ kind: decision.kind, targetContribution: targetContribution ?? null });
  } catch (err) {
    // Surface the real cause in Vercel logs instead of swallowing it, and
    // signal failure with 502 so the client falls back to the local engine's
    // chooseBotAction (varied strategy) rather than a degenerate call/fold.
    console.error('[bot-action] decision failed:', err);
    res.status(502).json({ error: 'bot_decision_failed' });
  }
}
