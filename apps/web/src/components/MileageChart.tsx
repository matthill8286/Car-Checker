'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type DotProps,
  type TooltipContentProps,
} from 'recharts';
import type { Check } from '@/api/client';
import { formatDate, formatNumber } from './format';

type Mileage = NonNullable<Check['record']>['mileage'];

interface Point {
  t: number;
  date: string;
  value: number;
  unit: string;
  /** Set on a reading lower than the one before it. */
  drop: number | null;
}

function toPoints(mileage: Mileage): Point[] {
  const drops = new Map(
    mileage.anomalies
      .filter((a) => a.kind === 'decrease')
      .map((a) => [a.to.date, a.from.odometer.value - a.to.odometer.value]),
  );
  return mileage.readings.map((r) => ({
    t: Date.parse(r.date),
    date: r.date,
    value: r.odometer.value,
    unit: r.odometer.unit,
    drop: drops.get(r.date) ?? null,
  }));
}

function Dot(props: DotProps & { payload?: Point }) {
  const { cx, cy, payload } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  if (payload.drop !== null) {
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={6}
          fill="var(--status-critical)"
          stroke="var(--surface)"
          strokeWidth={2}
        />
        <text x={cx} y={cy - 12} textAnchor="middle" className="chart-annotation">
          −{formatNumber(payload.drop, payload.unit)}
        </text>
      </g>
    );
  }
  return (
    <circle cx={cx} cy={cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
  );
}

function ReadingTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const point = payload?.[0]?.payload as Point | undefined;
  if (!active || !point) return null;
  return (
    <div className="chart-tooltip static">
      <strong>{formatNumber(point.value, point.unit)}</strong>
      <span>{formatDate(point.date)}</span>
      {point.drop !== null && (
        <span className="tooltip-warning">
          ⚠ {formatNumber(point.drop, point.unit)} lower than the test before
        </span>
      )}
    </div>
  );
}

const yearFmt = new Intl.DateTimeFormat('en-GB', { year: 'numeric' });

/** Odometer readings over time, one series. A reading that goes backwards is marked in red. */
export function MileageChart({ mileage }: { mileage: Mileage }) {
  const points = toPoints(mileage);
  if (points.length < 2) return null;
  const unit = points[0]?.unit ?? 'mi';
  // One tick per 1 January inside the range, so the axis reads as whole years.
  const firstYear = new Date(points[0]!.t).getUTCFullYear() + 1;
  const lastYear = new Date(points.at(-1)!.t).getUTCFullYear();
  const ticks: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) ticks.push(Date.UTC(y, 0, 1));
  return (
    <figure className="chart viz-root" aria-label={`Odometer readings in ${unit}`}>
      <div className="chart-plot" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 24, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={ticks}
              tickFormatter={(t: number) => yearFmt.format(t)}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              minTickGap={16}
            />
            <YAxis
              tickFormatter={(v: number) => (v === 0 ? '0' : `${Math.round(v / 1000)}k`)}
              tick={{ fill: 'var(--muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip
              content={<ReadingTooltip />}
              cursor={{ stroke: 'var(--muted)', strokeDasharray: '3 3' }}
            />
            <Line
              type="linear"
              dataKey="value"
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={<Dot />}
              activeDot={{
                r: 6,
                fill: 'var(--series-1)',
                stroke: 'var(--surface)',
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="table-view">
        <summary>Show readings as a table</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Odometer</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date}>
                <td>{formatDate(p.date)}</td>
                <td>
                  {formatNumber(p.value, p.unit)}
                  {p.drop !== null && ' ⚠ lower than before'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
