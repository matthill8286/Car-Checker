import type { ManualReport } from '@/api/client';

export type KeeperEventKind = 'registered' | 'keeper' | 'plate' | 'write_off';

export interface KeeperEvent {
  kind: KeeperEventKind;
  date: string;
  label: string;
}

export interface KeeperPeriod {
  /** 1 for the first keeper. */
  n: number;
  from: string;
  to: string | null;
}

/**
 * Everything on the ownership timeline: first registration, keeper changes, plate changes and
 * a write-off, merged across reports and deduplicated by date.
 */
export function keeperEvents(
  reports: readonly ManualReport[],
  firstRegistration: string | undefined,
): { events: KeeperEvent[]; periods: KeeperPeriod[] } {
  const events: KeeperEvent[] = [];
  const seen = new Set<string>();
  const add = (e: KeeperEvent) => {
    const k = `${e.kind}:${e.date}:${e.label}`;
    if (seen.has(k)) return;
    seen.add(k);
    events.push(e);
  };
  if (firstRegistration) {
    add({ kind: 'registered', date: firstRegistration, label: 'First registered' });
  }
  const changes = [...new Set(reports.flatMap((r) => r.keeperChanges))].sort();
  for (const date of changes) add({ kind: 'keeper', date, label: 'New keeper' });
  for (const r of reports) {
    for (const p of r.plateChanges) {
      if (p.date) add({ kind: 'plate', date: p.date, label: `Plate ${p.from} → ${p.to}` });
    }
    if (r.writeOff.status === 'recorded' && r.writeOff.date) {
      add({
        kind: 'write_off',
        date: r.writeOff.date,
        label: r.writeOff.category ? `Category ${r.writeOff.category} write-off` : 'Write-off',
      });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  // Keeper periods only when we know where the first one started.
  const periods: KeeperPeriod[] = [];
  if (firstRegistration) {
    const starts = [firstRegistration, ...changes.filter((d) => d > firstRegistration)];
    starts.forEach((from, i) => periods.push({ n: i + 1, from, to: starts[i + 1] ?? null }));
  }
  return { events, periods };
}
