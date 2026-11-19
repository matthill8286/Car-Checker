import { CheckSchema, type Check } from '@carcheck/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PostgresSourceResponseStore } from '../src/checks/responses.js';
import { PostgresCheckStore } from '../src/checks/store.js';
import type { Database } from '../src/db/client.js';
import { sourceResponses } from '../src/db/schema.js';
import { testDatabase } from './db.js';
import { NOW, testApp } from './helpers.js';

let db: Database;
let close: () => Promise<void>;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  ({ db, close } = await testDatabase());
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await close();
});

const check: Check = {
  id: '6a0c3d1e-2f4b-4c8d-9e1f-0a2b3c4d5e6f',
  query: 'ab12 cde',
  status: 'running',
  identifier: {
    kind: 'uk_reg',
    country: 'GB',
    value: 'AB12CDE',
    display: 'AB12 CDE',
    format: 'current',
    issuePeriod: { from: '2012-03', to: '2012-08' },
    northernIreland: false,
  },
  alternatives: [],
  sources: [],
  record: null,
  createdAt: '2026-11-18T12:00:00.000Z',
  completedAt: null,
};

describe('PostgresCheckStore', () => {
  it('round-trips a check and updates it in place', async () => {
    const store = new PostgresCheckStore(db);
    await store.save(check);
    expect(await store.get(check.id)).toEqual(check);

    const done: Check = {
      ...check,
      status: 'complete',
      completedAt: '2026-11-18T12:00:02.000Z',
      record: {
        facts: { make: 'FORD', model: 'FOCUS' },
        provenance: { make: 'dvla', model: 'dvsa_mot' },
        conflicts: [],
        motTests: [],
        mileage: { readings: [], latest: null, averagePerYear: null, unit: null, anomalies: [] },
      },
    };
    await store.save(done);
    expect(await store.get(check.id)).toEqual(done);
    expect(await store.list(10)).toEqual([
      {
        id: check.id,
        query: 'ab12 cde',
        status: 'complete',
        identifier: check.identifier,
        title: 'FORD FOCUS',
        createdAt: check.createdAt,
      },
    ]);
  });

  it('returns null for an unknown id', async () => {
    expect(await new PostgresCheckStore(db).get(check.id)).toBeNull();
  });
});

describe('PostgresSourceResponseStore', () => {
  it('finds the newest answer within the window, for the same mode only', async () => {
    const store = new PostgresSourceResponseStore(db);
    const base = {
      source: 'dvla' as const,
      identifier: { kind: 'uk_reg' as const, value: 'AB12CDE' },
      outcome: 'ok' as const,
      raw: { registrationNumber: 'AB12CDE' },
      contribution: { source: 'dvla' as const, facts: { make: 'FORD' } },
      discovered: [],
      mock: false,
      checkId: null,
    };
    await store.record({ ...base, fetchedAt: new Date('2026-11-17T09:00:00Z') });
    await store.record({
      ...base,
      contribution: { source: 'dvla', facts: { make: 'FORD', colour: 'BLUE' } },
      fetchedAt: new Date('2026-11-18T09:00:00Z'),
    });

    const query = { source: 'dvla' as const, identifier: base.identifier, mock: false };
    const hit = await store.latest({ ...query, notBefore: new Date('2026-11-17T12:00:00Z') });
    expect(hit?.contribution?.facts).toEqual({ make: 'FORD', colour: 'BLUE' });
    expect(hit?.raw).toEqual({ registrationNumber: 'AB12CDE' });

    expect(
      await store.latest({ ...query, notBefore: new Date('2026-11-18T10:00:00Z') }),
    ).toBeNull();
    expect(
      await store.latest({ ...query, mock: true, notBefore: new Date('2026-11-17T00:00:00Z') }),
    ).toBeNull();
  });
});

describe('API on Postgres', () => {
  async function run(query: string, extra: Record<string, unknown> = {}): Promise<Check> {
    const created = await app!.inject({
      method: 'POST',
      url: '/api/checks',
      payload: { query, ...extra },
    });
    const id = created.json().check.id as string;
    await app!.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
    return CheckSchema.parse(
      (await app!.inject({ method: 'GET', url: `/api/checks/${id}` })).json(),
    );
  }

  it('stores checks and raw source answers', async () => {
    app = await testApp({}, { db });
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json().storage).toBe('postgres');

    const first = await run('WX65ABC');
    expect(first.status).toBe('complete');
    expect(first.sources.map((s) => s.cached)).toEqual([false, false, false]);

    const rows = await db.select().from(sourceResponses);
    expect(rows.map((r) => [r.source, r.outcome, r.checkId]).sort()).toEqual([
      ['dvla', 'ok', first.id],
      ['dvsa_mot', 'ok', first.id],
    ]);
    expect((rows.find((r) => r.source === 'dvla')?.raw as { make: string }).make).toBe('BMW');

    const list = await app.inject({ method: 'GET', url: '/api/checks?limit=5' });
    expect(list.json().checks[0]).toMatchObject({ id: first.id, title: 'BMW 320D' });
  });

  it('reuses fresh answers, and asks again when told to', async () => {
    app = await testApp({}, { db });
    await run('AB12CDE');

    const second = await run('ab12 cde');
    expect(
      second.sources
        .filter((s) => s.source !== 'manual')
        .every((s) => s.cached && s.status === 'ok'),
    ).toBe(true);
    // Bought reports are read fresh every time.
    expect(second.sources.find((s) => s.source === 'manual')?.cached).toBe(false);
    expect(second.sources[0]?.fetchedAt).toBe(NOW.toISOString());
    expect(second.record?.motTests).toHaveLength(10);

    const third = await run('AB12CDE', { fresh: true });
    expect(third.sources.every((s) => !s.cached)).toBe(true);
    expect(await db.$count(sourceResponses)).toBe(4);
  });

  it('remembers not-found briefly and does not cache errors', async () => {
    app = await testApp({}, { db });
    await run('ER12ROR');
    const again = await run('ER12ROR');
    const dvla = again.sources.find((s) => s.source === 'dvla');
    expect(dvla).toMatchObject({ status: 'error', cached: false });
    expect(again.sources.find((s) => s.source === 'dvsa_mot')?.cached).toBe(true);

    // Both failed DVLA fetches are in the fetch log, with the message shown to the user.
    const failures = (await db.select().from(sourceResponses)).filter((r) => r.outcome === 'error');
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ source: 'dvla', raw: { message: dvla?.message } });
  });
});
