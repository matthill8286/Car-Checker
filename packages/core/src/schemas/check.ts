import { z } from 'zod';
import { IdentifierSchema, QueryHintSchema } from './identifier.js';
import { SourceIdSchema, VehicleRecordSchema } from './vehicle.js';

export const CreateCheckBodySchema = z
  .object({
    query: z.string().trim().min(1).max(40),
    hint: QueryHintSchema.default('auto'),
  })
  .meta({ id: 'CreateCheckBody' });
export type CreateCheckBody = z.input<typeof CreateCheckBodySchema>;

export const SourceRunStatusSchema = z
  .enum(['pending', 'running', 'ok', 'not_found', 'error', 'skipped'])
  .meta({ id: 'SourceRunStatus' });
export type SourceRunStatus = z.infer<typeof SourceRunStatusSchema>;

export const SourceRunSchema = z
  .object({
    source: SourceIdSchema,
    label: z.string(),
    status: SourceRunStatusSchema,
    /** Why the source was skipped or failed, in words fit to show the user. */
    message: z.string().nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    /** True when the result came from recorded fixtures rather than the live API. */
    mock: z.boolean(),
  })
  .meta({ id: 'SourceRun' });
export type SourceRun = z.infer<typeof SourceRunSchema>;

export const CheckStatusSchema = z
  .enum(['running', 'complete', 'partial', 'failed'])
  .meta({ id: 'CheckStatus' });
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckSchema = z
  .object({
    id: z.string(),
    query: z.string(),
    status: CheckStatusSchema,
    identifier: IdentifierSchema,
    /** Other readings of the same input, such as a Dutch plate that is also a UK dateless mark. */
    alternatives: z.array(IdentifierSchema),
    sources: z.array(SourceRunSchema),
    record: VehicleRecordSchema.nullable(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .meta({ id: 'Check' });
export type Check = z.infer<typeof CheckSchema>;

/** Events on `GET /api/checks/:id/events`. Each SSE `event:` name matches `type`. */
export const CheckEventSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('snapshot'), check: CheckSchema }),
    z.object({ type: z.literal('source'), run: SourceRunSchema }),
    z.object({ type: z.literal('record'), record: VehicleRecordSchema }),
    z.object({ type: z.literal('complete'), check: CheckSchema }),
  ])
  .meta({ id: 'CheckEvent' });
export type CheckEvent = z.infer<typeof CheckEventSchema>;

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    details: z.array(z.string()).optional(),
  })
  .meta({ id: 'ApiError' });
export type ApiError = z.infer<typeof ApiErrorSchema>;
