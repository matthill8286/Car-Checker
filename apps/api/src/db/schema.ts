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
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
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
    /** Plain uuid rather than a foreign key: vehicles reference checks, not the other way. */
    vehicleId: uuid('vehicle_id'),
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

/*
 * Normalised tables from the build plan, rewritten from each vehicle's latest finished check.
 * The check (JSONB) stays the source of truth; these make vehicles queryable for the garage,
 * comparisons and jobs without opening every record.
 */

/** One row per vehicle, keyed by how it was looked up (UK reg, Dutch plate or VIN). */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey(),
    identifierKind: text('identifier_kind').$type<Identifier['kind']>().notNull(),
    identifierValue: text('identifier_value').notNull(),
    identifier: jsonb('identifier').$type<Identifier>().notNull(),
    registration: text('registration'),
    vin: text('vin'),
    country: text('country'),
    make: text('make'),
    model: text('model'),
    variant: text('variant'),
    colour: text('colour'),
    fuelType: text('fuel_type'),
    engineCc: integer('engine_cc'),
    firstRegistered: text('first_registered'),
    verdict: text('verdict').$type<'avoid' | 'caution' | 'good' | 'unknown'>(),
    concerns: integer('concerns').notNull().default(0),
    latestCheckId: uuid('latest_check_id')
      .notNull()
      .references(() => checks.id),
    checkedAt: timestamptz('checked_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('vehicles_identifier_idx').on(t.identifierKind, t.identifierValue),
    index('vehicles_vin_idx').on(t.vin),
    index('vehicles_registration_idx').on(t.registration),
  ],
);

export const vehicleStatus = pgTable('vehicle_status', {
  vehicleId: uuid('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  taxStatus: text('tax_status'),
  taxDue: text('tax_due'),
  motStatus: text('mot_status'),
  motExpiry: text('mot_expiry'),
  markedForExport: boolean('marked_for_export'),
  outstandingRecall: text('outstanding_recall'),
});

export const motTests = pgTable(
  'mot_tests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    testNumber: text('test_number'),
    completedAt: timestamptz('completed_at').notNull(),
    result: text('result').$type<'passed' | 'failed'>().notNull(),
    odometer: integer('odometer'),
    odometerUnit: text('odometer_unit').$type<'mi' | 'km'>(),
    odometerResult: text('odometer_result').notNull(),
    expiry: text('expiry'),
    source: text('source').$type<SourceId>().notNull(),
  },
  (t) => [index('mot_tests_vehicle_idx').on(t.vehicleId, t.completedAt)],
);

export const motDefects = pgTable(
  'mot_defects',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    motTestId: bigint('mot_test_id', { mode: 'number' })
      .notNull()
      .references(() => motTests.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    dangerous: boolean('dangerous').notNull(),
    text: text('text').notNull(),
    category: text('category').notNull(),
  },
  (t) => [index('mot_defects_test_idx').on(t.motTestId)],
);

export const mileageReadings = pgTable(
  'mileage_readings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    date: timestamptz('date').notNull(),
    value: integer('value').notNull(),
    unit: text('unit').$type<'mi' | 'km'>().notNull(),
    source: text('source').$type<SourceId>().notNull(),
  },
  (t) => [index('mileage_readings_vehicle_idx').on(t.vehicleId, t.date)],
);

/** Per-field provenance: which source supplied each fact, and when it was fetched. */
export const fieldSources = pgTable(
  'field_sources',
  {
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    source: text('source').$type<SourceId>().notNull(),
    fetchedAt: timestamptz('fetched_at'),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.field] })],
);

/** The garage: vehicles the user is considering, with their own notes. */
export const savedVehicles = pgTable('saved_vehicles', {
  vehicleId: uuid('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id, { onDelete: 'cascade' }),
  notes: text('notes'),
  askingPricePence: integer('asking_price_pence'),
  listingUrl: text('listing_url'),
  savedAt: timestamptz('saved_at').notNull(),
  updatedAt: timestamptz('updated_at').notNull(),
});

export const schema = {
  checks,
  sourceResponses,
  manualReports,
  vehicles,
  vehicleStatus,
  motTests,
  motDefects,
  mileageReadings,
  fieldSources,
  savedVehicles,
};
