'use client';

import type { ManualReport } from '@/api/client';
import { formatDate } from './format';
import { keeperEvents, type KeeperEventKind } from './keeperEvents';
import { useWidth } from './useWidth';

const PAD_X = 14;
const BAND_Y = 26;
const BAND_H = 22;
const MARK_Y = 12;
const AXIS_Y = 70;
const HEIGHT = 80;

function parse(date: string): number {
  return Date.parse(/^\d{4}-\d{2}$/.test(date) ? `${date}-01` : date);
}

function Mark({ kind, x }: { kind: KeeperEventKind; x: number }) {
  switch (kind) {
    case 'keeper':
      return <circle cx={x} cy={MARK_Y} r={5} fill="var(--series-1)" />;
    case 'plate':
      return <rect x={x - 4.5} y={MARK_Y - 4.5} width={9} height={9} fill="var(--text)" />;
    case 'write_off':
      return (
        <path
          d={`M${x} ${MARK_Y - 6}L${x + 6} ${MARK_Y}L${x} ${MARK_Y + 6}L${x - 6} ${MARK_Y}Z`}
          fill="var(--status-critical)"
        />
      );
    default:
      return (
        <path
          d={`M${x - 5} ${MARK_Y - 5}L${x + 5} ${MARK_Y}L${x - 5} ${MARK_Y + 5}Z`}
          fill="var(--muted)"
        />
      );
  }
}

const LEGEND: Array<{ kind: KeeperEventKind; label: string }> = [
  { kind: 'registered', label: 'First registered' },
  { kind: 'keeper', label: 'New keeper' },
  { kind: 'plate', label: 'Plate change' },
  { kind: 'write_off', label: 'Write-off' },
];

/** Ownership over time: one band per keeper, with plate changes and any write-off marked. */
export function KeeperTimeline({
  reports,
  firstRegistration,
  today = new Date().toISOString().slice(0, 10),
}: {
  reports: readonly ManualReport[];
  firstRegistration: string | undefined;
  today?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { events, periods } = keeperEvents(reports, firstRegistration);
  if (events.filter((e) => e.kind !== 'registered').length === 0) return null;

  const start = parse(events[0]!.date);
  const end = Math.max(parse(today), parse(events.at(-1)!.date));
  const span = Math.max(end - start, 1);
  const x = (t: number) => PAD_X + ((t - start) / span) * (width - 2 * PAD_X);
  const years: number[] = [];
  for (let y = new Date(start).getUTCFullYear() + 1; y <= new Date(end).getUTCFullYear(); y++)
    years.push(y);
  const every = Math.max(1, Math.ceil((years.length * 44) / Math.max(width, 1)));
  const kinds = new Set(events.map((e) => e.kind));

  return (
    <figure className="chart viz-root keeper-timeline">
      <div ref={ref} className="chart-plot">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Ownership timeline, ${events.length} events`}
        >
          {periods.map((p) => {
            const x1 = x(parse(p.from));
            const x2 = x(p.to ? parse(p.to) : end);
            const w = Math.max(2, x2 - x1 - 2);
            return (
              <g key={p.n}>
                <rect
                  x={x1 + 1}
                  y={BAND_Y}
                  width={w}
                  height={BAND_H}
                  rx={4}
                  fill="var(--series-1)"
                  opacity={p.n % 2 ? 0.28 : 0.5}
                />
                {w > 34 && (
                  <text x={x1 + 6} y={BAND_Y + 15} className="chart-tick keeper-label">
                    {w > 70 ? `Keeper ${p.n}` : p.n}
                  </text>
                )}
              </g>
            );
          })}
          {years.map((y, i) => {
            const gx = x(Date.UTC(y, 0, 1));
            return (
              i % every === 0 && (
                <text key={y} x={gx} y={AXIS_Y} textAnchor="middle" className="chart-tick">
                  {y}
                </text>
              )
            );
          })}
          {events.map((e) => (
            <g key={`${e.kind}-${e.date}-${e.label}`}>
              <title>{`${e.label}, ${formatDate(e.date)}`}</title>
              <Mark kind={e.kind} x={x(parse(e.date))} />
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="chart-legend">
        {LEGEND.filter((l) => kinds.has(l.kind)).map((l) => (
          <span key={l.kind}>
            <svg width="12" height="12" viewBox={`-6 ${MARK_Y - 6} 12 12`} aria-hidden="true">
              <Mark kind={l.kind} x={0} />
            </svg>
            {l.label}
          </span>
        ))}
      </figcaption>
      <ol className="keeper-events">
        {events.map((e) => (
          <li key={`${e.kind}-${e.date}-${e.label}`}>
            <span className="muted">{formatDate(e.date)}</span> {e.label}
          </li>
        ))}
      </ol>
    </figure>
  );
}
