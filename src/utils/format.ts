import { Card } from '../nlheEngine';

export function formatMoney(value: number) {
  return `$${value.toLocaleString()}`;
}

export function signedMoney(value: number) {
  if (value === 0) return '$0';
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

export function cardText(cards: Card[]) {
  const suitLabels: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
  return cards.map((card) => `${card.rank}${suitLabels[card.suit]}`).join(' ');
}

export function texture(cards: Card[]) {
  if (cards.length < 3) return 'no board yet; preflop ranges and position dominate';
  const suitCounts = cards.reduce<Record<Card['suit'], number>>(
    (counts, card) => ({ ...counts, [card.suit]: counts[card.suit] + 1 }),
    { spades: 0, hearts: 0, diamonds: 0, clubs: 0 },
  );
  const paired = new Set(cards.map((card) => card.rank)).size < cards.length;
  const flushy = Object.values(suitCounts).some((count) => count >= 3);
  const broadway = cards.filter((card) => ['A', 'K', 'Q', 'J', '10'].includes(card.rank)).length >= 2;
  return `${paired ? 'paired' : 'unpaired'}, ${flushy ? 'flush-heavy' : 'rainbow/two-tone'}, ${broadway ? 'broadway-connected' : 'low-card'} texture`;
}

export function clampWholeChip(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
