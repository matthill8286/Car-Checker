import type { FastifyBaseLogger } from 'fastify';
import PgBoss from 'pg-boss';
import type { JobName, JobResult } from './tasks.js';

export interface JobRun extends JobResult {
  startedAt: string;
  finishedAt: string;
  trigger: 'schedule' | 'manual';
}

export interface JobInfo {
  name: JobName;
  description: string;
  /** Cron expression in Europe/London time, or null when the job is only run by hand. */
  schedule: string | null;
  lastRun: JobRun | null;
}

export interface JobDefinition {
  name: JobName;
  description: string;
  schedule: string | null;
  task: () => Promise<JobResult>;
}

export const TIMEZONE = 'Europe/London';

/**
 * Holds the jobs, runs them on demand, and remembers each one's last run. With a Postgres
 * connection string, `start` hands the schedules to pg-boss so they survive restarts and only
 * one instance runs each tick; without one, jobs can still be run by hand.
 */
export class JobRunner {
  private readonly last = new Map<JobName, JobRun>();
  private readonly running = new Set<JobName>();
  private boss: PgBoss | null = null;

  constructor(
    private readonly jobs: readonly JobDefinition[],
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): JobInfo[] {
    return this.jobs.map((j) => ({
      name: j.name,
      description: j.description,
      schedule: this.boss ? j.schedule : null,
      lastRun: this.last.get(j.name) ?? null,
    }));
  }

  get scheduling(): boolean {
    return this.boss !== null;
  }

  async run(name: JobName, trigger: JobRun['trigger'] = 'manual'): Promise<JobRun> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`Unknown job ${name}`);
    if (this.running.has(name)) {
      throw new JobBusyError(name);
    }
    this.running.add(name);
    const startedAt = this.now().toISOString();
    let result: JobResult;
    try {
      result = await job.task();
    } catch (err) {
      result = { ok: false, summary: (err as Error).message, details: [] };
    } finally {
      this.running.delete(name);
    }
    const run: JobRun = { ...result, startedAt, finishedAt: this.now().toISOString(), trigger };
    this.last.set(name, run);
    this.log[run.ok ? 'info' : 'warn']({ job: name, ...run }, 'job finished');
    return run;
  }

  async start(connectionString: string): Promise<void> {
    const boss = new PgBoss({ connectionString, schema: 'pgboss' });
    boss.on('error', (err) => this.log.error({ err }, 'pg-boss error'));
    await boss.start();
    for (const job of this.jobs) {
      await boss.createQueue(job.name);
      if (job.schedule) {
        await boss.schedule(job.name, job.schedule, {}, { tz: TIMEZONE });
      } else {
        await boss.unschedule(job.name);
      }
      await boss.work(job.name, async () => {
        const run = await this.run(job.name, 'schedule');
        if (!run.ok) throw new Error(run.summary);
      });
    }
    this.boss = boss;
    this.log.info(
      { jobs: this.jobs.map((j) => ({ name: j.name, schedule: j.schedule })) },
      'job scheduler started',
    );
  }

  async stop(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
    this.boss = null;
  }
}

export class JobBusyError extends Error {
  constructor(name: string) {
    super(`Job ${name} is already running.`);
  }
}
