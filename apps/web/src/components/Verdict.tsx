import type { VehicleSummary } from '@/api/client';

const LABEL = {
  avoid: { text: 'Serious concerns', icon: '✕', tone: 'critical' },
  caution: { text: 'Things to check', icon: '!', tone: 'warning' },
  good: { text: 'Looks clean', icon: '✓', tone: 'good' },
  unknown: { text: 'Not enough data', icon: 'i', tone: 'info' },
} as const;

/** A compact verdict: icon, word and colour together. */
export function VerdictBadge({ rating }: { rating: VehicleSummary['verdict'] }) {
  if (!rating) return <span className="muted">No verdict</span>;
  const l = LABEL[rating];
  return (
    <span className={`verdict-badge verdict-${l.tone}`}>
      <span className="insight-mark" aria-hidden="true">
        {l.icon}
      </span>
      {l.text}
    </span>
  );
}
