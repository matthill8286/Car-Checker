import type { Identifier, SourceContribution, SourceId } from '@carcheck/core';
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sourceResponses } from '../db/schema.js';

/**
 * One fetch from a source, as stored. Failed fetches are logged too (`outcome: 'error'`, with
 * the message in `raw`) but are never reused as cached answers.
 */
export interface SourceResponse {
  source: SourceId;
  identifier: Pick<Identifier, 'kind' | 'value'>;
  outcome: 'ok' | 'not_found' | 'error';
  raw: unknown;
  contribution: SourceContribution | null;
  discovered: Identifier[];
  mock: boolean;
  fetchedAt: Date;
  checkId: string | null;
}

export interface ResponseQuery {
  source: SourceId;
  identifier: Pick<Identifier, 'kind' | 'value'>;
  mock: boolean;
  /** Ignore answers older than this. */
  notBefore: Date;
}

/** Logs every fetch and finds the latest answer still fresh enough to reuse. */
export interface SourceResponseStore {
  record(response: SourceResponse): Promise<void>;
  latest(query: ResponseQuery): Promise<SourceResponse | null>;
}

export class InMemorySourceResponseStore implements SourceResponseStore {
  private readonly responses: SourceResponse[] = [];

  constructor(private readonly limit = 2000) {}

  async record(response: SourceResponse): Promise<void> {
    this.responses.push(structuredClone(response));
    if (this.responses.length > this.limit) this.responses.shift();
  }

  async latest(q: ResponseQuery): Promise<SourceResponse | null> {
    for (let i = this.responses.length - 1; i >= 0; i--) {
      const r = this.responses[i]!;
      if (
        r.source === q.source &&
        r.identifier.kind === q.identifier.kind &&
        r.identifier.value === q.identifier.value &&
        r.mock === q.mock &&
        r.outcome !== 'error' &&
        r.fetchedAt >= q.notBefore
      ) {
        return structuredClone(r);
      }
    }
    return null;
  }
}

export class PostgresSourceResponseStore implements SourceResponseStore {
  constructor(private readonly db: Database) {}

  async record(r: SourceResponse): Promise<void> {
    await this.db.insert(sourceResponses).values({
      source: r.source,
      identifierKind: r.identifier.kind,
      identifierValue: r.identifier.value,
      outcome: r.outcome,
      raw: r.raw ?? null,
      contribution: r.contribution,
      discovered: r.discovered,
      mock: r.mock,
      fetchedAt: r.fetchedAt,
      checkId: r.checkId,
    });
  }

  async latest(q: ResponseQuery): Promise<SourceResponse | null> {
    const [row] = await this.db
      .select()
      .from(sourceResponses)
      .where(
        and(
          eq(sourceResponses.source, q.source),
          eq(sourceResponses.identifierKind, q.identifier.kind),
          eq(sourceResponses.identifierValue, q.identifier.value),
          eq(sourceResponses.mock, q.mock),
          ne(sourceResponses.outcome, 'error'),
          gte(sourceResponses.fetchedAt, q.notBefore),
        ),
      )
      .orderBy(desc(sourceResponses.fetchedAt))
      .limit(1);
    if (!row || row.outcome === 'error') return null;
    return {
      source: row.source,
      identifier: { kind: row.identifierKind, value: row.identifierValue },
      outcome: row.outcome,
      raw: row.raw,
      contribution: row.contribution ?? null,
      discovered: row.discovered,
      mock: row.mock,
      fetchedAt: row.fetchedAt,
      checkId: row.checkId,
    };
  }
}
