import { describe, expect, it } from 'vitest';
import { latestFlags, provenanceInsights } from '../src/insights/provenance.js';
import { mergeContributions } from '../src/merge.js';
import {
  ManualReportInputSchema,
  type ManualReport,
  type ManualReportInput,
} from '../src/schemas/manual.js';

let n = 0;
function report(input: Partial<ManualReportInput> & { purchasedOn: string }): ManualReport {
  const fields = ManualReportInputSchema.parse({
    registration: 'AB12CDE',
    provider: 'HPI',
    costPence: 999,
    finance: { status: 'clear' },
    stolen: { status: 'clear' },
    writeOff: { status: 'clear' },
    ...input,
  });
  n += 1;
  return {
    id: `r${n}`,
    ...fields,
    createdAt: `${input.purchasedOn}T12:00:00.000Z`,
    updatedAt: `${input.purchasedOn}T12:00:00.000Z`,
  };
}

describe('bought report input', () => {
  it('needs a registration or a VIN', () => {
    const result = ManualReportInputSchema.safeParse({
      provider: 'HPI',
      purchasedOn: '2026-11-01',
      costPence: 999,
      finance: { status: 'clear' },
      stolen: { status: 'clear' },
      writeOff: { status: 'clear' },
    });
    expect(result.success).toBe(false);
  });

  it('only takes a write-off category with a recorded write-off', () => {
    const result = ManualReportInputSchema.safeParse({
      registration: 'AB12CDE',
      provider: 'HPI',
      purchasedOn: '2026-11-01',
      costPence: 999,
      finance: { status: 'clear' },
      stolen: { status: 'clear' },
      writeOff: { status: 'clear', category: 'S' },
    });
    expect(result.success).toBe(false);
  });
});

describe('latestFlags', () => {
  it('takes each risk from the newest report that checked it', () => {
    const older = report({
      purchasedOn: '2026-01-10',
      finance: { status: 'recorded', detail: 'Black Horse PCP' },
      imported: 'recorded',
    });
    const newer = report({
      purchasedOn: '2026-11-01',
      finance: { status: 'clear' },
      stolen: { status: 'not_checked' },
    });
    const flags = new Map(latestFlags([older, newer]).map((f) => [f.risk, f]));
    expect(flags.get('finance')).toMatchObject({ status: 'clear', report: { id: newer.id } });
    expect(flags.get('stolen')).toMatchObject({ status: 'clear', report: { id: older.id } });
    expect(flags.get('imported')?.status).toBe('recorded');
    expect(flags.get('scrapped')).toMatchObject({ status: 'not_checked', report: null });
  });
});

describe('provenanceInsights', () => {
  it('makes outstanding finance and theft critical', () => {
    const items = provenanceInsights([
      report({
        purchasedOn: '2026-11-01',
        finance: { status: 'recorded', detail: 'Black Horse PCP' },
        stolen: { status: 'recorded' },
      }),
    ]);
    expect(items.filter((i) => i.severity === 'critical').map((i) => i.rule)).toEqual([
      'provenance.finance',
      'provenance.stolen',
    ]);
    expect(items[0]?.detail).toBe(
      'Black Horse PCP. The lender owns the car until it is settled (HPI, 1 Nov 2026)',
    );
  });

  it.each([
    ['A', 'critical'],
    ['B', 'critical'],
    ['S', 'warning'],
    ['N', 'warning'],
    ['C', 'warning'],
  ] as const)('rates a category %s write-off as %s', (category, severity) => {
    const [item] = provenanceInsights([
      report({ purchasedOn: '2026-11-01', writeOff: { status: 'recorded', category } }),
    ]);
    expect(item).toMatchObject({ rule: 'provenance.write_off', severity });
    expect(item?.title).toBe(`Category ${category} write-off`);
  });

  it('notes keepers and plate changes, and a clean report', () => {
    const items = provenanceInsights([
      report({
        purchasedOn: '2026-11-01',
        previousKeepers: 3,
        plateChanges: [{ from: 'PRIV 8', to: 'AB12CDE', date: '2020-05-01' }],
      }),
    ]);
    expect(items.map((i) => [i.rule, i.severity])).toEqual([
      ['provenance.keepers', 'info'],
      ['provenance.plates', 'info'],
      ['provenance.clear', 'good'],
    ]);
    expect(items[0]?.title).toBe('3 previous keepers');
  });

  it('says nothing is clear when a risk was not checked', () => {
    const items = provenanceInsights([
      report({ purchasedOn: '2026-11-01', stolen: { status: 'not_checked' } }),
    ]);
    expect(items.map((i) => i.rule)).not.toContain('provenance.clear');
  });
});

describe('bought reports in the merged record', () => {
  it('sit alongside free data and drive the verdict', () => {
    const record = mergeContributions([
      { source: 'dvla', facts: { make: 'BMW', colour: 'BLACK' } },
      {
        source: 'manual',
        facts: {},
        manualReports: [
          report({ purchasedOn: '2026-10-01' }),
          report({
            purchasedOn: '2026-11-01',
            writeOff: { status: 'recorded', category: 'B', date: '2024-03-02' },
          }),
        ],
      },
    ]);
    expect(record.facts.make).toBe('BMW');
    expect(record.manualReports?.map((r) => r.purchasedOn)).toEqual(['2026-11-01', '2026-10-01']);
    expect(record.insights?.verdict.rating).toBe('avoid');
    expect(record.insights?.verdict.reasons[0]).toMatchObject({
      rule: 'provenance.write_off',
      detail: expect.stringContaining('On 2 Mar 2024'),
    });
  });

  it('leaves manualReports out when there are none', () => {
    const record = mergeContributions([{ source: 'dvla', facts: { make: 'BMW' } }]);
    expect(record).not.toHaveProperty('manualReports');
    expect(record.insights?.verdict.headline).toBe('Nothing in the free records stands out.');
  });
});
