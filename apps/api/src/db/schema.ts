import type {
  CheckStatus,
  Identifier,
  SourceContribution,
  SourceId,
  SourceRun,
  VehicleRecord,
} from '@carcheck/core';
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** One row per check. The check's evolving state lives in JSONB; lookup columns are plain. */
export const checks = pgTable(
  'checks',
  {
    id: uuid('id').primaryKey(),
    query: text('query').notNull(),
    status: text('status').$type<CheckStatus>().notNull(),
    identifierKind: text('identifier_kind').$type<Identifier['kind']>().notNull(),
    identifierValue: text('identifier_value').notNull(),
    identifier: jsonb('identifier').$type<Identifier>().notNull(),
    alternatives: jsonb('alternatives').$type<Identifier[]>().notNull(),
    sources: jsonb('sources').$type<SourceRun[]>().notNull(),
    record: jsonb('record').$type<VehicleRecord>(),
    /** Make and model, denormalised for listing checks without reading the record. */
    title: text('title'),
    createdAt: timestamptz('created_at').notNull(),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    index('checks_created_at_idx').on(t.createdAt),
    index('checks_identifier_idx').on(t.identifierKind, t.identifierValue, t.createdAt),
  ],
);

/**
 * Every answer a source gave, kept verbatim. `raw` is the upstream payload so records can be
 * re-normalised later; `contribution` is what the adapter made of it, reused by the cache.
 * Errors are not stored: only answers.
 */
export const sourceResponses = pgTable(
  'source_responses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').$type<SourceId>().notNull(),
    identifierKind: text('identifier_kind').$type<Identifier['kind']>().notNull(),
    identifierValue: text('identifier_value').notNull(),
    outcome: text('outcome').$type<'ok' | 'not_found'>().notNull(),
    raw: jsonb('raw'),
    contribution: jsonb('contribution').$type<SourceContribution>(),
    discovered: jsonb('discovered').$type<Identifier[]>().notNull(),
    /** Fixture answers are never served to a live check, or the other way round. */
    mock: boolean('mock').notNull(),
    fetchedAt: timestamptz('fetched_at').notNull(),
    checkId: uuid('check_id').references(() => checks.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('source_responses_lookup_idx').on(
      t.source,
      t.identifierKind,
      t.identifierValue,
      t.mock,
      t.fetchedAt,
    ),
  ],
);

export const schema = { checks, sourceResponses };
