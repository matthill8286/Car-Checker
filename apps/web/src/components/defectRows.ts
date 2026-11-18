import { categoriseDefect, DEFECT_CATEGORIES, type DefectCategory } from '@carcheck/core';
import type { Check } from '@/api/client';

type MotTest = NonNullable<Check['record']>['motTests'][number];

export type Severity = 'dangerous' | 'major' | 'minor' | 'advisory' | 'other';

export const SEVERITIES: ReadonlyArray<{ id: Severity; label: string; rank: number }> = [
  { id: 'dangerous', label: 'Dangerous', rank: 0 },
  { id: 'major', label: 'Major or fail', rank: 1 },
  { id: 'minor', label: 'Minor', rank: 2 },
  { id: 'advisory', label: 'Advisory', rank: 3 },
  { id: 'other', label: 'Other', rank: 4 },
];

export interface DefectRow {
  key: string;
  date: string;
  testResult: 'passed' | 'failed';
  severity: Severity;
  category: DefectCategory;
  categoryLabel: string;
  text: string;
}

export type SortKey = 'date' | 'severity' | 'category';
export interface DefectQuery {
  severity: Severity | 'all';
  category: DefectCategory | 'all';
  text: string;
  sort: SortKey;
  descending: boolean;
}

const CATEGORY_LABEL = new Map(DEFECT_CATEGORIES.map((c) => [c.id as DefectCategory, c.label]));
const CATEGORY_ORDER = new Map(DEFECT_CATEGORIES.map((c, i) => [c.id as DefectCategory, i]));
const SEVERITY_RANK = new Map(SEVERITIES.map((s) => [s.id, s.rank]));

function severityOf(type: string, dangerous: boolean): Severity {
  if (dangerous || type === 'dangerous') return 'dangerous';
  if (type === 'major' || type === 'fail') return 'major';
  if (type === 'minor') return 'minor';
  if (type === 'advisory') return 'advisory';
  return 'other';
}

/** One row per defect across every test. */
export function defectRows(tests: readonly MotTest[]): DefectRow[] {
  return tests.flatMap((t) =>
    t.defects.map((d, i) => {
      const category = categoriseDefect(d.text);
      return {
        key: `${t.testNumber ?? t.completedAt}-${i}`,
        date: t.completedAt,
        testResult: t.result,
        severity: severityOf(d.type, d.dangerous),
        category,
        categoryLabel: CATEGORY_LABEL.get(category) ?? category,
        text: d.text,
      };
    }),
  );
}

/** Filters and sorts rows. Ties fall back to newest first so the order is stable. */
export function queryDefects(rows: readonly DefectRow[], q: DefectQuery): DefectRow[] {
  const needle = q.text.trim().toLowerCase();
  const filtered = rows.filter(
    (r) =>
      (q.severity === 'all' || r.severity === q.severity) &&
      (q.category === 'all' || r.category === q.category) &&
      (needle === '' || r.text.toLowerCase().includes(needle)),
  );
  const dir = q.descending ? -1 : 1;
  const byDate = (a: DefectRow, b: DefectRow) => b.date.localeCompare(a.date);
  return filtered.sort((a, b) => {
    const c =
      q.sort === 'date'
        ? a.date.localeCompare(b.date)
        : q.sort === 'severity'
          ? (SEVERITY_RANK.get(a.severity) ?? 9) - (SEVERITY_RANK.get(b.severity) ?? 9)
          : (CATEGORY_ORDER.get(a.category) ?? 99) - (CATEGORY_ORDER.get(b.category) ?? 99);
    return c * dir || byDate(a, b);
  });
}
