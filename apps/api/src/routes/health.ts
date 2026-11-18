import { SourceIdSchema } from '@carcheck/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SourceAdapter } from '../adapters/types.js';

export const HealthSchema = z
  .object({
    status: z.literal('ok'),
    mode: z.enum(['mock', 'live']),
    version: z.string(),
    storage: z.enum(['postgres', 'memory']),
    sources: z.array(
      z.object({
        id: SourceIdSchema,
        label: z.string(),
        available: z.boolean(),
        message: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'Health' });

export function healthRoutes(opts: {
  adapters: SourceAdapter[];
  mock: boolean;
  version: string;
  storage: 'postgres' | 'memory';
}): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/health',
      {
        schema: {
          tags: ['system'],
          summary: 'Liveness and source configuration',
          response: { 200: HealthSchema },
        },
      },
      async () => ({
        status: 'ok' as const,
        mode: opts.mock ? ('mock' as const) : ('live' as const),
        version: opts.version,
        storage: opts.storage,
        sources: opts.adapters.map((a) => {
          const message = a.unavailableReason(opts.mock);
          return { id: a.id, label: a.label, available: message === null, message };
        }),
      }),
    );
  };
}
