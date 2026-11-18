import { describe, expect, it } from 'vitest';
import type { ManualReport } from '@/api/client';
import { keeperEvents } from '@/components/keeperEvents';

const base: ManualReport = {
  id: 'r1',
  registration: 'WX65ABC',
  vin: null,
  provider: 'HPI Check',
  purchasedOn: '2026-11-17',
  costPence: 1999,
  reference: null,
  finance: { status: 'clear', detail: null },
  stolen: { status: 'clear', detail: null },
  writeOff: { status: 'recorded', category: 'S', date: '2023-08-14' },
  scrapped: 'not_checked',
  imported: 'not_checked',
  exported: 'not_checked',
  previousKeepers: 2,
  keeperChanges: ['2018-06-10', '2021-02-01'],
  plateChanges: [{ from: 'M4TTX', to: 'WX65ABC', date: '2019-01-05' }],
  notes: null,
  createdAt: '2026-11-17T10:00:00Z',
  updatedAt: '2026-11-17T10:00:00Z',
};

describe('keeperEvents', () => {
  it('orders every event and splits ownership into keeper periods', () => {
    const second = { ...base, id: 'r2', keeperChanges: ['2021-02-01'], plateChanges: [] };
    const { events, periods } = keeperEvents([base, second], '2015-09-01');
    expect(events.map((e) => [e.kind, e.date])).toEqual([
      ['registered', '2015-09-01'],
      ['keeper', '2018-06-10'],
      ['plate', '2019-01-05'],
      ['keeper', '2021-02-01'],
      ['write_off', '2023-08-14'],
    ]);
    expect(periods).toEqual([
      { n: 1, from: '2015-09-01', to: '2018-06-10' },
      { n: 2, from: '2018-06-10', to: '2021-02-01' },
      { n: 3, from: '2021-02-01', to: null },
    ]);
  });

  it('has no keeper periods without a first registration date', () => {
    expect(keeperEvents([base], undefined).periods).toEqual([]);
  });
});
