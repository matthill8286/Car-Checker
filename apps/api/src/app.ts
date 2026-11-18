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
import { CheckEvents } from './checks/events.js';
import { CheckOrchestrator } from './checks/orchestrator.js';
import { InMemoryCheckStore, type CheckStore } from './checks/store.js';
import type { Config } from './config.js';
import { FetchHttpClient, FixtureHttpClient, type HttpClient } from './http/client.js';
import { checkRoutes } from './routes/checks.js';
import { healthRoutes } from './routes/health.js';

export const VERSION = '0.1.0';

export interface AppOverrides {
  http?: HttpClient;
  adapters?: SourceAdapter[];
  store?: CheckStore;
  now?: () => Date;
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
        description: 'Pre-purchase vehicle checks merged from DVLA, DVSA, RDW and NHTSA.',
      },
      tags: [{ name: 'checks' }, { name: 'system' }],
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
  const adapters = overrides.adapters ?? createAdapters(config);
  const store = overrides.store ?? new InMemoryCheckStore();
  const events = new CheckEvents();
  const orchestrator = new CheckOrchestrator({
    adapters,
    http,
    store,
    events,
    log: app.log,
    timeoutMs: config.SOURCE_TIMEOUT_MS,
    now: overrides.now,
  });

  await app.register(healthRoutes({ adapters, mock: http.mock, version: VERSION }));
  await app.register(checkRoutes({ orchestrator, store, events }));

  return app;
}
