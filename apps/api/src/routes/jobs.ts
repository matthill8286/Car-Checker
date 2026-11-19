import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiErrorSchema } from '@carcheck/core';
import { JobBusyError, type JobRunner } from '../jobs/runner.js';
import { JOB_NAMES } from '../jobs/tasks.js';

const JobNameSchema = z.enum(JOB_NAMES).meta({ id: 'JobName' });

export const JobRunSchema = z
  .object({
    ok: z.boolean(),
    summary: z.string(),
    details: z.array(z.object({ item: z.string(), outcome: z.string() })),
    startedAt: z.string(),
    finishedAt: z.string(),
    trigger: z.enum(['schedule', 'manual']),
  })
  .meta({ id: 'JobRun' });

export const JobInfoSchema = z
  .object({
    name: JobNameSchema,
    description: z.string(),
    schedule: z.string().nullable(),
    lastRun: JobRunSchema.nullable(),
  })
  .meta({ id: 'JobInfo' });

export function jobRoutes(opts: { runner: JobRunner }): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/jobs',
      {
        schema: {
          tags: ['system'],
          summary: 'Background jobs, their schedules and last runs',
          response: {
            200: z.object({ scheduling: z.boolean(), jobs: z.array(JobInfoSchema) }),
          },
        },
      },
      async () => ({ scheduling: opts.runner.scheduling, jobs: opts.runner.list() }),
    );

    app.post(
      '/api/jobs/:name/run',
      {
        schema: {
          tags: ['system'],
          summary: 'Run a job now and wait for it to finish',
          params: z.object({ name: JobNameSchema }),
          response: { 200: JobRunSchema, 409: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        try {
          return await opts.runner.run(request.params.name);
        } catch (err) {
          if (err instanceof JobBusyError) {
            return reply.code(409).send({ error: 'job_running', message: err.message });
          }
          throw err;
        }
      },
    );
  };
}
