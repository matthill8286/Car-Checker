import type { MotLapse, RepeatAdvisory } from '../schemas/insights.js';
import type { MotTest } from '../schemas/vehicle.js';
import { categoriseDefect } from './defects.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Periods with no valid MOT: from one pass's expiry to the next pass. A failed test in between
 * does not count as cover. Driving in a lapse is illegal (and usually uninsured), so a long one
 * says something about how the car was kept.
 */
export function findLapses(tests: readonly MotTest[]): MotLapse[] {
  const passes = tests
    .filter((t) => t.result === 'passed' && t.expiryDate)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  const lapses: MotLapse[] = [];
  for (let i = 1; i < passes.length; i++) {
    const expiry = passes[i - 1]!.expiryDate!;
    const next = passes[i]!.completedAt.slice(0, 10);
    const days = Math.round((Date.parse(next) - Date.parse(expiry)) / DAY_MS);
    if (days > 0) lapses.push({ from: expiry, to: next, days });
  }
  return lapses;
}

const POSITION =
  /\b(nearside|offside|n\/s|o\/s|front|rear|inner|outer|left|right|centre|upper|lower|and)\b/g;

/** A defect's wording with sides, positions and the manual reference removed. */
export function defectItem(text: string): string {
  return text
    .toLowerCase()
    .replace(/\([^()]*(\([^()]*\)[^()]*)*\)\s*$/, '') // trailing manual reference
    .replace(/\([^)]*\)/g, ' ')
    .replace(POSITION, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Advisories and minor defects that come back on later tests: the tester warned, and nobody
 * fixed it. Counted per test date, so a retest the same day does not make a repeat.
 */
export function repeatAdvisories(tests: readonly MotTest[]): RepeatAdvisory[] {
  const groups = new Map<string, { dates: Set<string>; latest: { date: string; text: string } }>();
  for (const test of tests) {
    const date = test.completedAt.slice(0, 10);
    for (const d of test.defects) {
      if (d.type !== 'advisory' && d.type !== 'minor') continue;
      const item = defectItem(d.text);
      if (!item) continue;
      const group = groups.get(item) ?? { dates: new Set(), latest: { date, text: d.text } };
      group.dates.add(date);
      if (date >= group.latest.date) group.latest = { date, text: d.text };
      groups.set(item, group);
    }
  }
  return [...groups.entries()]
    .filter(([, g]) => g.dates.size >= 2)
    .map(([item, g]) => ({
      item,
      category: categoriseDefect(g.latest.text),
      tests: g.dates.size,
      dates: [...g.dates].sort(),
      latestText: g.latest.text,
    }))
    .sort((a, b) => b.tests - a.tests || b.dates.at(-1)!.localeCompare(a.dates.at(-1)!));
}
