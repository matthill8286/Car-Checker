import { describe, expect, it } from 'vitest';
import type { Check } from '@/api/client';
import { findLapses } from '@/components/MotTimeline';

type MotTest = NonNullable<Check['record']>['motTests'][number];

const test = (
  completedAt: string,
  result: 'passed' | 'failed',
  expiryDate: string | null,
): MotTest => ({
  testNumber: completedAt,
  completedAt,
  result,
  expiryDate,
  odometer: null,
  odometerResult: 'read',
  defects: [],
  source: 'dvsa_mot',
});

describe('findLapses', () => {
  it('finds time between an expiry and the next pass, ignoring fails', () => {
    expect(
      findLapses([
        test('2022-03-01T10:00:00Z', 'passed', '2023-02-28'),
        test('2023-04-10T10:00:00Z', 'failed', null),
        test('2023-04-20T10:00:00Z', 'passed', '2024-04-19'),
        test('2024-04-01T10:00:00Z', 'passed', '2025-04-19'),
      ]),
    ).toEqual([{ from: '2023-02-28', to: '2023-04-20', days: 51 }]);
  });

  it('is empty when every pass came before the last expiry', () => {
    expect(findLapses([test('2024-04-01T10:00:00Z', 'passed', '2025-04-01')])).toEqual([]);
  });
});
