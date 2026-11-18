'use client';

import { useState } from 'react';
import type { Check } from '@/api/client';
import { formatDate, formatNumber } from './format';
import { ChartTooltip, type TooltipState } from './Tooltip';
import { useWidth } from './useWidth';

type MotTest = NonNullable<Check['record']>['motTests'][number];

const DAY = 24 * 60 * 60 * 1000;
const PAD_X = 12;
const FAIL_Y = 18;
const PASS_Y = 42;
const BAR_Y = 60;
const AXIS_Y = 84;
const HEIGHT = 100;

interface Lapse {
  from: string;
  to: string;
  days: number;
}

/** Periods between one certificate expiring and the next pass. */
export function findLapses(tests: readonly MotTest[]): Lapse[] {
  const passes = tests
    .filter((t) => t.result === 'passed' && t.expiryDate)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const lapses: Lapse[] = [];
  for (let i = 1; i < passes.length; i++) {
    const expiry = passes[i - 1]!.expiryDate!;
    const next = passes[i]!.completedAt.slice(0, 10);
    const days = Math.round((Date.parse(next) - Date.parse(expiry)) / DAY);
    if (days > 0) lapses.push({ from: expiry, to: next, days });
  }
  return lapses;
}

function describe(test: MotTest) {
  const counts = test.defects.reduce<Record<string, number>>((acc, d) => {
    const key = d.dangerous ? 'dangerous' : d.type;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <>
      <strong>{test.result === 'passed' ? 'Pass' : 'Fail'}</strong>
      <span>{formatDate(test.completedAt)}</span>
      <span>
        {test.odometer
          ? formatNumber(test.odometer.value, test.odometer.unit)
          : 'Odometer not read'}
      </span>
      {Object.keys(counts).length > 0 && (
        <span>
          {Object.entries(counts)
            .map(([type, n]) => `${n} ${type.replace('_', ' ')}`)
            .join(', ')}
        </span>
      )}
    </>
  );
}

/** Each MOT test on a time axis, with the period each pass covered underneath. */
export function MotTimeline({ tests }: { tests: readonly MotTest[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<TooltipState | null>(null);
  if (tests.length === 0) return null;

  const times = tests.flatMap((t) => [
    Date.parse(t.completedAt),
    ...(t.expiryDate ? [Date.parse(t.expiryDate)] : []),
  ]);
  const start = Math.min(...times) - 30 * DAY;
  const end = Math.max(...times) + 30 * DAY;
  const x = (t: number) => PAD_X + ((t - start) / (end - start)) * (width - 2 * PAD_X);

  const firstYear = new Date(start).getUTCFullYear() + 1;
  const lastYear = new Date(end).getUTCFullYear();
  const years: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);
  const labelEvery = Math.max(1, Math.ceil((years.length * 44) / Math.max(width, 1)));

  const lapses = findLapses(tests);
  const show = (test: MotTest, cx: number, cy: number) =>
    setTip({ x: cx, y: cy + 12, content: describe(test) });

  return (
    <figure className="chart viz-root" aria-label="MOT tests over time">
      <div ref={ref} className="chart-plot" onPointerLeave={() => setTip(null)}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`${tests.length} MOT tests`}>
          {years.map((y, i) => {
            const gx = x(Date.UTC(y, 0, 1));
            return (
              <g key={y}>
                <line x1={gx} x2={gx} y1={8} y2={AXIS_Y - 12} stroke="var(--grid)" />
                {i % labelEvery === 0 && (
                  <text x={gx} y={AXIS_Y} textAnchor="middle" className="chart-tick">
                    {y}
                  </text>
                )}
              </g>
            );
          })}
          {tests
            .filter((t) => t.result === 'passed' && t.expiryDate)
            .map((t) => {
              const x1 = x(Date.parse(t.completedAt));
              const x2 = x(Date.parse(t.expiryDate!));
              return (
                <rect
                  key={`bar-${t.testNumber ?? t.completedAt}`}
                  x={x1 + 1}
                  y={BAR_Y}
                  width={Math.max(2, x2 - x1 - 2)}
                  height={6}
                  rx={3}
                  fill="var(--series-1)"
                  opacity={0.55}
                />
              );
            })}
          {lapses.map((l) => {
            const x1 = x(Date.parse(l.from));
            const x2 = x(Date.parse(l.to));
            return (
              <rect
                key={`lapse-${l.from}`}
                x={x1}
                y={BAR_Y - 2}
                width={Math.max(3, x2 - x1)}
                height={10}
                rx={2}
                fill="var(--status-critical)"
              />
            );
          })}
          {tests.map((t) => {
            const cx = x(Date.parse(t.completedAt));
            const passed = t.result === 'passed';
            const cy = passed ? PASS_Y : FAIL_Y;
            const key = t.testNumber ?? t.completedAt;
            return (
              <g
                key={key}
                tabIndex={0}
                role="button"
                aria-label={`${passed ? 'Pass' : 'Fail'} on ${formatDate(t.completedAt)}`}
                onPointerEnter={() => show(t, cx, cy)}
                onFocus={() => show(t, cx, cy)}
                onBlur={() => setTip(null)}
                className="chart-mark"
              >
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
                {passed ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={6}
                    fill="var(--status-good)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ) : (
                  <rect
                    x={cx - 5.5}
                    y={cy - 5.5}
                    width={11}
                    height={11}
                    rx={1.5}
                    transform={`rotate(45 ${cx} ${cy})`}
                    fill="var(--status-critical)"
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                )}
              </g>
            );
          })}
        </svg>
        <ChartTooltip state={tip} width={width} />
      </div>
      <figcaption className="chart-legend">
        <span>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill="var(--status-good)" />
          </svg>
          Pass
        </span>
        <span>
          <svg width="12" height="12" aria-hidden="true">
            <rect
              x="2"
              y="2"
              width="8"
              height="8"
              transform="rotate(45 6 6)"
              fill="var(--status-critical)"
            />
          </svg>
          Fail
        </span>
        <span>
          <svg width="18" height="12" aria-hidden="true">
            <rect x="0" y="3" width="18" height="6" rx="3" fill="var(--series-1)" opacity="0.55" />
          </svg>
          MOT valid
        </span>
        {lapses.length > 0 && (
          <span>
            <svg width="18" height="12" aria-hidden="true">
              <rect x="0" y="1" width="18" height="10" rx="2" fill="var(--status-critical)" />
            </svg>
            No valid MOT
          </span>
        )}
      </figcaption>
      {lapses.map((l) => (
        <p key={l.from} className="warning">
          ⚠ No valid MOT for {l.days} {l.days === 1 ? 'day' : 'days'}, {formatDate(l.from)} to{' '}
          {formatDate(l.to)}.
        </p>
      ))}
    </figure>
  );
}
