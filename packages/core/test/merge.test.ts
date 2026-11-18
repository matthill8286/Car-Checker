import { describe, expect, it } from 'vitest';
import { mergeContributions } from '../src/merge.js';
import type { MotTest } from '../src/schemas/vehicle.js';

function test(date: string, miles: number, n: string): MotTest {
  return {
    testNumber: n,
    completedAt: date,
    result: 'passed',
    expiryDate: null,
    odometer: { value: miles, unit: 'mi' },
    odometerResult: 'read',
    defects: [],
    source: 'dvsa_mot',
  };
}

describe('mergeContributions', () => {
  it('takes each field from the highest-priority source and records provenance', () => {
    const record = mergeContributions([
      { source: 'dvsa_mot', facts: { make: 'FORD', model: 'FOCUS', colour: 'Blue' } },
      { source: 'dvla', facts: { make: 'FORD', colour: 'BLUE', taxStatus: 'Taxed' } },
    ]);
    expect(record.facts).toEqual({
      make: 'FORD',
      model: 'FOCUS',
      colour: 'BLUE',
      taxStatus: 'Taxed',
    });
    expect(record.provenance).toEqual({
      make: 'dvla',
      model: 'dvsa_mot',
      colour: 'dvla',
      taxStatus: 'dvla',
    });
    expect(record.conflicts).toEqual([]);
  });

  it('keeps real disagreements as conflicts', () => {
    const record = mergeContributions([
      { source: 'dvla', facts: { fuelType: 'PETROL' } },
      { source: 'dvsa_mot', facts: { fuelType: 'Diesel' } },
    ]);
    expect(record.facts.fuelType).toBe('PETROL');
    expect(record.conflicts).toEqual([
      {
        field: 'fuelType',
        values: [
          { source: 'dvla', value: 'PETROL' },
          { source: 'dvsa_mot', value: 'Diesel' },
        ],
      },
    ]);
  });

  it('sorts MOT tests newest first and flags a falling odometer', () => {
    const record = mergeContributions([
      {
        source: 'dvsa_mot',
        facts: {},
        motTests: [
          test('2022-05-01T10:00:00Z', 40000, '1'),
          test('2024-05-01T10:00:00Z', 31000, '3'),
          test('2023-05-01T10:00:00Z', 48000, '2'),
        ],
      },
    ]);
    expect(record.motTests.map((t) => t.testNumber)).toEqual(['3', '2', '1']);
    expect(record.mileage.anomalies).toHaveLength(1);
    expect(record.mileage.anomalies[0]).toMatchObject({ kind: 'decrease' });
    expect(record.mileage.latest?.odometer.value).toBe(31000);
  });

  it('works out average mileage from first registration', () => {
    const record = mergeContributions([
      { source: 'dvla', facts: { firstRegistrationDate: '2020-05-01' } },
      { source: 'dvsa_mot', facts: {}, motTests: [test('2024-05-01T00:00:00Z', 40000, '1')] },
    ]);
    expect(record.mileage.averagePerYear).toBeGreaterThan(9900);
    expect(record.mileage.averagePerYear).toBeLessThan(10100);
  });
});
