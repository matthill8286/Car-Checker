'use client';

import { defectHeatmap, type HeatmapCell } from '@carcheck/core';
import { useRef, useState } from 'react';
import type { Check } from '@/api/client';
import { ChartTooltip, type TooltipState } from './Tooltip';

type MotTest = NonNullable<Check['record']>['motTests'][number];

/** Count buckets mapped to five steps of the sequential ramp (validated as an ordinal ramp). */
const BUCKETS = [
  { min: 1, label: '1' },
  { min: 2, label: '2' },
  { min: 3, label: '3' },
  { min: 4, label: '4–5' },
  { min: 6, label: '6+' },
];

function bucket(count: number): number {
  let index = 0;
  BUCKETS.forEach((b, i) => {
    if (count >= b.min) index = i;
  });
  return index;
}

const TYPE_ORDER = ['dangerous', 'major', 'fail', 'minor', 'advisory', 'prs'] as const;

function describe(cell: HeatmapCell, label: string) {
  const parts = TYPE_ORDER.filter((t) => cell.byType[t]).map((t) => `${cell.byType[t]} ${t}`);
  return (
    <>
      <strong>
        {cell.count} {cell.count === 1 ? 'defect' : 'defects'}
      </strong>
      <span>
        {label}, {cell.year}
      </span>
      {parts.length > 0 && <span>{parts.join(', ')}</span>}
      <ul>
        {cell.defects.slice(0, 4).map((d, i) => (
          <li key={i}>{d}</li>
        ))}
        {cell.defects.length > 4 && <li>and {cell.defects.length - 4} more</li>}
      </ul>
    </>
  );
}

/** Defects per area per year, as a table whose cells are shaded by count. */
export function DefectHeatmap({ tests }: { tests: readonly MotTest[] }) {
  const map = defectHeatmap(tests as Parameters<typeof defectHeatmap>[0]);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);
  if (map.cells.length === 0) return null;

  const lookup = new Map(map.cells.map((c) => [`${c.category}:${c.year}`, c]));
  const show = (cell: HeatmapCell, label: string, el: HTMLElement) => {
    const box = wrap.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    setTip({
      x: r.left - box.left + r.width / 2,
      y: r.bottom - box.top + 4,
      content: describe(cell, label),
    });
  };

  return (
    <figure className="chart viz-root" aria-label="Defects by area and year">
      <div ref={wrap} className="chart-plot heatmap-wrap" onPointerLeave={() => setTip(null)}>
        <div className="heatmap-scroll">
          <table className="heatmap">
            <thead>
              <tr>
                <th scope="col" className="visually-hidden">
                  Area
                </th>
                {map.years.map((y) => (
                  <th key={y} scope="col">
                    {String(y).slice(2).padStart(3, "'")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.categories.map((c) => (
                <tr key={c.id}>
                  <th scope="row">{c.label}</th>
                  {map.years.map((y) => {
                    const cell = lookup.get(`${c.id}:${y}`);
                    if (!cell) return <td key={y} className="heat-empty" />;
                    const step = bucket(cell.count);
                    return (
                      <td key={y}>
                        <button
                          type="button"
                          className={`heat-cell heat-${step}${cell.dangerous ? ' heat-dangerous' : ''}`}
                          aria-label={`${c.label} ${y}: ${cell.count} defects${cell.dangerous ? `, ${cell.dangerous} dangerous` : ''}`}
                          onPointerEnter={(e) => show(cell, c.label, e.currentTarget)}
                          onFocus={(e) => show(cell, c.label, e.currentTarget)}
                          onBlur={() => setTip(null)}
                        >
                          {cell.count}
                          {cell.dangerous > 0 && <span aria-hidden="true">!</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ChartTooltip state={tip} width={wrap.current?.clientWidth ?? 600} />
      </div>
      <figcaption className="chart-legend">
        <span className="muted">Defects in a year:</span>
        {BUCKETS.map((b, i) => (
          <span key={b.label}>
            <span className={`heat-swatch heat-${i}`} aria-hidden="true" />
            {b.label}
          </span>
        ))}
        <span>
          <span className="heat-swatch heat-2 heat-dangerous" aria-hidden="true" />! includes a
          dangerous defect
        </span>
      </figcaption>
    </figure>
  );
}
