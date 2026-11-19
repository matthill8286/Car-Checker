import { z } from 'zod';
import { OdometerSchema, SourceIdSchema } from './vehicle.js';

/** Must list the same ids, in the same order, as `DEFECT_CATEGORIES`. */
export const DefectCategorySchema = z
  .enum(['brakes', 'tyres', 'suspension', 'corrosion', 'lights', 'emissions', 'other'])
  .meta({ id: 'DefectCategory' });

export const InsightSeveritySchema = z
  .enum(['critical', 'warning', 'info', 'good'])
  .meta({ id: 'InsightSeverity' });
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>;

/** One finding a rule made, worded for a buyer. */
export const InsightSchema = z
  .object({
    /** Stable rule id, such as `mileage.rollback`; several insights can share one. */
    rule: z.string(),
    area: z.enum(['mileage', 'mot', 'defects', 'sources', 'status', 'provenance']),
    severity: InsightSeveritySchema,
    title: z.string(),
    detail: z.string().nullable(),
  })
  .meta({ id: 'Insight' });
export type Insight = z.infer<typeof InsightSchema>;

const Reading = z.object({ date: z.string(), odometer: OdometerSchema });

export const MileageStallSchema = z
  .object({ from: Reading, to: Reading, increase: z.number().int(), days: z.number().int() })
  .meta({ id: 'MileageStall' });
export type MileageStall = z.infer<typeof MileageStallSchema>;

export const ExpectedMileageSchema = z
  .object({
    /** Age at the latest reading, in years. */
    ageYears: z.number(),
    low: z.number().int(),
    typical: z.number().int(),
    high: z.number().int(),
    actual: z.number().int(),
    unit: z.enum(['mi', 'km']),
    position: z.enum(['low', 'typical', 'high']),
  })
  .meta({ id: 'ExpectedMileage' });
export type ExpectedMileage = z.infer<typeof ExpectedMileageSchema>;

export const MotLapseSchema = z
  .object({ from: z.string(), to: z.string(), days: z.number().int() })
  .meta({ id: 'MotLapse' });
export type MotLapse = z.infer<typeof MotLapseSchema>;

export const RepeatAdvisorySchema = z
  .object({
    /** The defect with sides and manual references removed, used to match across years. */
    item: z.string(),
    category: DefectCategorySchema,
    /** Number of separate test dates it appeared on. */
    tests: z.number().int(),
    dates: z.array(z.string()),
    latestText: z.string(),
  })
  .meta({ id: 'RepeatAdvisory' });
export type RepeatAdvisory = z.infer<typeof RepeatAdvisorySchema>;

export const SourceMismatchSchema = z
  .object({
    field: z.enum(['colour', 'fuelType', 'engineCapacityCc']),
    values: z.array(z.object({ source: SourceIdSchema, value: z.unknown() })),
  })
  .meta({ id: 'SourceMismatch' });
export type SourceMismatch = z.infer<typeof SourceMismatchSchema>;

export const VerdictSchema = z
  .object({
    rating: z.enum(['avoid', 'caution', 'good', 'unknown']),
    headline: z.string(),
    /** The critical and warning insights behind the rating, worst first. */
    reasons: z.array(InsightSchema),
  })
  .meta({ id: 'Verdict' });
export type Verdict = z.infer<typeof VerdictSchema>;

export const RecordInsightsSchema = z
  .object({
    mileage: z.object({
      stalls: z.array(MileageStallSchema),
      expected: ExpectedMileageSchema.nullable(),
    }),
    mot: z.object({
      lapses: z.array(MotLapseSchema),
      repeatAdvisories: z.array(RepeatAdvisorySchema),
    }),
    mismatches: z.array(SourceMismatchSchema),
    /** Every finding, worst first. */
    items: z.array(InsightSchema),
    verdict: VerdictSchema,
  })
  .meta({ id: 'RecordInsights' });
export type RecordInsights = z.infer<typeof RecordInsightsSchema>;
