import { ApiErrorSchema, ManualReportInputSchema, ManualReportSchema } from '@carcheck/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ManualReportStore } from '../manual/store.js';

const Params = z.object({ id: z.uuid() });
const ReportList = z
  .object({ reports: z.array(ManualReportSchema) })
  .meta({ id: 'ManualReportList' });
const notFound = { error: 'not_found', message: 'No such bought report.' } as const;

/**
 * Bought reports typed in by hand (M6). A check picks them up through the manual source, so
 * after saving one the client starts a new check to see it merged with the free data.
 */
export function manualRoutes(deps: { store: ManualReportStore }): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/manual-reports',
      {
        schema: {
          tags: ['manual'],
          summary: 'Bought reports for a vehicle, newest first',
          querystring: z
            .object({
              registration: z.string().max(20).optional(),
              vin: z.string().max(17).optional(),
            })
            .refine((q) => q.registration || q.vin, { message: 'Give registration or vin.' }),
          response: { 200: ReportList, 400: ApiErrorSchema },
        },
      },
      async (request) => ({ reports: await deps.store.find(request.query) }),
    );

    app.post(
      '/api/manual-reports',
      {
        schema: {
          tags: ['manual'],
          summary: 'Record the findings of a bought report',
          body: ManualReportInputSchema,
          response: { 201: ManualReportSchema, 400: ApiErrorSchema },
        },
      },
      async (request, reply) => reply.code(201).send(await deps.store.create(request.body)),
    );

    app.get(
      '/api/manual-reports/:id',
      {
        schema: {
          tags: ['manual'],
          summary: 'One bought report',
          params: Params,
          response: { 200: ManualReportSchema, 404: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        const report = await deps.store.get(request.params.id);
        return report ?? reply.code(404).send(notFound);
      },
    );

    app.put(
      '/api/manual-reports/:id',
      {
        schema: {
          tags: ['manual'],
          summary: 'Correct a bought report',
          params: Params,
          body: ManualReportInputSchema,
          response: { 200: ManualReportSchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        const report = await deps.store.update(request.params.id, request.body);
        return report ?? reply.code(404).send(notFound);
      },
    );

    app.delete(
      '/api/manual-reports/:id',
      {
        schema: {
          tags: ['manual'],
          summary: 'Delete a bought report',
          params: Params,
          response: { 204: z.null(), 404: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        const deleted = await deps.store.delete(request.params.id);
        return deleted ? reply.code(204).send(null) : reply.code(404).send(notFound);
      },
    );
  };
}
