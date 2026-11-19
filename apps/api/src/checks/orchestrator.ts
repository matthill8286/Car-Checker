import { randomUUID } from 'node:crypto';
import {
  detectIdentifier,
  mergeContributions,
  type Check,
  type CheckStatus,
  type Identifier,
  type QueryHint,
  type SourceContribution,
  type SourceRun,
} from '@carcheck/core';
import type { FastifyBaseLogger } from 'fastify';
import type { AdapterOutcome, SourceAdapter } from '../adapters/types.js';
import { UpstreamError, type HttpClient } from '../http/client.js';
import type { CachePolicy } from './cache.js';
import type { CheckEvents } from './events.js';
import type { SourceResponseStore } from './responses.js';
import type { VehicleStore } from '../garage/store.js';
import type { CheckStore } from './store.js';

export class InvalidQueryError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
    this.name = 'InvalidQueryError';
  }
}

export interface OrchestratorDeps {
  adapters: SourceAdapter[];
  http: HttpClient;
  store: CheckStore;
  responses: SourceResponseStore;
  cache: CachePolicy;
  events: CheckEvents;
  log: FastifyBaseLogger;
  timeoutMs: number;
  /** Files finished checks under their vehicle (garage and normalised tables). */
  vehicles?: VehicleStore;
  now?: () => Date;
}

/** Most identifier chains are plate → VIN → VIN sources, so two follow-up rounds is plenty. */
const MAX_ROUNDS = 3;

export class CheckOrchestrator {
  private readonly now: () => Date;

  constructor(private readonly deps: OrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Validates the query, saves a running check and starts every applicable source in the
   * background. Returns as soon as the check is saved; progress arrives through `events`.
   */
  async start(
    query: string,
    hint: QueryHint,
    options: { fresh?: boolean } = {},
  ): Promise<{ check: Check; done: Promise<Check> }> {
    const detected = detectIdentifier(query, hint, this.now());
    if (!detected.ok) throw new InvalidQueryError(detected.message, detected.details);

    const check: Check = {
      id: randomUUID(),
      query,
      status: 'running',
      identifier: detected.identifier,
      alternatives: detected.alternatives,
      sources: [],
      record: null,
      createdAt: this.now().toISOString(),
      completedAt: null,
    };
    this.addRuns(check, detected.identifier);
    await this.deps.store.save(check);

    const done = this.run(check, options.fresh ?? false).catch(async (err: unknown) => {
      this.deps.log.error({ err, checkId: check.id }, 'check failed unexpectedly');
      check.status = 'failed';
      check.completedAt = this.now().toISOString();
      await this.deps.store.save(check);
      this.deps.events.publish(check.id, { type: 'complete', check: structuredClone(check) });
      return check;
    });
    return { check: structuredClone(check), done };
  }

  /** Adds a run for every adapter that handles this identifier and has not been queued yet. */
  private addRuns(check: Check, identifier: Identifier): SourceAdapter[] {
    const queued: SourceAdapter[] = [];
    for (const adapter of this.deps.adapters) {
      if (!adapter.supports(identifier)) continue;
      if (check.sources.some((s) => s.source === adapter.id)) continue;
      const reason = adapter.unavailableReason(this.deps.http.mock);
      check.sources.push({
        source: adapter.id,
        label: adapter.label,
        status: reason ? 'skipped' : 'pending',
        message: reason,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        // Local sources answer from our own data, never from fixtures.
        mock: adapter.cacheable === false ? false : this.deps.http.mock,
        cached: false,
        fetchedAt: null,
      });
      if (!reason) queued.push(adapter);
    }
    return queued;
  }

  private async run(check: Check, fresh: boolean): Promise<Check> {
    const contributions: SourceContribution[] = [];
    let round: Array<{ adapter: SourceAdapter; identifier: Identifier }> = this.deps.adapters
      .filter((a) => check.sources.some((s) => s.source === a.id && s.status === 'pending'))
      .map((adapter) => ({ adapter, identifier: check.identifier }));

    for (let i = 0; i < MAX_ROUNDS && round.length > 0; i++) {
      const discovered: Identifier[] = [];
      await Promise.all(
        round.map(async ({ adapter, identifier }) => {
          const found = await this.runOne(check, adapter, identifier, contributions, fresh);
          discovered.push(...found);
        }),
      );
      round = [];
      for (const identifier of discovered) {
        for (const adapter of this.addRuns(check, identifier)) round.push({ adapter, identifier });
      }
      if (round.length > 0) {
        await this.deps.store.save(check);
        for (const run of check.sources.filter(
          (s) => s.status === 'pending' || s.status === 'skipped',
        )) {
          this.deps.events.publish(check.id, { type: 'source', run: { ...run } });
        }
      }
    }

    check.status = finalStatus(check.sources);
    check.completedAt = this.now().toISOString();
    check.vehicleId = await this.fileVehicle(check);
    await this.deps.store.save(check);
    this.deps.events.publish(check.id, { type: 'complete', check: structuredClone(check) });
    return check;
  }

  private async runOne(
    check: Check,
    adapter: SourceAdapter,
    identifier: Identifier,
    contributions: SourceContribution[],
    fresh: boolean,
  ): Promise<Identifier[]> {
    const run = check.sources.find((s) => s.source === adapter.id);
    if (!run) return [];
    const started = Date.now();
    run.status = 'running';
    run.startedAt = this.now().toISOString();
    await this.publishRun(check, run);

    let discovered: Identifier[] = [];
    let asked = false;
    try {
      const cacheable = adapter.cacheable !== false;
      const cached = fresh || !cacheable ? null : await this.fromCache(adapter, identifier);
      let outcome: AdapterOutcome;
      if (cached) {
        outcome = cached.outcome;
        run.cached = true;
        run.fetchedAt = cached.fetchedAt.toISOString();
      } else {
        asked = true;
        outcome = await adapter.lookup(identifier, {
          http: this.deps.http,
          signal: AbortSignal.timeout(this.deps.timeoutMs),
          now: this.now,
        });
        run.fetchedAt = this.now().toISOString();
        if (cacheable) await this.remember(check, adapter, identifier, outcome);
      }
      if (outcome.status === 'ok') {
        run.status = 'ok';
        contributions.push(outcome.contribution);
        discovered = outcome.discovered ?? [];
        check.record = mergeContributions(contributions);
      } else {
        run.status = 'not_found';
        run.message =
          adapter.notFoundMessage?.(identifier) ?? `No record for ${identifier.display}.`;
      }
    } catch (err) {
      run.status = 'error';
      run.message = describeError(err, adapter.label);
      if (asked && adapter.cacheable !== false)
        await this.remember(check, adapter, identifier, { status: 'error', message: run.message });
      this.deps.log.warn({ err, source: adapter.id, checkId: check.id }, 'source failed');
    }
    run.finishedAt = this.now().toISOString();
    run.durationMs = Date.now() - started;
    await this.publishRun(check, run);
    if (run.status === 'ok' && check.record) {
      this.deps.events.publish(check.id, { type: 'record', record: structuredClone(check.record) });
    }
    return discovered;
  }

  /** A failure to file the vehicle must not fail the check; it just has no garage link. */
  private async fileVehicle(check: Check): Promise<string | null> {
    if (!this.deps.vehicles || !check.record) return null;
    try {
      return await this.deps.vehicles.project(check);
    } catch (err) {
      this.deps.log.warn({ err, checkId: check.id }, 'could not file vehicle');
      return null;
    }
  }

  /** The latest stored answer from this source, if it is still within its TTL. */
  private async fromCache(
    adapter: SourceAdapter,
    identifier: Identifier,
  ): Promise<{ outcome: AdapterOutcome; fetchedAt: Date } | null> {
    const { cache, responses, http, log } = this.deps;
    if (!cache.enabled) return null;
    const now = this.now().getTime();
    try {
      const hit = await responses.latest({
        source: adapter.id,
        identifier,
        mock: http.mock,
        notBefore: new Date(now - cache.ttlMs(adapter.id, 'ok')),
      });
      if (!hit || hit.outcome === 'error') return null;
      if (now - hit.fetchedAt.getTime() > cache.ttlMs(adapter.id, hit.outcome)) return null;
      if (hit.outcome === 'not_found' || !hit.contribution) {
        return { outcome: { status: 'not_found' }, fetchedAt: hit.fetchedAt };
      }
      return {
        outcome: {
          status: 'ok',
          contribution: hit.contribution,
          raw: hit.raw,
          discovered: hit.discovered,
        },
        fetchedAt: hit.fetchedAt,
      };
    } catch (err) {
      // A cache that cannot be read is a miss, not a failed source.
      log.warn({ err, source: adapter.id }, 'cache lookup failed');
      return null;
    }
  }

  /** Logs what the source said, or that it failed. A failure here must not fail the check. */
  private async remember(
    check: Check,
    adapter: SourceAdapter,
    identifier: Identifier,
    outcome: AdapterOutcome | { status: 'error'; message: string },
  ): Promise<void> {
    try {
      await this.deps.responses.record({
        source: adapter.id,
        identifier: { kind: identifier.kind, value: identifier.value },
        outcome: outcome.status,
        raw:
          outcome.status === 'ok'
            ? outcome.raw
            : outcome.status === 'error'
              ? { message: outcome.message }
              : null,
        contribution: outcome.status === 'ok' ? outcome.contribution : null,
        discovered: outcome.status === 'ok' ? (outcome.discovered ?? []) : [],
        mock: this.deps.http.mock,
        fetchedAt: this.now(),
        checkId: check.id,
      });
    } catch (err) {
      this.deps.log.warn(
        { err, source: adapter.id, checkId: check.id },
        'could not store response',
      );
    }
  }

  private async publishRun(check: Check, run: SourceRun): Promise<void> {
    await this.deps.store.save(check);
    this.deps.events.publish(check.id, { type: 'source', run: { ...run } });
  }
}

function describeError(err: unknown, label: string): string {
  if (err instanceof UpstreamError) return err.message;
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `${label} did not answer in time.`;
  }
  return `${label} could not be reached.`;
}

/**
 * Complete, partial or failed, judged on the outside sources. Bought reports are always there
 * to read, so they cannot rescue a check where no outside source could run.
 */
export function finalStatus(runs: readonly SourceRun[]): CheckStatus {
  const ran = runs.filter((r) => r.status !== 'skipped' && r.source !== 'manual');
  const errors = ran.filter((r) => r.status === 'error').length;
  if (ran.length === 0) return 'failed';
  if (errors === 0) return 'complete';
  return errors === ran.length ? 'failed' : 'partial';
}
