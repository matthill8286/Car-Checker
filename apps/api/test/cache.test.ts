import { describe, expect, it } from 'vitest';
import { cachePolicy, DEFAULT_CACHE_TTL_MS, NOT_FOUND_TTL_MS } from '../src/checks/cache.js';
import { InMemorySourceResponseStore } from '../src/checks/responses.js';
import { testApp } from './helpers.js';

describe('cachePolicy', () => {
  it('uses per-source TTLs and caps not-found', () => {
    const p = cachePolicy(true);
    expect(p.ttlMs('nhtsa_vpic', 'ok')).toBe(DEFAULT_CACHE_TTL_MS.nhtsa_vpic);
    expect(p.ttlMs('nhtsa_vpic', 'not_found')).toBe(NOT_FOUND_TTL_MS);
  });

  it('applies an override to every source', () => {
    expect(cachePolicy(true, 2).ttlMs('dvla', 'ok')).toBe(2 * 60 * 60 * 1000);
  });
});

describe('cache in memory mode', () => {
  it('can be switched off', async () => {
    const responses = new InMemorySourceResponseStore();
    const app = await testApp({ CACHE_ENABLED: 'false' }, { responses });
    for (let i = 0; i < 2; i++) {
      const id = (
        await app.inject({ method: 'POST', url: '/api/checks', payload: { query: 'ZK-472-T' } })
      ).json().check.id;
      await app.inject({ method: 'GET', url: `/api/checks/${id}/stream` });
      const check = (await app.inject({ method: 'GET', url: `/api/checks/${id}` })).json();
      expect(check.sources[0].cached).toBe(false);
    }
    await app.close();
  });
});
