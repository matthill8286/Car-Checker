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
import type { SourceAdapter } from '../adapters/types.js';
import { UpstreamError, type HttpClient } from '../http/client.js';
import type { CheckEvents } from './events.js';
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
  events: CheckEvents;
  log: FastifyBaseLogger;
  timeoutMs: number;
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
  async start(query: string, hint: QueryHint): Promise<{ check: Check; done: Promise<Check> }> {
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

    const done = this.run(check).catch(async (err: unknown) => {
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
        mock: this.deps.http.mock,
      });
      if (!reason) queued.push(adapter);
    }
    return queued;
  }

  private async run(check: Check): Promise<Check> {
    const contributions: SourceContribution[] = [];
    let round: Array<{ adapter: SourceAdapter; identifier: Identifier }> = this.deps.adapters
      .filter((a) => check.sources.some((s) => s.source === a.id && s.status === 'pending'))
      .map((adapter) => ({ adapter, identifier: check.identifier }));

    for (let i = 0; i < MAX_ROUNDS && round.length > 0; i++) {
      const discovered: Identifier[] = [];
      await Promise.all(
        round.map(async ({ adapter, identifier }) => {
          const found = await this.runOne(check, adapter, identifier, contributions);
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
    await this.deps.store.save(check);
    this.deps.events.publish(check.id, { type: 'complete', check: structuredClone(check) });
    return check;
  }

  private async runOne(
    check: Check,
    adapter: SourceAdapter,
    identifier: Identifier,
    contributions: SourceContribution[],
  ): Promise<Identifier[]> {
    const run = check.sources.find((s) => s.source === adapter.id);
    if (!run) return [];
    const started = Date.now();
    run.status = 'running';
    run.startedAt = this.now().toISOString();
    await this.publishRun(check, run);

    let discovered: Identifier[] = [];
    try {
      const outcome = await adapter.lookup(identifier, {
        http: this.deps.http,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
        now: this.now,
      });
      if (outcome.status === 'ok') {
        run.status = 'ok';
        contributions.push(outcome.contribution);
        discovered = outcome.discovered ?? [];
        check.record = mergeContributions(contributions);
      } else {
        run.status = 'not_found';
        run.message = `No record for ${identifier.display}.`;
      }
    } catch (err) {
      run.status = 'error';
      run.message = describeError(err, adapter.label);
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

export function finalStatus(runs: readonly SourceRun[]): CheckStatus {
  const ran = runs.filter((r) => r.status !== 'skipped');
  const errors = ran.filter((r) => r.status === 'error').length;
  if (ran.length === 0) return 'failed';
  if (errors === 0) return 'complete';
  return errors === ran.length ? 'failed' : 'partial';
}
