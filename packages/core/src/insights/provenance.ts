import type { Insight } from '../schemas/insights.js';
import type { FlagStatus, ManualReport, WriteOffCategory } from '../schemas/manual.js';
import { day } from './format.js';

export type ProvenanceRisk =
  'finance' | 'stolen' | 'writeOff' | 'scrapped' | 'imported' | 'exported';

export interface LatestFlag {
  risk: ProvenanceRisk;
  status: FlagStatus;
  detail: string | null;
  category: WriteOffCategory | null;
  /** The report that settled it: the newest one that checked this risk. */
  report: Pick<ManualReport, 'id' | 'provider' | 'purchasedOn'> | null;
}

export const PROVENANCE_RISKS: ReadonlyArray<{ risk: ProvenanceRisk; label: string }> = [
  { risk: 'finance', label: 'Outstanding finance' },
  { risk: 'stolen', label: 'Reported stolen' },
  { risk: 'writeOff', label: 'Insurance write-off' },
  { risk: 'scrapped', label: 'Recorded as scrapped' },
  { risk: 'imported', label: 'Imported' },
  { risk: 'exported', label: 'Exported' },
];

function read(r: ManualReport, risk: ProvenanceRisk) {
  switch (risk) {
    case 'finance':
    case 'stolen':
      return { status: r[risk].status, detail: r[risk].detail, category: null };
    case 'writeOff':
      return {
        status: r.writeOff.status,
        detail: r.writeOff.date ? `On ${day(r.writeOff.date)}` : null,
        category: r.writeOff.category,
      };
    default:
      return { status: r[risk], detail: null, category: null };
  }
}

/**
 * For each risk, what the newest report that covered it said. Finance in particular changes
 * over time, so an older "recorded" is overridden by a newer "clear" (and the other way round).
 */
export function latestFlags(reports: readonly ManualReport[]): LatestFlag[] {
  const newestFirst = [...reports].sort(
    (a, b) => b.purchasedOn.localeCompare(a.purchasedOn) || b.createdAt.localeCompare(a.createdAt),
  );
  return PROVENANCE_RISKS.map(({ risk }) => {
    for (const r of newestFirst) {
      const v = read(r, risk);
      if (v.status !== 'not_checked') {
        return {
          risk,
          ...v,
          report: { id: r.id, provider: r.provider, purchasedOn: r.purchasedOn },
        };
      }
    }
    return { risk, status: 'not_checked', detail: null, category: null, report: null };
  });
}

const WRITE_OFF: Record<WriteOffCategory, { severity: Insight['severity']; meaning: string }> = {
  A: { severity: 'critical', meaning: 'scrap only; it must never return to the road' },
  B: { severity: 'critical', meaning: 'the body shell must be crushed; parts only' },
  C: {
    severity: 'warning',
    meaning: 'repairable, but repairs cost more than it was worth (pre-2017)',
  },
  D: { severity: 'warning', meaning: 'repairable, uneconomic to repair (pre-2017)' },
  S: { severity: 'warning', meaning: 'structural damage, repaired' },
  N: { severity: 'warning', meaning: 'non-structural damage, repaired' },
};

function by(flag: LatestFlag): string {
  return flag.report ? `${flag.report.provider}, ${day(flag.report.purchasedOn)}` : '';
}

/** Findings from bought reports, in the same shape as the free-data rules. */
export function provenanceInsights(reports: readonly ManualReport[]): Insight[] {
  if (reports.length === 0) return [];
  const flags = new Map(latestFlags(reports).map((f) => [f.risk, f]));
  const items: Insight[] = [];
  const push = (i: Omit<Insight, 'area'>) => items.push({ area: 'provenance', ...i });
  const detail = (f: LatestFlag, extra: string) =>
    [f.detail, extra, `(${by(f)})`].filter(Boolean).join('. ').replace('. (', ' (');

  const finance = flags.get('finance')!;
  if (finance.status === 'recorded') {
    push({
      rule: 'provenance.finance',
      severity: 'critical',
      title: 'Outstanding finance recorded',
      detail: detail(finance, 'The lender owns the car until it is settled'),
    });
  }
  const stolen = flags.get('stolen')!;
  if (stolen.status === 'recorded') {
    push({
      rule: 'provenance.stolen',
      severity: 'critical',
      title: 'Reported stolen',
      detail: detail(stolen, 'Do not buy; tell the police'),
    });
  }
  const writeOff = flags.get('writeOff')!;
  if (writeOff.status === 'recorded') {
    const cat = writeOff.category ? WRITE_OFF[writeOff.category] : null;
    push({
      rule: 'provenance.write_off',
      severity: cat?.severity ?? 'warning',
      title: writeOff.category
        ? `Category ${writeOff.category} write-off`
        : 'Recorded as a write-off',
      detail: detail(writeOff, cat ? `Means ${cat.meaning}` : ''),
    });
  }
  if (flags.get('scrapped')!.status === 'recorded') {
    push({
      rule: 'provenance.scrapped',
      severity: 'critical',
      title: 'Recorded as scrapped',
      detail: detail(flags.get('scrapped')!, 'A scrapped car should not be on the road'),
    });
  }
  if (flags.get('exported')!.status === 'recorded') {
    push({
      rule: 'provenance.exported',
      severity: 'warning',
      title: 'Recorded as exported',
      detail: detail(flags.get('exported')!, ''),
    });
  }
  if (flags.get('imported')!.status === 'recorded') {
    push({
      rule: 'provenance.imported',
      severity: 'info',
      title: 'Imported',
      detail: detail(flags.get('imported')!, 'History from before import may be missing'),
    });
  }

  const latest = [...reports].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn))[0]!;
  if (latest.previousKeepers !== null) {
    push({
      rule: 'provenance.keepers',
      severity: 'info',
      title: `${latest.previousKeepers} previous ${latest.previousKeepers === 1 ? 'keeper' : 'keepers'}`,
      detail: null,
    });
  }
  const plates = new Set(reports.flatMap((r) => r.plateChanges.map((p) => `${p.from}>${p.to}`)));
  if (plates.size > 0) {
    push({
      rule: 'provenance.plates',
      severity: 'info',
      title: `Plate changed ${plates.size} ${plates.size === 1 ? 'time' : 'times'}`,
      detail: 'Check the V5C matches, and look up the old plates too.',
    });
  }

  const core: ProvenanceRisk[] = ['finance', 'stolen', 'writeOff'];
  if (core.every((r) => flags.get(r)!.status === 'clear')) {
    push({
      rule: 'provenance.clear',
      severity: 'good',
      title: 'No finance, theft or write-off in the bought report',
      detail: `${latest.provider}, ${day(latest.purchasedOn)}.`,
    });
  }
  return items;
}
