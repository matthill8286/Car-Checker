import { CheckSchema, CheckEventSchema, type Check } from '@carcheck/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSse, testApp } from './helpers.js';

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function startCheck(query: string, hint?: string) {
  const res = await app.inject({ method: 'POST', url: '/api/checks', payload: { query, hint } });
  return res;
}

async function finished(id: string): Promise<Check> {
  // The orchestrator runs in the background; the SSE stream closes once it completes.
  await app.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
  const res = await app.inject({ method: 'GET', url: `/api/checks/${id}` });
  return CheckSchema.parse(res.json());
}

describe('GET /api/health', () => {
  it('reports mock mode and every source', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', mode: 'mock' });
    expect(res.json().sources.map((s: { id: string }) => s.id)).toEqual([
      'dvla',
      'dvsa_mot',
      'rdw',
      'nhtsa_vpic',
      'manual',
    ]);
  });

  it('says which live sources lack keys', async () => {
    app = await testApp({ CARCHECK_MODE: 'live' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    const sources = res.json().sources as Array<{ id: string; available: boolean }>;
    expect(Object.fromEntries(sources.map((s) => [s.id, s.available]))).toEqual({
      dvla: false,
      dvsa_mot: false,
      rdw: true,
      nhtsa_vpic: true,
      manual: true,
    });
  });
});

describe('POST /api/checks', () => {
  it('starts a check and returns links', async () => {
    app = await testApp();
    const res = await startCheck('ab12 cde');
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.check).toMatchObject({
      query: 'ab12 cde',
      status: 'running',
      identifier: { kind: 'uk_reg', value: 'AB12CDE', display: 'AB12 CDE' },
    });
    expect(body.links.stream).toBe(`/api/checks/${body.check.id}/stream`);
    expect(res.headers.location).toBe(`/api/checks/${body.check.id}`);
  });

  it('rejects input that is not a plate or VIN', async () => {
    app = await testApp();
    const res = await startCheck('not a car');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_query' });
  });

  it('rejects a body that does not match the schema', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/api/checks', payload: { hint: 'GB' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('honours the hint for an ambiguous plate', async () => {
    app = await testApp();
    const res = await startCheck('A12BCD', 'NL');
    expect(res.json().check.identifier.kind).toBe('nl_plate');
  });
});

describe('GET /api/checks/:id', () => {
  it('returns the merged record once sources finish', async () => {
    app = await testApp();
    const check = await finished((await startCheck('WX65ABC')).json().check.id);
    expect(check.status).toBe('complete');
    expect(check.sources.map((s) => [s.source, s.status, s.mock])).toEqual([
      ['dvla', 'ok', true],
      ['dvsa_mot', 'ok', true],
      ['manual', 'not_found', false],
    ]);
    expect(check.record?.facts).toMatchObject({ make: 'BMW', model: '320D', taxStatus: 'SORN' });
    expect(check.record?.provenance).toMatchObject({ make: 'dvla', model: 'dvsa_mot' });
    expect(check.record?.mileage.anomalies).toHaveLength(1);
    expect(check.record?.motTests[0]?.defects.some((d) => d.dangerous)).toBe(true);
  });

  it('is partial when one source fails', async () => {
    app = await testApp();
    const check = await finished((await startCheck('ER12ROR')).json().check.id);
    expect(check.status).toBe('partial');
    expect(check.sources.find((s) => s.source === 'dvla')).toMatchObject({
      status: 'error',
      message: 'DVLA returned HTTP 500.',
    });
    expect(check.record?.facts.make).toBe('VAUXHALL');
  });

  it('is complete with no record when nobody knows the vehicle', async () => {
    app = await testApp();
    const check = await finished((await startCheck('BD25XYZ')).json().check.id);
    expect(check.status).toBe('complete');
    expect(check.record).toBeNull();
    expect(check.sources.every((s) => s.status === 'not_found')).toBe(true);
  });

  it('skips sources without keys in live mode and fails if nothing can run', async () => {
    app = await testApp({ CARCHECK_MODE: 'live' });
    const check = await finished((await startCheck('AB12CDE')).json().check.id);
    expect(check.status).toBe('failed');
    expect(check.sources.map((s) => s.status)).toEqual(['skipped', 'skipped', 'not_found']);
  });

  it('runs the Dutch and VIN sources', async () => {
    app = await testApp();
    const nl = await finished((await startCheck('ZK-472-T')).json().check.id);
    expect(nl.sources.map((s) => s.source)).toEqual(['rdw', 'manual']);
    expect(nl.record?.facts.country).toBe('NL');
    const vin = await finished((await startCheck('1HGCM82633A004352')).json().check.id);
    expect(vin.sources.map((s) => s.source)).toEqual(['nhtsa_vpic', 'manual']);
    expect(vin.record?.facts.modelYear).toBe(2003);
  });

  it('404s for an unknown check', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/checks/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/checks/:id/stream', () => {
  it('streams snapshot, source and record events, then complete', async () => {
    app = await testApp({}, { fixtureLatencyMs: 20 });
    const id = (await startCheck('AB12CDE')).json().check.id;
    const res = await app.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body);
    for (const e of events) CheckEventSchema.parse(e.data);
    const types = events.map((e) => e.event);
    expect(types[0]).toBe('snapshot');
    expect(types.at(-1)).toBe('complete');
    expect(types).toContain('record');
    const finishedRuns = events
      .filter((e) => e.event === 'source')
      .map((e) => (e.data as { run: { source: string; status: string } }).run)
      .filter((r) => r.status === 'ok')
      .map((r) => r.source)
      .sort();
    expect(finishedRuns).toEqual(['dvla', 'dvsa_mot']);
  });

  it('replays a finished check and closes', async () => {
    app = await testApp();
    const id = (await startCheck('LN74NEW')).json().check.id;
    await finished(id);
    const res = await app.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
    expect(parseSse(res.body).map((e) => e.event)).toEqual(['snapshot', 'complete']);
  });

  it('still answers on the old /events path', async () => {
    app = await testApp();
    const id = (await startCheck('LN74NEW')).json().check.id;
    await finished(id);
    const res = await app.inject({ method: 'GET', url: `/api/checks/${id}/events` });
    expect(parseSse(res.body).map((e) => e.event)).toEqual(['snapshot', 'complete']);
  });

  it('404s for an unknown check', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/checks/00000000-0000-4000-8000-000000000000/stream',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('OpenAPI', () => {
  it('documents every route with named schemas', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    const doc = res.json();
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/checks',
      '/api/checks/{id}',
      '/api/checks/{id}/stream',
      '/api/health',
      '/api/jobs',
      '/api/jobs/{name}/run',
      '/api/manual-reports',
      '/api/manual-reports/{id}',
      '/api/vehicles',
      '/api/vehicles/{id}',
      '/api/vehicles/{id}/notes',
      '/api/vehicles/{id}/saved',
    ]);
    expect(doc.components.schemas).toHaveProperty('Check');
    expect(doc.components.schemas).toHaveProperty('VehicleRecord');
  });
});
