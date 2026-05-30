import { formatMoney } from '../utils/format';

export type ChipDenomination = {
  value: number;
  color: string;
  borderColor: string;
  label: string;
};

export type ChipStack = {
  denomination: ChipDenomination;
  count: number;
};

const CHIP_DENOMINATIONS: ChipDenomination[] = [
  { value: 1000, color: '#FFD700', borderColor: '#B8860B', label: '1K' },
  { value: 100, color: '#1a1a1a', borderColor: '#555555', label: '100' },
  { value: 25, color: '#228B22', borderColor: '#145214', label: '25' },
  { value: 5, color: '#CC0000', borderColor: '#8B0000', label: '5' },
  { value: 1, color: '#F5F5F5', borderColor: '#AAAAAA', label: '1' },
];

export function breakIntoChips(amount: number): ChipStack[] {
  let remaining = Math.max(0, Math.floor(amount));
  const stacks: ChipStack[] = [];
  CHIP_DENOMINATIONS.forEach((denomination) => {
    if (remaining <= 0) return;
    const count = Math.floor(remaining / denomination.value);
    if (count > 0) {
      stacks.push({ denomination, count });
      remaining -= count * denomination.value;
    }
  });
  if (remaining !== 0) console.warn(`Unable to render exact chip amount; ${remaining} remains.`);
  return stacks;
}

export function ChipStackView({ stack, size }: { stack: ChipStack; size: 'player' | 'pot' }) {
  const visibleCount = Math.min(stack.count, 10);
  const labelColor = stack.denomination.value === 1 || stack.denomination.value === 1000 ? '#17130c' : '#fffdf7';
  return (
    <div className="chip-stack" aria-label={`${stack.count} ${stack.denomination.label} chips`}>
      {stack.count > visibleCount && <span className="chip-count">x{stack.count}</span>}
      <div className={`chip-column chip-column-${size}`}>
        {Array.from({ length: visibleCount }, (_, index) => (
          <span
            aria-hidden="true"
            className="casino-chip"
            key={`${stack.denomination.value}-${index}`}
            style={{
              backgroundColor: stack.denomination.color,
              borderColor: stack.denomination.borderColor,
              color: labelColor,
              bottom: index * (size === 'player' ? 4 : 3),
              zIndex: index,
            }}
          >
            {index === visibleCount - 1 ? stack.denomination.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ChipStacksView({ amount, label, size = 'player' }: { amount: number; label?: string; size?: 'player' | 'pot' }) {
  const stacks = breakIntoChips(amount);
  if (!stacks.length) return null;
  return (
    <div className={`chip-display chip-display-${size}`} aria-label={`${label ? `${label}: ` : ''}${formatMoney(amount)} in chips`}>
      {label && <span className="chip-display-label">{label}</span>}
      <div className="chip-stacks">
        {stacks.map((stack) => <ChipStackView key={stack.denomination.value} stack={stack} size={size} />)}
      </div>
      <strong>{formatMoney(amount)}</strong>
    </div>
  );
}
