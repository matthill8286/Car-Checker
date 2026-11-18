import { describe, expect, it } from 'vitest';
import { categoriseDefect, defectHeatmap } from '../src/insights/defects.js';
import type { MotTest } from '../src/schemas/vehicle.js';

describe('categoriseDefect', () => {
  it.each([
    ['Offside Rear Brake disc(s) significantly and obviously worn (1.1.14 (a) (ii))', 'brakes'],
    ['Nearside Front Tyre worn close to legal limit/worn on edge (5.2.3 (e))', 'tyres'],
    ['Nearside Front Suspension arm ball joint excessively worn (5.3.4 (a) (i))', 'suspension'],
    ['Offside Track rod end ball joint has slight play (2.1.3 (b) (i))', 'suspension'],
    ['Nearside Sill corroded but not seriously weakened (6.1.1 (b))', 'corrosion'],
    ['Nearside front brake pipe corroded', 'corrosion'],
    ['Offside headlamp aim too high', 'lights'],
    ['Oil leak, but not excessive (8.4.1 (a) (i))', 'emissions'],
    ['Exhaust has a minor leak of exhaust gases', 'emissions'],
  ])('sorts by wording: %s', (text, category) => {
    expect(categoriseDefect(text)).toBe(category);
  });

  it.each([
    ['Pressure gauge inoperative (1.2.1 (a))', 'brakes'],
    ['Inoperative (4.5.1 (a))', 'lights'],
    ['Registration plate missing (0.1 (a))', 'other'],
    ['Engine mounting deteriorated (6.1.1 (a))', 'other'],
    ['Something unusual', 'other'],
  ])('falls back to the manual reference: %s', (text, category) => {
    expect(categoriseDefect(text)).toBe(category);
  });
});

describe('defectHeatmap', () => {
  const test = (date: string, defects: MotTest['defects']): MotTest => ({
    testNumber: date,
    completedAt: `${date}T10:00:00Z`,
    result: 'passed',
    expiryDate: null,
    odometer: null,
    odometerResult: 'read',
    defects,
    source: 'dvsa_mot',
  });

  it('counts defects by area and year and fills year gaps', () => {
    const map = defectHeatmap([
      test('2021-04-01', [
        { text: 'Brake pipe corroded (1.1.11 (c))', type: 'advisory', dangerous: false },
      ]),
      test('2023-04-01', [
        { text: 'Brake disc worn (1.1.14 (a))', type: 'major', dangerous: false },
        { text: 'Ball joint worn (5.3.4 (a))', type: 'dangerous', dangerous: true },
      ]),
    ]);
    expect(map.years).toEqual([2021, 2022, 2023]);
    expect(map.categories.map((c) => c.id)).toEqual(['brakes', 'suspension', 'corrosion']);
    expect(map.max).toBe(1);
    expect(map.cells).toHaveLength(3);
    expect(map.cells.find((c) => c.category === 'suspension')).toMatchObject({
      year: 2023,
      dangerous: 1,
      byType: { dangerous: 1 },
    });
  });

  it('is empty without tests', () => {
    expect(defectHeatmap([])).toEqual({ categories: [], years: [], cells: [], max: 0 });
  });
});
