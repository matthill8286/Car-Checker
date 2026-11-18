import type {
  CheckStatus,
  ManualReport,
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
 * The fetch log: every call to a source, kept verbatim. `raw` is the upstream payload so
 * records can be re-normalised later (or `{ message }` for a failed fetch); `contribution` is
 * what the adapter made of it, reused by the cache. Failed fetches are never served from cache.
 */
export const sourceResponses = pgTable(
  'source_responses',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').$type<SourceId>().notNull(),
    identifierKind: text('identifier_kind').$type<Identifier['kind']>().notNull(),
    identifierValue: text('identifier_value').notNull(),
    outcome: text('outcome').$type<'ok' | 'not_found' | 'error'>().notNull(),
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

/**
 * Findings typed in from bought reports (HPI, carVertical and the like). The report itself is
 * JSONB; registration and VIN are columns so a check can find its reports.
 */
export const manualReports = pgTable(
  'manual_reports',
  {
    id: uuid('id').primaryKey(),
    registration: text('registration'),
    vin: text('vin'),
    report: jsonb('report').$type<ManualReport>().notNull(),
    createdAt: timestamptz('created_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    index('manual_reports_registration_idx').on(t.registration),
    index('manual_reports_vin_idx').on(t.vin),
  ],
);

export const schema = { checks, sourceResponses, manualReports };
