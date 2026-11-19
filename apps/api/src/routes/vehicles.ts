import { ApiErrorSchema, SaveVehicleBodySchema, VehicleSummarySchema } from '@carcheck/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { VehicleStore } from '../garage/store.js';

const Params = z.object({ id: z.uuid() });
const notFound = { error: 'not_found', message: 'No such vehicle.' } as const;

/** The garage (M7): vehicles from finished checks, and the ones the user is considering. */
export function vehicleRoutes(deps: { store: VehicleStore }): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/vehicles',
      {
        schema: {
          tags: ['garage'],
          summary: 'Saved vehicles, most recently edited first',
          response: {
            200: z.object({ vehicles: z.array(VehicleSummarySchema) }).meta({ id: 'VehicleList' }),
          },
        },
      },
      async () => ({ vehicles: await deps.store.listSaved() }),
    );

    app.get(
      '/api/vehicles/:id',
      {
        schema: {
          tags: ['garage'],
          summary: 'A vehicle as of its latest check',
          params: Params,
          response: { 200: VehicleSummarySchema, 404: ApiErrorSchema },
        },
      },
      async (request, reply) =>
        (await deps.store.get(request.params.id)) ?? reply.code(404).send(notFound),
    );

    app.post(
      '/api/vehicles/:id/notes',
      {
        schema: {
          tags: ['garage'],
          summary: 'Save a vehicle to the garage with notes, asking price and listing link',
          description: 'Saving again replaces the notes, price and link.',
          params: Params,
          body: SaveVehicleBodySchema,
          response: { 200: VehicleSummarySchema, 400: ApiErrorSchema, 404: ApiErrorSchema },
        },
      },
      async (request, reply) =>
        (await deps.store.save(request.params.id, request.body)) ?? reply.code(404).send(notFound),
    );

    app.delete(
      '/api/vehicles/:id/saved',
      {
        schema: {
          tags: ['garage'],
          summary: 'Remove a vehicle from the garage',
          params: Params,
          response: { 204: z.null(), 404: ApiErrorSchema },
        },
      },
      async (request, reply) =>
        (await deps.store.unsave(request.params.id))
          ? reply.code(204).send(null)
          : reply.code(404).send(notFound),
    );
  };
}
