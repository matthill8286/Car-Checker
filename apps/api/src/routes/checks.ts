import {
  ApiErrorSchema,
  CheckSchema,
  CheckSummarySchema,
  CreateCheckBodySchema,
  type Check,
  type CheckEvent,
} from '@carcheck/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { CheckEvents } from '../checks/events.js';
import { InvalidQueryError, type CheckOrchestrator } from '../checks/orchestrator.js';
import type { CheckStore } from '../checks/store.js';

const CheckParamsSchema = z.object({ id: z.uuid() });

const CreatedCheckSchema = z
  .object({
    check: CheckSchema,
    links: z.object({ self: z.string(), stream: z.string() }),
  })
  .meta({ id: 'CreatedCheck' });

const HEARTBEAT_MS = 15_000;

function isFinished(check: Check): boolean {
  return check.status !== 'running';
}

function sse(event: CheckEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function checkRoutes(deps: {
  orchestrator: CheckOrchestrator;
  store: CheckStore;
  events: CheckEvents;
}): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      '/api/checks',
      {
        schema: {
          tags: ['checks'],
          summary: 'Start a check for a UK registration, Dutch plate or VIN',
          body: CreateCheckBodySchema,
          response: { 202: CreatedCheckSchema, 400: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        try {
          const { check } = await deps.orchestrator.start(request.body.query, request.body.hint, {
            fresh: request.body.fresh,
          });
          const self = `/api/checks/${check.id}`;
          return reply
            .code(202)
            .header('location', self)
            .send({ check, links: { self, stream: `${self}/stream` } });
        } catch (err) {
          if (err instanceof InvalidQueryError) {
            return reply
              .code(400)
              .send({ error: 'invalid_query', message: err.message, details: err.details });
          }
          throw err;
        }
      },
    );

    app.get(
      '/api/checks',
      {
        schema: {
          tags: ['checks'],
          summary: 'List recent checks, newest first',
          querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
          response: {
            200: z.object({ checks: z.array(CheckSummarySchema) }).meta({ id: 'CheckList' }),
          },
        },
      },
      async (request) => ({ checks: await deps.store.list(request.query.limit) }),
    );

    app.get(
      '/api/checks/:id',
      {
        schema: {
          tags: ['checks'],
          summary: 'Get a check and everything found so far',
          params: CheckParamsSchema,
          response: { 200: CheckSchema, 404: ApiErrorSchema },
        },
      },
      async (request, reply) => {
        const check = await deps.store.get(request.params.id);
        if (!check) return reply.code(404).send({ error: 'not_found', message: 'No such check.' });
        return check;
      },
    );

    const stream = async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      // Subscribe before reading the snapshot so nothing that happens in between is lost.
      const buffered: CheckEvent[] = [];
      let write: ((event: CheckEvent) => void) | null = null;
      const unsubscribe = deps.events.subscribe(id, (event) => {
        if (write) write(event);
        else buffered.push(event);
      });

      const snapshot = await deps.store.get(id);
      if (!snapshot) {
        unsubscribe();
        return reply.code(404).send({ error: 'not_found', message: 'No such check.' });
      }

      reply.hijack();
      const res = reply.raw;
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Stops nginx-style proxies from buffering the stream.
        'x-accel-buffering': 'no',
      });

      let closed = false;
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      };
      request.raw.on('close', close);

      res.write(sse({ type: 'snapshot', check: snapshot }));
      if (isFinished(snapshot)) {
        res.write(sse({ type: 'complete', check: snapshot }));
        close();
        return;
      }

      write = (event) => {
        if (closed) return;
        res.write(sse(event));
        if (event.type === 'complete') close();
      };
      for (const event of buffered.splice(0)) write(event);
    };

    app.get(
      '/api/checks/:id/stream',
      {
        schema: {
          tags: ['checks'],
          summary: 'Stream progress as server-sent events',
          description:
            'Sends `snapshot` first, then `source` and `record` events as each source answers, ' +
            'then `complete`, then closes. Each `data:` line is a JSON `CheckEvent`.',
          params: CheckParamsSchema,
          produces: ['text/event-stream'],
          response: {
            200: z.string().describe('text/event-stream of CheckEvent'),
            404: ApiErrorSchema,
          },
        },
      },
      stream,
    );

    // The path used before the build plan's name was adopted; kept so open tabs keep working.
    app.get(
      '/api/checks/:id/events',
      { schema: { hide: true, params: CheckParamsSchema } },
      stream,
    );
  };
}
