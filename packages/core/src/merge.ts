import { summariseMileage } from './insights/mileage.js';
import type { FactConflict, FactKey, MotTest, SourceId, VehicleFacts } from './schemas/vehicle.js';
import type { ManualReport } from './schemas/manual.js';
import type { VehicleRecord } from './schemas/record.js';
import { buildInsights } from './insights/verdict.js';

export interface SourceContribution {
  source: SourceId;
  facts: VehicleFacts;
  motTests?: MotTest[];
  /** Bought reports typed in by hand; only the manual source has these. */
  manualReports?: ManualReport[];
}

/** Default trust order: official registers first, then test records, then VIN decoders. */
export const DEFAULT_SOURCE_PRIORITY: readonly SourceId[] = [
  'dvla',
  'rdw',
  'dvsa_mot',
  'nhtsa_vpic',
  'manual',
];

/** Per-field overrides where a later source in the default order knows better. */
export const FIELD_PRIORITY: Partial<Record<FactKey, readonly SourceId[]>> = {
  // DVLA gives no model; DVSA and RDW do.
  model: ['dvsa_mot', 'rdw', 'nhtsa_vpic'],
  // Only a decoder knows these; the registers do not carry them.
  modelYear: ['nhtsa_vpic'],
  plantCountry: ['nhtsa_vpic'],
  // DVLA only gives the month; DVSA has the exact date.
  firstRegistrationDate: ['dvsa_mot', 'rdw'],
  // DVSA reports recalls; RDW does for Dutch vehicles.
  outstandingRecall: ['rdw', 'dvsa_mot'],
};

function comparable(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

/**
 * Two values agree when they are equal ignoring case, or when one is a less precise date of the
 * other (`2012-04` and `2012-04-20`).
 */
function agrees(a: unknown, b: unknown): boolean {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return true;
  if (
    typeof x === 'string' &&
    typeof y === 'string' &&
    /^\d{4}-\d{2}/.test(x) &&
    /^\d{4}-\d{2}/.test(y)
  ) {
    return x.startsWith(y) || y.startsWith(x);
  }
  return JSON.stringify(x) === JSON.stringify(y);
}

function priorityFor(field: FactKey): readonly SourceId[] {
  const override = FIELD_PRIORITY[field] ?? [];
  return [...override, ...DEFAULT_SOURCE_PRIORITY.filter((s) => !override.includes(s))];
}

/**
 * Merges what each source said into one record. For each field the highest-priority source with
 * a value wins; disagreements are kept in `conflicts` so the UI can show them rather than hide
 * them. MOT tests are taken from every source that has them, deduplicated by test number.
 */
export function mergeContributions(contributions: readonly SourceContribution[]): VehicleRecord {
  const bySource = new Map<SourceId, SourceContribution>();
  for (const c of contributions) bySource.set(c.source, c);

  const fields = new Set<FactKey>();
  for (const c of contributions) {
    for (const key of Object.keys(c.facts) as FactKey[]) {
      if (c.facts[key] !== undefined && c.facts[key] !== null) fields.add(key);
    }
  }

  const facts: Record<string, unknown> = {};
  const provenance: Record<string, SourceId> = {};
  const conflicts: FactConflict[] = [];

  for (const field of fields) {
    const values: Array<{ source: SourceId; value: unknown }> = [];
    for (const source of priorityFor(field)) {
      const value = bySource.get(source)?.facts[field];
      if (value !== undefined && value !== null) values.push({ source, value });
    }
    const [winner] = values;
    if (!winner) continue;
    facts[field] = winner.value;
    provenance[field] = winner.source;
    if (values.some((v) => !agrees(v.value, winner.value))) conflicts.push({ field, values });
  }

  const seen = new Set<string>();
  const motTests: MotTest[] = [];
  for (const c of contributions) {
    for (const test of c.motTests ?? []) {
      const key = test.testNumber ?? `${test.source}:${test.completedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      motTests.push(test);
    }
  }
  motTests.sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  const manualReports = contributions
    .flatMap((c) => c.manualReports ?? [])
    .sort(
      (a, b) =>
        b.purchasedOn.localeCompare(a.purchasedOn) || b.createdAt.localeCompare(a.createdAt),
    );

  const merged = facts as VehicleFacts;
  const record = {
    ...(manualReports.length > 0 ? { manualReports } : {}),
    facts: merged,
    provenance,
    conflicts,
    motTests,
    mileage: summariseMileage(motTests, merged.firstRegistrationDate),
  };
  return { ...record, insights: buildInsights(record) };
}
