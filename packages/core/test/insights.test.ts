import { describe, expect, it } from 'vitest';
import { summariseMileage } from '../src/insights/mileage.js';
import { expectedMileage, findStalls } from '../src/insights/mileage.js';
import { sourceMismatches } from '../src/insights/mismatch.js';
import { defectItem, findLapses, repeatAdvisories } from '../src/insights/mot.js';
import { buildInsights } from '../src/insights/verdict.js';
import type { Defect, MotTest, VehicleFacts } from '../src/schemas/vehicle.js';

/** A crafted test: date, miles, result, and defects as [type, text] pairs. */
function mot(
  date: string,
  miles: number | null,
  opts: {
    result?: 'passed' | 'failed';
    expiry?: string | null;
    defects?: Array<[Defect['type'], string, boolean?]>;
    unit?: 'mi' | 'km';
  } = {},
): MotTest {
  const result = opts.result ?? 'passed';
  const next = `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
  return {
    testNumber: `${date}-${result}`,
    completedAt: `${date}T10:00:00Z`,
    result,
    expiryDate: opts.expiry !== undefined ? opts.expiry : result === 'passed' ? next : null,
    odometer: miles === null ? null : { value: miles, unit: opts.unit ?? 'mi' },
    odometerResult: miles === null ? 'unreadable' : 'read',
    defects: (opts.defects ?? []).map(([type, text, dangerous]) => ({
      type,
      text,
      dangerous: dangerous ?? false,
    })),
    source: 'dvsa_mot',
  };
}

/** Newest first, as the merge produces them. */
function record(tests: MotTest[], facts: VehicleFacts = {}, conflicts = []) {
  const motTests = [...tests].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  return {
    facts,
    provenance: {},
    conflicts,
    motTests,
    mileage: summariseMileage(motTests, facts.firstRegistrationDate),
  };
}

const rules = (r: ReturnType<typeof buildInsights>) => r.items.map((i) => i.rule);

describe('mileage rules', () => {
  it('flags a rollback as critical and the verdict as avoid', () => {
    const insights = buildInsights(
      record([mot('2021-03-01', 40000), mot('2022-03-01', 52000), mot('2023-03-01', 31000)]),
    );
    expect(insights.items[0]).toMatchObject({ rule: 'mileage.rollback', severity: 'critical' });
    expect(insights.verdict.rating).toBe('avoid');
    expect(insights.verdict.reasons[0]?.rule).toBe('mileage.rollback');
  });

  it('finds a stall: a year or more with almost nothing added', () => {
    const readings = summariseMileage([
      mot('2020-03-01', 30000),
      mot('2021-03-10', 30150),
      mot('2022-03-01', 38000),
    ]).readings;
    expect(findStalls(readings)).toEqual([expect.objectContaining({ increase: 150, days: 374 })]);
  });

  it('does not call a short gap or a busy year a stall', () => {
    const readings = summariseMileage([
      mot('2020-03-01', 30000),
      mot('2020-09-01', 30100), // only six months
      mot('2021-09-01', 40000),
    ]).readings;
    expect(findStalls(readings)).toEqual([]);
  });

  it('scales the stall limit for kilometres', () => {
    const readings = summariseMileage([
      mot('2020-03-01', 30000, { unit: 'km' }),
      mot('2021-03-01', 30700, { unit: 'km' }), // 700 km is under 500 miles
    ]).readings;
    expect(findStalls(readings)).toHaveLength(1);
  });

  it.each([
    [20000, 'low'],
    [40000, 'typical'],
    [70000, 'high'],
  ] as const)('puts %i miles at five years in the %s band', (miles, position) => {
    const readings = summariseMileage([mot('2023-06-01', miles)]).readings;
    const band = expectedMileage(readings, '2018-06-01');
    expect(band).toMatchObject({ position, low: 20002, high: 60005, unit: 'mi' });
  });

  it('needs a registration date and a year of age for the band', () => {
    const readings = summariseMileage([mot('2023-06-01', 9000)]).readings;
    expect(expectedMileage(readings, undefined)).toBeNull();
    expect(expectedMileage(readings, '2022-12-01')).toBeNull();
    expect(expectedMileage(readings, '2020-06')).toMatchObject({ ageYears: 3 });
  });
});

describe('MOT rules', () => {
  it('finds gaps between one pass expiring and the next pass', () => {
    const tests = [
      mot('2019-03-01', 1, { expiry: '2020-03-01' }),
      mot('2020-03-20', 2, { result: 'failed' }), // a fail is not cover
      mot('2020-04-10', 3, { expiry: '2021-04-10' }),
      mot('2021-04-08', 4),
    ];
    expect(findLapses(tests)).toEqual([{ from: '2020-03-01', to: '2020-04-10', days: 40 }]);
  });

  it('treats a long lapse as a warning and a short one as information', () => {
    const insights = buildInsights(
      record([
        mot('2019-03-01', 10000, { expiry: '2020-03-01' }),
        mot('2020-03-11', 17000, { expiry: '2021-03-11' }),
        mot('2021-09-01', 24000),
      ]),
    );
    const lapses = insights.items.filter((i) => i.rule === 'mot.lapse');
    expect(lapses.map((l) => [l.severity, l.title])).toEqual([
      ['warning', 'No valid MOT for 174 days'],
      ['info', 'No valid MOT for 10 days'],
    ]);
  });

  it('matches the same advisory across years whatever side it is on', () => {
    expect(defectItem('Nearside Front Brake disc worn, pitted or scored (1.1.14 (a) (ii))')).toBe(
      defectItem('Offside Rear Brake disc worn, pitted or scored (1.1.14 (a) (ii))'),
    );
    const repeats = repeatAdvisories([
      mot('2021-03-01', 1, {
        defects: [['advisory', 'Nearside Front Tyre worn close to legal limit']],
      }),
      mot('2022-03-01', 2, {
        defects: [['advisory', 'Offside Front Tyre worn close to legal limit (5.2.3 (e))']],
      }),
      mot('2023-03-01', 3, { defects: [['advisory', 'Front Tyre worn close to legal limit']] }),
      mot('2023-03-01', 3, { defects: [['minor', 'Oil leak, but not excessive']] }),
    ]);
    expect(repeats).toEqual([
      expect.objectContaining({
        item: 'tyre worn close to legal limit',
        category: 'tyres',
        tests: 3,
        dates: ['2021-03-01', '2022-03-01', '2023-03-01'],
      }),
    ]);
  });

  it('does not count a same-day retest as a repeat, or majors as advisories', () => {
    const repeats = repeatAdvisories([
      mot('2023-03-01', 1, { result: 'failed', defects: [['advisory', 'Wiper blade worn']] }),
      mot('2023-03-01', 1, { defects: [['advisory', 'Wiper blade worn']] }),
      mot('2022-03-01', 1, { defects: [['major', 'Brake disc worn']] }),
      mot('2023-03-01', 1, { defects: [['major', 'Brake disc worn']] }),
    ]);
    expect(repeats).toEqual([]);
  });

  it('calls a dangerous defect on the latest test critical, and on old tests information', () => {
    const insights = buildInsights(
      record([
        mot('2021-03-01', 10000, { defects: [['dangerous', 'Brake hose damaged', true]] }),
        mot('2022-03-01', 18000, {
          result: 'failed',
          defects: [['dangerous', 'Ball joint excessively worn (5.3.4 (a) (i))', true]],
        }),
      ]),
    );
    expect(insights.items.find((i) => i.rule === 'mot.dangerous_latest')?.severity).toBe(
      'critical',
    );
    expect(insights.items.find((i) => i.rule === 'mot.dangerous_past')).toMatchObject({
      severity: 'info',
      detail: 'In 2021.',
    });
    expect(rules(insights)).toContain('mot.failed_latest');
  });
});

describe('source mismatches', () => {
  it('ignores naming and rounding, keeps real differences', () => {
    const found = sourceMismatches([
      {
        field: 'colour',
        values: [
          { source: 'dvla', value: 'GRAY' },
          { source: 'dvsa_mot', value: 'Grey' },
        ],
      },
      {
        field: 'fuelType',
        values: [
          { source: 'dvla', value: 'HEAVY OIL' },
          { source: 'dvsa_mot', value: 'Diesel' },
        ],
      },
      {
        field: 'engineCapacityCc',
        values: [
          { source: 'dvla', value: 1995 },
          { source: 'dvsa_mot', value: 1998 },
        ],
      },
      {
        field: 'make',
        values: [
          { source: 'dvla', value: 'BMW' },
          { source: 'dvsa_mot', value: 'MINI' },
        ],
      },
    ]);
    expect(found).toEqual([]);

    const real = sourceMismatches([
      {
        field: 'colour',
        values: [
          { source: 'dvla', value: 'BLACK' },
          { source: 'dvsa_mot', value: 'Red' },
        ],
      },
      {
        field: 'fuelType',
        values: [
          { source: 'dvla', value: 'PETROL' },
          { source: 'rdw', value: 'Diesel' },
        ],
      },
      {
        field: 'engineCapacityCc',
        values: [
          { source: 'dvla', value: 1598 },
          { source: 'dvsa_mot', value: 1995 },
        ],
      },
    ]);
    expect(real.map((m) => m.field)).toEqual(['colour', 'fuelType', 'engineCapacityCc']);
  });

  it('makes each mismatch a warning that names the sources', () => {
    const insights = buildInsights(
      record([], { colour: 'BLACK' }, [
        {
          field: 'colour',
          values: [
            { source: 'dvla', value: 'BLACK' },
            { source: 'dvsa_mot', value: 'Red' },
          ],
        },
      ] as never),
    );
    expect(insights.verdict.rating).toBe('caution');
    expect(insights.verdict.reasons[0]?.detail).toContain('DVLA says BLACK, DVSA says Red');
  });
});

describe('verdict', () => {
  it('is good for a clean, continuous, typical history', () => {
    const insights = buildInsights(
      record([mot('2019-06-01', 7000), mot('2020-06-01', 14000), mot('2021-06-01', 21000)], {
        firstRegistrationDate: '2018-06-01',
        motStatus: 'Valid',
        taxStatus: 'Taxed',
      }),
    );
    expect(insights.verdict).toMatchObject({ rating: 'good', reasons: [] });
    expect(rules(insights)).toEqual(
      expect.arrayContaining(['mileage.band', 'mot.clean_history', 'mileage.average']),
    );
  });

  it('cautions on a recall and an expired MOT, and notes SORN', () => {
    const insights = buildInsights(
      record([], { outstandingRecall: 'yes', motStatus: 'Not valid', taxStatus: 'SORN' }),
    );
    expect(insights.verdict.rating).toBe('caution');
    expect(insights.verdict.reasons.map((r) => r.rule)).toEqual(['status.recall', 'status.no_mot']);
    expect(rules(insights)).toContain('status.untaxed');
  });

  it('cannot judge an empty record', () => {
    expect(buildInsights(record([])).verdict.rating).toBe('unknown');
  });

  it('lists findings worst first', () => {
    const insights = buildInsights(
      record([mot('2021-03-01', 40000), mot('2022-03-01', 30000)], {
        firstRegistrationDate: '2017-03-01',
        markedForExport: true,
      }),
    );
    const order = insights.items.map((i) => i.severity);
    expect(order).toEqual([...order].sort((a, b) => rank(a) - rank(b)));
  });
});

function rank(s: string): number {
  return ['critical', 'warning', 'info', 'good'].indexOf(s);
}
