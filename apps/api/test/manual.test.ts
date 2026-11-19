import { CheckSchema, ManualReportSchema, type Check } from '@carcheck/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppOverrides } from '../src/app.js';
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

const body = {
  registration: 'wx65 abc',
  provider: 'HPI Check',
  purchasedOn: '2026-11-17',
  costPence: 1999,
  reference: 'HPI-123',
  finance: { status: 'recorded', detail: 'Black Horse, PCP' },
  stolen: { status: 'clear' },
  writeOff: { status: 'recorded', category: 'S', date: '2023-08-14' },
  previousKeepers: 4,
  keeperChanges: ['2021-02-01', '2018-06-10'],
  plateChanges: [{ from: 'm4 ttx', to: 'WX65ABC', date: '2019-01-05' }],
};

async function finished(id: string): Promise<Check> {
  await app!.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
  return CheckSchema.parse((await app!.inject({ method: 'GET', url: `/api/checks/${id}` })).json());
}

async function check(query: string): Promise<Check> {
  const res = await app!.inject({ method: 'POST', url: '/api/checks', payload: { query } });
  return finished(res.json().check.id);
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
])('bought reports (%s)', (_name, overrides) => {
  it('creates, lists, updates and deletes a report', async () => {
    app = await testApp({}, await overrides());
    const created = await app.inject({ method: 'POST', url: '/api/manual-reports', payload: body });
    expect(created.statusCode).toBe(201);
    const report = ManualReportSchema.parse(created.json());
    expect(report).toMatchObject({
      registration: 'WX65ABC',
      vin: null,
      scrapped: 'not_checked',
      keeperChanges: ['2018-06-10', '2021-02-01'],
      plateChanges: [{ from: 'M4TTX', to: 'WX65ABC', date: '2019-01-05' }],
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/manual-reports?registration=WX65 ABC',
    });
    expect(list.json().reports.map((r: { id: string }) => r.id)).toEqual([report.id]);

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/manual-reports/${report.id}`,
      payload: { ...body, finance: { status: 'clear' } },
    });
    expect(updated.json()).toMatchObject({
      id: report.id,
      finance: { status: 'clear', detail: null },
    });
    expect(updated.json().createdAt).toBe(report.createdAt);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/manual-reports/${report.id}` });
    expect(deleted.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: `/api/manual-reports/${report.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('puts a bought report into the next check, alongside the free data', async () => {
    app = await testApp({}, await overrides());
    const before = await check('WX65ABC');
    expect(before.sources.find((s) => s.source === 'manual')).toMatchObject({
      status: 'not_found',
      message: 'No bought reports saved for WX65 ABC.',
    });

    await app.inject({ method: 'POST', url: '/api/manual-reports', payload: body });
    const after = await check('WX65ABC');
    expect(after.sources.find((s) => s.source === 'manual')).toMatchObject({
      status: 'ok',
      cached: false,
    });
    expect(after.record?.facts.make).toBe('BMW');
    expect(after.record?.manualReports).toHaveLength(1);
    const rules = after.record?.insights?.items.map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(['provenance.finance', 'provenance.write_off']));
    expect(after.record?.insights?.verdict.rating).toBe('avoid');
  });
});

describe('bought report validation', () => {
  it('rejects a report with no registration or VIN', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/manual-reports',
      payload: { ...body, registration: null },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
  });

  it('needs a registration or VIN to list', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/manual-reports' });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown report', async () => {
    app = await testApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/manual-reports/00000000-0000-4000-8000-000000000000',
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });
});
