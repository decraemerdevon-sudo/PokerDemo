import { Card } from '../nlheEngine';

export const suitSymbols: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
export const suitClasses: Record<Card['suit'], string> = {
  spades: 'card-spade',
  hearts: 'card-heart',
  diamonds: 'card-diamond',
  clubs: 'card-club',
};

export function CardView({ card, hidden = false }: { card: Card; hidden?: boolean }) {
  return (
    <span className={`card ${hidden ? 'card-hidden' : suitClasses[card.suit]}`}>
      <span className="card-rank">{hidden ? '?' : card.rank}</span>
      <span aria-hidden="true" className="card-suit">{hidden ? '?' : suitSymbols[card.suit]}</span>
      <span className="sr-only">{hidden ? 'hidden card' : `${card.rank} of ${card.suit}`}</span>
    </span>
  );
}

export function HiddenCards() {
  return <span className="hidden-cards" aria-label="hidden hole cards">[? ?]</span>;
}

export function HistoryCards({ cards }: { cards: Card[] | null }) {
  if (!cards) return <HiddenCards />;
  return (
    <span className="history-cards">
      {cards.map((card, index) => <CardView key={`${card.rank}-${card.suit}-${index}`} card={card} />)}
    </span>
  );
}
