import { describe, expect, it } from 'vitest';
import type { Check } from '@/api/client';
import { defectRows, queryDefects, type DefectQuery } from '@/components/defectRows';

type MotTest = NonNullable<Check['record']>['motTests'][number];
type Defect = MotTest['defects'][number];

const motTest = (completedAt: string, defects: Defect[]): MotTest => ({
  testNumber: completedAt,
  completedAt,
  result: 'passed',
  expiryDate: null,
  odometer: null,
  odometerResult: 'read',
  defects,
  source: 'dvsa_mot',
});

const d = (text: string, type: Defect['type'], dangerous = false): Defect => ({
  text,
  type,
  dangerous,
});

const tests = [
  motTest('2024-05-01', [
    d('Nearside Front Tyre worn close to legal limit (5.2.3 (e))', 'advisory'),
    d('Offside Rear Brake disc worn, pitted or scored (1.1.14 (a) (ii))', 'major'),
  ]),
  motTest('2023-05-01', [
    d('Offside Front Brake pipe corroded, covered in grease (1.1.11 (c))', 'major', true),
    d('Headlamp aim too low (4.1.2 (a))', 'minor'),
  ]),
];

const base: DefectQuery = {
  severity: 'all',
  category: 'all',
  text: '',
  sort: 'date',
  descending: true,
};

describe('defect table rows', () => {
  const rows = defectRows(tests);

  it('flattens every defect with its severity and area', () => {
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => [r.severity, r.category])).toEqual([
      ['advisory', 'tyres'],
      ['major', 'brakes'],
      ['dangerous', 'corrosion'],
      ['minor', 'lights'],
    ]);
  });

  it('filters by severity, area and wording together', () => {
    expect(queryDefects(rows, { ...base, category: 'brakes' })).toHaveLength(1);
    expect(
      queryDefects(rows, { ...base, category: 'corrosion', severity: 'dangerous' }),
    ).toHaveLength(1);
    expect(queryDefects(rows, { ...base, category: 'brakes', severity: 'dangerous' })).toHaveLength(
      0,
    );
    expect(queryDefects(rows, { ...base, text: 'CORRODED' }).map((r) => r.date)).toEqual([
      '2023-05-01',
    ]);
  });

  it('sorts by severity worst first, newest first within a severity', () => {
    const sorted = queryDefects(rows, { ...base, sort: 'severity', descending: false });
    expect(sorted.map((r) => r.severity)).toEqual(['dangerous', 'major', 'minor', 'advisory']);
  });

  it('sorts by date in both directions', () => {
    const oldest = queryDefects(rows, { ...base, descending: false });
    expect(oldest[0]?.date).toBe('2023-05-01');
    expect(queryDefects(rows, base)[0]?.date).toBe('2024-05-01');
  });
});
