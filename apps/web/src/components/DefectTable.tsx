'use client';

import { DEFECT_CATEGORIES, type DefectCategory } from '@carcheck/core';
import { useMemo, useState } from 'react';
import type { Check } from '@/api/client';
import {
  defectRows,
  queryDefects,
  SEVERITIES,
  type DefectQuery,
  type Severity,
  type SortKey,
} from './defectRows';
import { formatDate } from './format';

type MotTest = NonNullable<Check['record']>['motTests'][number];

const COLUMNS: Array<{ key: SortKey | null; label: string }> = [
  { key: 'date', label: 'Test date' },
  { key: 'severity', label: 'Severity' },
  { key: 'category', label: 'Area' },
  { key: null, label: 'Defect' },
];

/** Every defect from every test, filterable by severity, area and wording, sortable by column. */
export function DefectTable({ tests }: { tests: readonly MotTest[] }) {
  const rows = useMemo(() => defectRows(tests), [tests]);
  const [q, setQ] = useState<DefectQuery>({
    severity: 'all',
    category: 'all',
    text: '',
    sort: 'date',
    descending: true,
  });
  const shown = useMemo(() => queryDefects(rows, q), [rows, q]);
  if (rows.length === 0) return null;

  const present = new Set(rows.map((r) => r.category));
  const severitiesPresent = new Set(rows.map((r) => r.severity));

  const sortBy = (key: SortKey) =>
    setQ((cur) => ({
      ...cur,
      sort: key,
      // A new column starts with the order people expect: newest, worst, then manual order.
      descending: cur.sort === key ? !cur.descending : key === 'date',
    }));

  return (
    <div className="defect-table">
      <div className="defect-filters" role="group" aria-label="Filter defects">
        <label>
          Severity
          <select
            value={q.severity}
            onChange={(e) => setQ({ ...q, severity: e.target.value as Severity | 'all' })}
          >
            <option value="all">All</option>
            {SEVERITIES.filter((s) => severitiesPresent.has(s.id)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Area
          <select
            value={q.category}
            onChange={(e) => setQ({ ...q, category: e.target.value as DefectCategory | 'all' })}
          >
            <option value="all">All</option>
            {DEFECT_CATEGORIES.filter((c) => present.has(c.id)).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="defect-search">
          Contains
          <input
            type="search"
            value={q.text}
            placeholder="e.g. corrosion"
            onChange={(e) => setQ({ ...q, text: e.target.value })}
          />
        </label>
      </div>
      <p className="muted defect-count" aria-live="polite">
        Showing {shown.length} of {rows.length} defects
      </p>
      <div className="defect-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.label}
                  scope="col"
                  aria-sort={
                    c.key && q.sort === c.key
                      ? q.descending
                        ? 'descending'
                        : 'ascending'
                      : undefined
                  }
                >
                  {c.key ? (
                    <button type="button" className="sort" onClick={() => sortBy(c.key!)}>
                      {c.label}
                      <span aria-hidden="true">
                        {q.sort === c.key ? (q.descending ? ' ▾' : ' ▴') : ''}
                      </span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td className="nowrap">{formatDate(r.date)}</td>
                <td className="nowrap">
                  <span className={`severity severity-${r.severity}`}>
                    {r.severity === 'dangerous' && <span aria-hidden="true">! </span>}
                    {SEVERITIES.find((s) => s.id === r.severity)?.label ?? r.severity}
                  </span>
                </td>
                <td>{r.categoryLabel}</td>
                <td>{r.text}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No defects match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
