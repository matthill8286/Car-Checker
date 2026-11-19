import type { SourceId } from '@carcheck/core';

const HOUR = 60 * 60 * 1000;

/**
 * How long a source's answer is reused before asking again. Tax and MOT status can change
 * any day, so the UK registers are kept for a day; a VIN decode never changes. A "not found"
 * is kept briefly, since a newly registered vehicle can appear within hours.
 */
export const DEFAULT_CACHE_TTL_MS: Record<SourceId, number> = {
  dvla: 24 * HOUR,
  dvsa_mot: 24 * HOUR,
  rdw: 24 * HOUR,
  nhtsa_vpic: 30 * 24 * HOUR,
  // Bought reports live in our own database; the manual adapter is never cached.
  manual: 0,
};

export const NOT_FOUND_TTL_MS = HOUR;

export interface CachePolicy {
  enabled: boolean;
  ttlMs: (source: SourceId, outcome: 'ok' | 'not_found') => number;
}

export function cachePolicy(enabled: boolean, ttlHoursOverride?: number): CachePolicy {
  return {
    enabled,
    ttlMs: (source, outcome) => {
      const ttl =
        ttlHoursOverride !== undefined ? ttlHoursOverride * HOUR : DEFAULT_CACHE_TTL_MS[source];
      return outcome === 'not_found' ? Math.min(ttl, NOT_FOUND_TTL_MS) : ttl;
    },
  };
}
