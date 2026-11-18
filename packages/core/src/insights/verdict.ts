import type { Insight, RecordInsights, Verdict } from '../schemas/insights.js';
import type { VehicleRecord } from '../schemas/record.js';
import { DEFECT_CATEGORIES } from './defects.js';
import { day } from './format.js';
import { expectedMileage, findStalls } from './mileage.js';
import { sourceMismatches } from './mismatch.js';
import { findLapses, repeatAdvisories } from './mot.js';
import { provenanceInsights } from './provenance.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2, good: 3 } as const;

/** A lapse this short is usually a late booking rather than a car off the road. */
export const SHORT_LAPSE_DAYS = 30;

const SOURCE_LABEL = {
  dvla: 'DVLA',
  dvsa_mot: 'DVSA',
  rdw: 'RDW',
  nhtsa_vpic: 'NHTSA',
  manual: 'Bought report',
} as const;
const FIELD_LABEL = {
  colour: 'Colour',
  fuelType: 'Fuel',
  engineCapacityCc: 'Engine size',
} as const;

function n(value: number, unit: string): string {
  return `${value.toLocaleString('en-GB')} ${unit}`;
}

/**
 * Runs every rule over a merged record. Pure: the same record always gives the same findings,
 * so the API can store them and the web app can trust them.
 */
export function buildInsights(record: Omit<VehicleRecord, 'insights'>): RecordInsights {
  const items: Insight[] = [];
  const { facts, mileage, motTests } = record;

  // Mileage
  for (const a of mileage.anomalies) {
    items.push({
      rule: a.kind === 'decrease' ? 'mileage.rollback' : 'mileage.unit_change',
      area: 'mileage',
      severity: a.kind === 'decrease' ? 'critical' : 'warning',
      title: a.kind === 'decrease' ? 'Mileage went backwards' : 'Odometer unit changed',
      detail: a.message,
    });
  }
  const stalls = findStalls(mileage.readings);
  for (const s of stalls) {
    items.push({
      rule: 'mileage.stall',
      area: 'mileage',
      severity: 'warning',
      title: 'Mileage barely moved',
      detail: `Only ${n(s.increase, s.to.odometer.unit)} added in ${Math.round(s.days / 30.4)} months, ${day(s.from.date)} to ${day(s.to.date)}. Ask whether the car was laid up.`,
    });
  }
  const expected = expectedMileage(mileage.readings, facts.firstRegistrationDate);
  if (expected) {
    const range = `${n(expected.low, expected.unit)} to ${n(expected.high, expected.unit)}`;
    items.push({
      rule: 'mileage.band',
      area: 'mileage',
      // After a rollback the latest reading proves nothing, so it cannot count in the car's favour.
      severity:
        expected.position === 'typical' && !mileage.anomalies.some((a) => a.kind === 'decrease')
          ? 'good'
          : 'info',
      title:
        expected.position === 'typical'
          ? 'Mileage is typical for its age'
          : expected.position === 'high'
            ? 'High mileage for its age'
            : 'Low mileage for its age',
      detail: `${n(expected.actual, expected.unit)} at ${expected.ageYears} years; typical use would be ${range}.`,
    });
  }
  if (mileage.averagePerYear !== null && mileage.unit) {
    items.push({
      rule: 'mileage.average',
      area: 'mileage',
      severity: 'info',
      title: `About ${n(mileage.averagePerYear, mileage.unit)} a year`,
      detail: null,
    });
  }

  // MOT
  const lapses = findLapses(motTests);
  for (const l of lapses) {
    items.push({
      rule: 'mot.lapse',
      area: 'mot',
      severity: l.days > SHORT_LAPSE_DAYS ? 'warning' : 'info',
      title: `No valid MOT for ${l.days} days`,
      detail: `From ${day(l.from)} to ${day(l.to)}.`,
    });
  }
  const repeats = repeatAdvisories(motTests);
  const label = new Map(DEFECT_CATEGORIES.map((c) => [c.id as string, c.label]));
  for (const r of repeats) {
    items.push({
      rule: 'mot.repeat_advisory',
      area: 'mot',
      severity: 'warning',
      title: `Advised on ${r.tests} tests and not fixed`,
      detail: `${label.get(r.category) ?? r.category}: ${r.latestText} (${r.dates.map((d) => d.slice(0, 4)).join(', ')}).`,
    });
  }
  const latest = motTests[0];
  if (latest) {
    const dangerous = latest.defects.filter((d) => d.dangerous || d.type === 'dangerous');
    if (dangerous.length > 0) {
      items.push({
        rule: 'mot.dangerous_latest',
        area: 'defects',
        severity: 'critical',
        title: 'Dangerous defect on the latest test',
        detail: dangerous.map((d) => d.text).join('; '),
      });
    }
    if (latest.result === 'failed') {
      items.push({
        rule: 'mot.failed_latest',
        area: 'mot',
        severity: 'warning',
        title: 'Failed its latest MOT',
        detail: `On ${day(latest.completedAt)}, with no pass since. Ask for proof of the repairs.`,
      });
    }
  }
  const pastDangerous = motTests
    .slice(1)
    .filter((t) => t.defects.some((d) => d.dangerous || d.type === 'dangerous'));
  if (pastDangerous.length > 0) {
    items.push({
      rule: 'mot.dangerous_past',
      area: 'defects',
      severity: 'info',
      title: `Dangerous defects on ${pastDangerous.length} earlier ${pastDangerous.length === 1 ? 'test' : 'tests'}`,
      detail: `In ${[...new Set(pastDangerous.map((t) => t.completedAt.slice(0, 4)))].join(', ')}.`,
    });
  }
  if (motTests.length > 0 && lapses.length === 0 && repeats.length === 0) {
    items.push({
      rule: 'mot.clean_history',
      area: 'mot',
      severity: 'good',
      title: 'Continuous MOT history with no repeat advisories',
      detail: null,
    });
  }

  // Sources
  const mismatches = sourceMismatches(record.conflicts);
  for (const m of mismatches) {
    items.push({
      rule: `sources.${m.field}`,
      area: 'sources',
      severity: 'warning',
      title: `${FIELD_LABEL[m.field]} differs between sources`,
      detail: `${m.values.map((v) => `${SOURCE_LABEL[v.source]} says ${String(v.value)}`).join(', ')}. Ask why: a respray or engine change should have paperwork, and a mismatch can mean cloned plates.`,
    });
  }

  // Bought reports
  items.push(...provenanceInsights(record.manualReports ?? []));

  // Status from the registers
  if (facts.outstandingRecall === 'yes') {
    items.push({
      rule: 'status.recall',
      area: 'status',
      severity: 'warning',
      title: 'Outstanding safety recall',
      detail: 'A franchised dealer fixes recalls free; ask for it to be done before you buy.',
    });
  }
  if (facts.markedForExport) {
    items.push({
      rule: 'status.export',
      area: 'status',
      severity: 'critical',
      title: 'Marked for export',
      detail: 'The keeper told DVLA the car is leaving the country.',
    });
  }
  if (facts.motStatus && /not valid|no details|expired/i.test(facts.motStatus)) {
    items.push({
      rule: 'status.no_mot',
      area: 'status',
      severity: 'warning',
      title: 'No valid MOT now',
      detail: 'It cannot be driven away legally except to a booked test.',
    });
  }
  if (facts.taxStatus && /sorn|untaxed/i.test(facts.taxStatus)) {
    items.push({
      rule: 'status.untaxed',
      area: 'status',
      severity: 'info',
      title: facts.taxStatus === 'SORN' ? 'Declared off the road (SORN)' : 'Not taxed',
      detail: null,
    });
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return {
    mileage: { stalls, expected },
    mot: { lapses, repeatAdvisories: repeats },
    mismatches,
    items,
    verdict: verdictFrom(
      items,
      motTests.length > 0 || Object.keys(facts).length > 0 || Boolean(record.manualReports?.length),
      Boolean(record.manualReports?.length),
    ),
  };
}

/**
 * The overall call. Free data cannot see finance, theft or write-offs, so "good" says which
 * records it rests on.
 */
export function verdictFrom(
  items: readonly Insight[],
  hasData: boolean,
  hasBoughtReport = false,
): Verdict {
  const reasons = items.filter((i) => i.severity === 'critical' || i.severity === 'warning');
  if (!hasData) {
    return { rating: 'unknown', headline: 'Not enough data to judge.', reasons: [] };
  }
  if (reasons.some((r) => r.severity === 'critical')) {
    return { rating: 'avoid', headline: 'Walk away unless these are explained.', reasons };
  }
  if (reasons.length > 0) {
    return { rating: 'caution', headline: 'Check these before you buy.', reasons };
  }
  return {
    rating: 'good',
    headline: hasBoughtReport
      ? 'Nothing in the free records or the bought report stands out.'
      : 'Nothing in the free records stands out.',
    reasons: [],
  };
}
