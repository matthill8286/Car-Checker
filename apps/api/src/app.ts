import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  hasZodFastifySchemaValidationErrors,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createAdapters } from './adapters/registry.js';
import type { SourceAdapter } from './adapters/types.js';
import { cachePolicy } from './checks/cache.js';
import { CheckEvents } from './checks/events.js';
import { CheckOrchestrator } from './checks/orchestrator.js';
import {
  InMemorySourceResponseStore,
  PostgresSourceResponseStore,
  type SourceResponseStore,
} from './checks/responses.js';
import { InMemoryCheckStore, PostgresCheckStore, type CheckStore } from './checks/store.js';
import type { Config } from './config.js';
import { connect, type Database } from './db/client.js';
import { FetchHttpClient, FixtureHttpClient, type HttpClient } from './http/client.js';
import { JobRunner } from './jobs/runner.js';
import { refreshSaved, sourceKeepAlive } from './jobs/tasks.js';
import { checkRoutes } from './routes/checks.js';
import { jobRoutes } from './routes/jobs.js';
import { healthRoutes } from './routes/health.js';
import { manualRoutes } from './routes/manual.js';
import { vehicleRoutes } from './routes/vehicles.js';
import { InMemoryVehicleStore, PostgresVehicleStore, type VehicleStore } from './garage/store.js';
import {
  InMemoryManualReportStore,
  PostgresManualReportStore,
  type ManualReportStore,
} from './manual/store.js';

export const VERSION = '0.1.0';

export interface AppOverrides {
  http?: HttpClient;
  adapters?: SourceAdapter[];
  /** A ready Drizzle database (tests pass PGlite). Takes precedence over DATABASE_URL. */
  db?: Database;
  store?: CheckStore;
  responses?: SourceResponseStore;
  manualReports?: ManualReportStore;
  vehicles?: VehicleStore;
  now?: () => Date;
  /** Start the pg-boss scheduler when DATABASE_URL is set. Default true; tests turn it off. */
  scheduleJobs?: boolean;
  /** Simulated latency per fixture request, so the UI can show sources arriving one by one. */
  fixtureLatencyMs?: number;
}

export async function buildApp(
  config: Config,
  overrides: AppOverrides = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Lets the reverse proxy's X-Forwarded-* headers through.
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send({
        error: 'invalid_request',
        message: 'The request did not match the schema.',
        details: err.validation.map((v) => `${v.instancePath || '/'} ${v.message ?? ''}`.trim()),
      });
    }
    request.log.error({ err }, 'unhandled error');
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({
      error: status === 500 ? 'internal_error' : 'request_error',
      message: status === 500 ? 'Something went wrong.' : err.message,
    });
  });

  const origins = config.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length > 0) await app.register(cors, { origin: origins });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Car Check API',
        version: VERSION,
        description:
          'Pre-purchase vehicle checks merged from DVLA, DVSA, RDW and NHTSA, plus bought reports typed in by hand.',
      },
      tags: [{ name: 'checks' }, { name: 'manual' }, { name: 'garage' }, { name: 'system' }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  app.get('/api/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  const mock = config.CARCHECK_MODE === 'mock';
  const http =
    overrides.http ??
    (mock
      ? new FixtureHttpClient(config.FIXTURES_DIR, overrides.fixtureLatencyMs ?? 0)
      : new FetchHttpClient());
  let db = overrides.db;
  if (!db && config.DATABASE_URL) {
    const connection = await connect(config.DATABASE_URL, { migrate: config.DB_MIGRATE });
    db = connection.db;
    app.addHook('onClose', connection.close);
  }
  const manualReports =
    overrides.manualReports ??
    (db
      ? new PostgresManualReportStore(db, overrides.now)
      : new InMemoryManualReportStore(overrides.now));
  const adapters = overrides.adapters ?? createAdapters(config, manualReports);
  const storage = db ? ('postgres' as const) : ('memory' as const);
  const store = overrides.store ?? (db ? new PostgresCheckStore(db) : new InMemoryCheckStore());
  const responses =
    overrides.responses ??
    (db ? new PostgresSourceResponseStore(db) : new InMemorySourceResponseStore());
  const vehicles =
    overrides.vehicles ??
    (db ? new PostgresVehicleStore(db, overrides.now) : new InMemoryVehicleStore(overrides.now));
  const events = new CheckEvents();
  const orchestrator = new CheckOrchestrator({
    adapters,
    http,
    store,
    responses,
    cache: cachePolicy(config.CACHE_ENABLED, config.CACHE_TTL_HOURS),
    events,
    log: app.log,
    timeoutMs: config.SOURCE_TIMEOUT_MS,
    vehicles,
    now: overrides.now,
  });

  const now = overrides.now ?? (() => new Date());
  const runner = new JobRunner(
    [
      {
        name: 'source-keepalive',
        description: 'Looks up one registration at DVLA and DVSA so neither API key goes idle.',
        schedule: config.KEEPALIVE_CRON,
        task: () =>
          sourceKeepAlive({
            adapters,
            http,
            registration: config.KEEPALIVE_REG,
            timeoutMs: config.SOURCE_TIMEOUT_MS,
            now,
          }),
      },
      {
        name: 'refresh-saved',
        description: 'Runs a new check for every vehicle in the garage.',
        schedule: config.REFRESH_CRON ?? null,
        task: () => refreshSaved({ vehicles, orchestrator, log: app.log }),
      },
    ],
    app.log,
    now,
  );
  if (config.JOBS_ENABLED && config.DATABASE_URL && (overrides.scheduleJobs ?? true)) {
    const url = config.DATABASE_URL;
    app.addHook('onReady', async () => {
      try {
        await runner.start(url);
      } catch (err) {
        app.log.error({ err }, 'job scheduler failed to start; jobs can still be run by hand');
      }
    });
    app.addHook('onClose', () => runner.stop());
  }

  await app.register(healthRoutes({ adapters, mock: http.mock, version: VERSION, storage }));
  await app.register(checkRoutes({ orchestrator, store, events }));
  await app.register(manualRoutes({ store: manualReports }));
  await app.register(vehicleRoutes({ store: vehicles }));
  await app.register(jobRoutes({ runner }));

  return app;
}
