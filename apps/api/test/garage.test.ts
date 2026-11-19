import { CheckSchema, VehicleSummarySchema, type Check } from '@carcheck/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppOverrides } from '../src/app.js';
import type { Database } from '../src/db/client.js';
import {
  fieldSources,
  mileageReadings,
  motDefects,
  motTests,
  vehicleStatus,
  vehicles,
} from '../src/db/schema.js';
import { testDatabase } from './db.js';
import { testApp } from './helpers.js';

let app: FastifyInstance | undefined;
let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await close?.();
  close = undefined;
});

async function check(query: string): Promise<Check> {
  const res = await app!.inject({ method: 'POST', url: '/api/checks', payload: { query } });
  const id = res.json().check.id as string;
  await app!.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
  return CheckSchema.parse((await app!.inject({ method: 'GET', url: `/api/checks/${id}` })).json());
}

describe.each([
  ['memory', async (): Promise<AppOverrides> => ({})],
  [
    'postgres',
    async (): Promise<AppOverrides> => {
      const t = await testDatabase();
      close = t.close;
      return { db: t.db };
    },
  ],
])('garage (%s)', (_name, overrides) => {
  it('files each finished check under one vehicle', async () => {
    app = await testApp({}, await overrides());
    const first = await check('WX65ABC');
    const second = await check('wx65 abc');
    expect(first.vehicleId).toBeTruthy();
    expect(second.vehicleId).toBe(first.vehicleId);

    const res = await app.inject({ method: 'GET', url: `/api/vehicles/${first.vehicleId}` });
    const v = VehicleSummarySchema.parse(res.json());
    expect(v).toMatchObject({
      title: 'BMW 320D',
      registration: 'WX65ABC',
      latestCheckId: second.id,
      verdict: 'avoid',
      taxStatus: 'SORN',
      latestMileage: { odometer: { value: 91402, unit: 'mi' } },
      saved: null,
    });
    expect(v.concerns).toBeGreaterThan(0);
  });

  it('does not file a check with no record', async () => {
    app = await testApp({}, await overrides());
    expect((await check('BD25XYZ')).vehicleId).toBeNull();
  });

  it('saves, edits, lists and removes garage vehicles', async () => {
    app = await testApp({}, await overrides());
    const a = await check('WX65ABC');
    const b = await check('AB12CDE');
    const save = (id: string, payload: object) =>
      app!.inject({ method: 'POST', url: `/api/vehicles/${id}/notes`, payload });

    const saved = await save(a.vehicleId!, {
      notes: 'Dealer in Leeds, says new clutch',
      askingPricePence: 899500,
      listingUrl: 'https://example.com/listing/123',
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().saved).toMatchObject({ askingPricePence: 899500 });
    await save(b.vehicleId!, {});

    let list = (await app.inject({ method: 'GET', url: '/api/vehicles' })).json().vehicles;
    // The test clock is frozen, so both have the same timestamp: compare as a set.
    expect(list.map((v: { title: string }) => v.title).sort()).toEqual(['BMW 320D', 'FORD FOCUS']);

    const edited = await save(a.vehicleId!, { notes: 'Offered £8,500', askingPricePence: null });
    expect(edited.json().saved).toMatchObject({
      notes: 'Offered £8,500',
      askingPricePence: null,
      listingUrl: null,
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/vehicles/${b.vehicleId}/saved`,
    });
    expect(removed.statusCode).toBe(204);
    list = (await app.inject({ method: 'GET', url: '/api/vehicles' })).json().vehicles;
    expect(list.map((v: { id: string }) => v.id)).toEqual([a.vehicleId]);
  });

  it('rejects a listing link that is not http(s) and unknown vehicles', async () => {
    app = await testApp({}, await overrides());
    const a = await check('WX65ABC');
    const bad = await app.inject({
      method: 'POST',
      url: `/api/vehicles/${a.vehicleId}/notes`,
      payload: { listingUrl: 'javascript:alert(1)' },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/api/vehicles/00000000-0000-4000-8000-000000000000/notes',
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('normalised tables', () => {
  it('hold the latest check, rewritten on each new check', async () => {
    const t = await testDatabase();
    close = t.close;
    const db: Database = t.db;
    app = await testApp({}, { db });
    const first = await check('WX65ABC');
    const id = first.vehicleId!;

    const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id));
    expect(v).toMatchObject({ make: 'BMW', model: '320D', engineCc: 1995, verdict: 'avoid' });
    const [status] = await db.select().from(vehicleStatus).where(eq(vehicleStatus.vehicleId, id));
    expect(status).toMatchObject({
      taxStatus: 'SORN',
      motExpiry: first.record!.facts.motExpiryDate,
    });

    const tests = await db.select().from(motTests).where(eq(motTests.vehicleId, id));
    expect(tests).toHaveLength(first.record!.motTests.length);
    const defects = await db.select().from(motDefects);
    expect(defects.length).toBe(first.record!.motTests.reduce((n, t) => n + t.defects.length, 0));
    expect(defects.find((d) => d.dangerous)?.category).toBe('suspension');
    const readings = await db
      .select()
      .from(mileageReadings)
      .where(eq(mileageReadings.vehicleId, id));
    expect(readings).toHaveLength(first.record!.mileage.readings.length);
    const fields = await db.select().from(fieldSources).where(eq(fieldSources.vehicleId, id));
    expect(fields.find((f) => f.field === 'make')).toMatchObject({ source: 'dvla' });

    await check('WX65ABC');
    expect(await db.$count(vehicles)).toBe(1);
    expect(await db.$count(motTests)).toBe(first.record!.motTests.length);
  });
});
