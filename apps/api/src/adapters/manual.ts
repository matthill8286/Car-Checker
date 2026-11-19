import type { Identifier } from '@carcheck/core';
import type { ManualReportStore } from '../manual/store.js';
import type { AdapterOutcome, SourceAdapter } from './types.js';

/**
 * Bought reports typed into the tool, served like any other source so their findings land in
 * the same record and verdict as the free data. Reads the local store, so it is never cached
 * and never logged as a fetch: a report saved a minute ago must show on the next check.
 */
export class ManualAdapter implements SourceAdapter {
  readonly id = 'manual' as const;
  readonly label = 'Bought reports';
  readonly cacheable = false;

  constructor(private readonly store: ManualReportStore) {}

  supports(identifier: Identifier): boolean {
    return (
      identifier.kind === 'uk_reg' || identifier.kind === 'nl_plate' || identifier.kind === 'vin'
    );
  }

  unavailableReason(): string | null {
    return null;
  }

  notFoundMessage(identifier: Identifier): string {
    return `No bought reports saved for ${identifier.display}.`;
  }

  async lookup(identifier: Identifier): Promise<AdapterOutcome> {
    const reports = await this.store.find(
      identifier.kind === 'vin' ? { vin: identifier.value } : { registration: identifier.value },
    );
    if (reports.length === 0) return { status: 'not_found' };
    return {
      status: 'ok',
      contribution: { source: 'manual', facts: {}, manualReports: reports },
      raw: null,
    };
  }
}
