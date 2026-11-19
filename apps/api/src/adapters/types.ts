import type { Identifier, SourceContribution, SourceId } from '@carcheck/core';
import type { HttpClient } from '../http/client.js';

export interface AdapterContext {
  http: HttpClient;
  signal: AbortSignal;
  now: () => Date;
}

export type AdapterOutcome =
  | {
      status: 'ok';
      contribution: SourceContribution;
      /** The upstream payload, kept so it can be stored as JSONB from M2. */
      raw: unknown;
      /** Identifiers this source revealed, such as a VIN, which can unlock further sources. */
      discovered?: Identifier[];
    }
  | { status: 'not_found' };

/** Every data source sits behind this interface. */
export interface SourceAdapter {
  readonly id: SourceId;
  readonly label: string;
  supports(identifier: Identifier): boolean;
  /** Null when the adapter can run; otherwise why not, in words fit to show the user. */
  unavailableReason(mock: boolean): string | null;
  lookup(identifier: Identifier, ctx: AdapterContext): Promise<AdapterOutcome>;
  /** False for local sources: skip the response cache and the fetch log. Default true. */
  readonly cacheable?: boolean;
  /** Wording for "nothing found", when the default would mislead. */
  notFoundMessage?(identifier: Identifier): string;
}
