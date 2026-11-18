import { describe, expect, it } from 'vitest';
import type { Check } from '@/api/client';
import { applyEvent } from '@/components/checkState';

const run = (source: 'dvla' | 'dvsa_mot', status: Check['sources'][number]['status']) => ({
  source,
  label: source,
  status,
  message: null,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  mock: true,
  cached: false,
  fetchedAt: null,
});

const base: Check = {
  id: 'c1',
  query: 'AB12CDE',
  status: 'running',
  identifier: {
    kind: 'uk_reg',
    country: 'GB',
    value: 'AB12CDE',
    display: 'AB12 CDE',
    format: 'current',
    issuePeriod: null,
    northernIreland: false,
  },
  alternatives: [],
  sources: [run('dvla', 'running'), run('dvsa_mot', 'running')],
  record: null,
  createdAt: '2026-11-18T12:00:00Z',
  completedAt: null,
};

describe('applyEvent', () => {
  it('replaces a source run in place', () => {
    const next = applyEvent(base, { type: 'source', run: run('dvla', 'ok') });
    expect(next?.sources.map((s) => s.status)).toEqual(['ok', 'running']);
  });

  it('takes the snapshot and the final check wholesale', () => {
    const done = { ...base, status: 'complete' as const };
    expect(applyEvent(null, { type: 'snapshot', check: base as never })).toBe(base);
    expect(applyEvent(base, { type: 'complete', check: done as never })?.status).toBe('complete');
  });

  it('ignores progress before a snapshot', () => {
    expect(applyEvent(null, { type: 'source', run: run('dvla', 'ok') })).toBeNull();
  });
});
