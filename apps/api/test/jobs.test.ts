import { CheckSchema, VehicleSummarySchema } from '@carcheck/core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function finishedCheck(query: string) {
  const res = await app!.inject({ method: 'POST', url: '/api/checks', payload: { query } });
  const id = res.json().check.id as string;
  await app!.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
  return CheckSchema.parse((await app!.inject({ method: 'GET', url: `/api/checks/${id}` })).json());
}

describe('jobs', () => {
  it('lists both jobs, unscheduled without Postgres', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scheduling).toBe(false);
    expect(body.jobs.map((j: { name: string }) => j.name)).toEqual([
      'source-keepalive',
      'refresh-saved',
    ]);
    expect(body.jobs.every((j: { lastRun: unknown }) => j.lastRun === null)).toBe(true);
  });

  it('keep-alive calls DVLA and DVSA and records the run', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/api/jobs/source-keepalive/run' });
    expect(res.statusCode).toBe(200);
    const run = res.json();
    expect(run.ok).toBe(true);
    expect(run.trigger).toBe('manual');
    expect(run.details.map((d: { item: string }) => d.item).sort()).toEqual([
      'DVLA vehicle record',
      'DVSA MOT history',
    ]);
    const list = (await app.inject({ method: 'GET', url: '/api/jobs' })).json();
    expect(list.jobs[0].lastRun.summary).toBe(run.summary);
  });

  it('keep-alive skips sources without keys in live mode', async () => {
    app = await testApp({ CARCHECK_MODE: 'live' });
    const run = (
      await app.inject({ method: 'POST', url: '/api/jobs/source-keepalive/run' })
    ).json();
    expect(run.ok).toBe(true);
    expect(run.details.every((d: { outcome: string }) => d.outcome.startsWith('skipped'))).toBe(
      true,
    );
  });

  it('keep-alive reports a bad registration', async () => {
    app = await testApp({ KEEPALIVE_REG: 'NOT A REG!!' });
    const run = (
      await app.inject({ method: 'POST', url: '/api/jobs/source-keepalive/run' })
    ).json();
    expect(run.ok).toBe(false);
    expect(run.summary).toMatch(/not a valid UK reg/);
  });

  it('refresh-saved re-checks every saved vehicle', async () => {
    app = await testApp();
    const empty = (await app.inject({ method: 'POST', url: '/api/jobs/refresh-saved/run' })).json();
    expect(empty.summary).toBe('No saved vehicles.');

    const first = await finishedCheck('AB12CDE');
    await app.inject({
      method: 'POST',
      url: `/api/vehicles/${first.vehicleId}/notes`,
      payload: { notes: 'Keep an eye on it' },
    });
    const run = (await app.inject({ method: 'POST', url: '/api/jobs/refresh-saved/run' })).json();
    expect(run.ok).toBe(true);
    expect(run.summary).toBe('Refreshed 1 of 1 saved vehicle.');
    expect(run.details).toEqual([{ item: 'AB12 CDE', outcome: 'complete' }]);

    const vehicle = VehicleSummarySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/vehicles/${first.vehicleId}` })).json(),
    );
    expect(vehicle.latestCheckId).not.toBe(first.id);
    expect(vehicle.saved?.notes).toBe('Keep an eye on it');
  });

  it('rejects an unknown job', async () => {
    app = await testApp();
    const res = await app.inject({ method: 'POST', url: '/api/jobs/nope/run' });
    expect(res.statusCode).toBe(400);
  });
});
