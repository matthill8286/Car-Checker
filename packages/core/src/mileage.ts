import type { MileageAnomaly, MileageSummary, MotTest, Odometer } from './schemas/vehicle.js';

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
        message: `Reading fell by ${drop.toLocaleString('en-GB')} ${to.odometer.unit} between ${from.date.slice(0, 10)} and ${to.date.slice(0, 10)}.`,
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
