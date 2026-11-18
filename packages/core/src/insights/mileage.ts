import type { ExpectedMileage, MileageStall } from '../schemas/insights.js';
import { day } from './format.js';
import type { MileageAnomaly, MileageSummary, MotTest, Odometer } from '../schemas/vehicle.js';

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Orders the odometer readings from MOT tests and flags readings that go backwards, which on a
 * used car usually means clocking, a replaced instrument cluster or a typing error at the test.
 */
export function summariseMileage(
  tests: readonly MotTest[],
  firstRegistrationDate?: string,
): MileageSummary {
  const readings = tests
    .filter(
      (t): t is MotTest & { odometer: Odometer } =>
        t.odometer !== null && t.odometerResult === 'read',
    )
    .map((t) => ({ date: t.completedAt, odometer: t.odometer }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const anomalies: MileageAnomaly[] = [];
  for (let i = 1; i < readings.length; i++) {
    const from = readings[i - 1]!;
    const to = readings[i]!;
    if (from.odometer.unit !== to.odometer.unit) {
      anomalies.push({
        kind: 'unit_change',
        from,
        to,
        message: `Odometer unit changed from ${from.odometer.unit} to ${to.odometer.unit}.`,
      });
      continue;
    }
    if (to.odometer.value < from.odometer.value) {
      const drop = from.odometer.value - to.odometer.value;
      anomalies.push({
        kind: 'decrease',
        from,
        to,
        message: `Reading fell by ${drop.toLocaleString('en-GB')} ${to.odometer.unit} between ${day(from.date)} and ${day(to.date)}.`,
      });
    }
  }

  const latest = readings.at(-1) ?? null;
  let averagePerYear: number | null = null;
  if (latest) {
    const start = firstRegistrationDate
      ? { date: firstRegistrationDate, value: 0 }
      : readings[0]
        ? { date: readings[0].date, value: readings[0].odometer.value }
        : null;
    if (start) {
      const years = (Date.parse(latest.date) - Date.parse(start.date)) / MS_PER_YEAR;
      if (years >= 0.5) {
        averagePerYear = Math.round((latest.odometer.value - start.value) / years);
      }
    }
  }

  return {
    readings,
    latest,
    averagePerYear,
    unit: latest?.odometer.unit ?? null,
    anomalies,
  };
}

type Reading = MileageSummary['readings'][number];

const DAY_MS = 24 * 60 * 60 * 1000;
const KM_PER_MILE = 1.609344;

/** A gap of at least this long between readings is long enough to judge. */
export const STALL_MIN_DAYS = 300;
/** Less than this added over such a gap counts as a stall. */
export const STALL_MAX_INCREASE_MI = 500;

/**
 * Long gaps with almost no added mileage. Real stalls happen (a car laid up, SORN), but in a
 * history that also has a rollback they often mark where the clock was wound back.
 */
export function findStalls(readings: readonly Reading[]): MileageStall[] {
  const stalls: MileageStall[] = [];
  for (let i = 1; i < readings.length; i++) {
    const from = readings[i - 1]!;
    const to = readings[i]!;
    if (from.odometer.unit !== to.odometer.unit) continue;
    const increase = to.odometer.value - from.odometer.value;
    if (increase < 0) continue; // a rollback, reported separately
    const days = Math.round((Date.parse(to.date) - Date.parse(from.date)) / DAY_MS);
    const limit =
      to.odometer.unit === 'km' ? STALL_MAX_INCREASE_MI * KM_PER_MILE : STALL_MAX_INCREASE_MI;
    if (days >= STALL_MIN_DAYS && increase < limit) stalls.push({ from, to, increase, days });
  }
  return stalls;
}

/**
 * Yearly mileage band for a car in normal use, in miles. Typical is the UK average for cars
 * (DfT: about 7,000 miles); low and high bracket the middle of the spread.
 */
export const EXPECTED_MILES_PER_YEAR = { low: 4000, typical: 7000, high: 12000 } as const;

/**
 * Where the latest reading sits against the band for the car's age. Needs a first-registration
 * date and at least a year of age; otherwise there is nothing fair to compare with.
 */
export function expectedMileage(
  readings: readonly Reading[],
  firstRegistrationDate: string | undefined,
): ExpectedMileage | null {
  const latest = readings.at(-1);
  if (!latest || !firstRegistrationDate) return null;
  const registered = Date.parse(
    /^\d{4}-\d{2}$/.test(firstRegistrationDate)
      ? `${firstRegistrationDate}-01`
      : firstRegistrationDate,
  );
  const ageYears = (Date.parse(latest.date) - registered) / MS_PER_YEAR;
  if (!Number.isFinite(ageYears) || ageYears < 1) return null;
  const unit = latest.odometer.unit;
  const factor = unit === 'km' ? KM_PER_MILE : 1;
  const band = (perYear: number) => Math.round(perYear * factor * ageYears);
  const low = band(EXPECTED_MILES_PER_YEAR.low);
  const high = band(EXPECTED_MILES_PER_YEAR.high);
  const actual = latest.odometer.value;
  return {
    ageYears: Math.round(ageYears * 10) / 10,
    low,
    typical: band(EXPECTED_MILES_PER_YEAR.typical),
    high,
    actual,
    unit,
    position: actual < low ? 'low' : actual > high ? 'high' : 'typical',
  };
}
