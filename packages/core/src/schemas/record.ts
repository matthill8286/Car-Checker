import { z } from 'zod';
import { RecordInsightsSchema } from './insights.js';
import { ManualReportSchema } from './manual.js';
import {
  FactConflictSchema,
  MileageSummarySchema,
  MotTestSchema,
  SourceIdSchema,
  VehicleFactsSchema,
} from './vehicle.js';

export const VehicleRecordSchema = z
  .object({
    facts: VehicleFactsSchema,
    /** Which source supplied each fact that made it into `facts`. */
    provenance: z.record(z.string(), SourceIdSchema),
    conflicts: z.array(FactConflictSchema),
    motTests: z.array(MotTestSchema),
    mileage: MileageSummarySchema,
    /** Reports bought and typed in, newest first. Absent when none were found. */
    manualReports: z.array(ManualReportSchema).optional(),
    /** Rule findings and the overall verdict. Missing on checks saved before insights existed. */
    insights: RecordInsightsSchema.optional(),
  })
  .meta({ id: 'VehicleRecord' });
export type VehicleRecord = z.infer<typeof VehicleRecordSchema>;
