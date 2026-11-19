import { detectIdentifier, type QueryHint, type SourceId } from '@carcheck/core';
import type { FastifyBaseLogger } from 'fastify';
import type { SourceAdapter } from '../adapters/types.js';
import type { CheckOrchestrator } from '../checks/orchestrator.js';
import type { VehicleStore } from '../garage/store.js';
import type { HttpClient } from '../http/client.js';

export const JOB_NAMES = ['source-keepalive', 'refresh-saved'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobResult {
  ok: boolean;
  summary: string;
  details: Array<{ item: string; outcome: string }>;
}

/** Sources whose keys are deleted or revoked after a period without use. */
const KEEPALIVE_SOURCES: readonly SourceId[] = ['dvla', 'dvsa_mot'];

/**
 * One lookup against each keyed UK source, so an idle key is never revoked (DVSA after 90 days,
 * DVLA likewise). Goes straight to the adapters, skipping the cache, so the upstream call is
 * real. A "not found" still counts: the key was accepted.
 */
export async function sourceKeepAlive(deps: {
  adapters: readonly SourceAdapter[];
  http: HttpClient;
  registration: string;
  timeoutMs: number;
  now: () => Date;
}): Promise<JobResult> {
  const detected = detectIdentifier(deps.registration, 'GB', deps.now());
  if (!detected.ok) {
    return {
      ok: false,
      summary: `Keep-alive registration "${deps.registration}" is not a valid UK reg.`,
      details: [],
    };
  }
  const details: JobResult['details'] = [];
  let ok = true;
  for (const adapter of deps.adapters.filter((a) => KEEPALIVE_SOURCES.includes(a.id))) {
    const reason = adapter.unavailableReason(deps.http.mock);
    if (reason) {
      details.push({ item: adapter.label, outcome: `skipped: ${reason}` });
      continue;
    }
    try {
      const out = await adapter.lookup(detected.identifier, {
        http: deps.http,
        signal: AbortSignal.timeout(deps.timeoutMs),
        now: deps.now,
      });
      details.push({
        item: adapter.label,
        outcome: out.status === 'ok' ? 'ok' : 'not found (key accepted)',
      });
    } catch (err) {
      ok = false;
      details.push({ item: adapter.label, outcome: `failed: ${(err as Error).message}` });
    }
  }
  const used = details.filter((d) => !d.outcome.startsWith('skipped')).length;
  return {
    ok,
    summary: ok ? `Used ${used} source key${used === 1 ? '' : 's'}.` : 'A source key call failed.',
    details,
  };
}

const HINT: Record<'uk_reg' | 'nl_plate' | 'vin', QueryHint> = {
  uk_reg: 'GB',
  nl_plate: 'NL',
  vin: 'VIN',
};

/** Runs a new check for every saved vehicle, one at a time, so the garage stays current. */
export async function refreshSaved(deps: {
  vehicles: VehicleStore;
  orchestrator: CheckOrchestrator;
  log: FastifyBaseLogger;
}): Promise<JobResult> {
  const saved = await deps.vehicles.listSaved();
  const details: JobResult['details'] = [];
  for (const v of saved) {
    try {
      const { done } = await deps.orchestrator.start(v.identifier.value, HINT[v.identifier.kind]);
      const check = await done;
      details.push({ item: v.identifier.display, outcome: check.status });
    } catch (err) {
      deps.log.warn({ err, vehicleId: v.id }, 'refresh of saved vehicle failed');
      details.push({ item: v.identifier.display, outcome: `failed: ${(err as Error).message}` });
    }
  }
  const failed = details.filter((d) => d.outcome.startsWith('failed')).length;
  return {
    ok: failed === 0,
    summary:
      saved.length === 0
        ? 'No saved vehicles.'
        : `Refreshed ${saved.length - failed} of ${saved.length} saved vehicle${saved.length === 1 ? '' : 's'}.`,
    details,
  };
}
