import { z } from 'zod';

/** What a bought report said about one risk. `not_checked` when the report did not cover it. */
export const FlagStatusSchema = z
  .enum(['clear', 'recorded', 'not_checked'])
  .meta({ id: 'FlagStatus' });
export type FlagStatus = z.infer<typeof FlagStatusSchema>;

/**
 * Insurance write-off categories. A and B must never return to the road; S (structural) and
 * N (non-structural) replaced C and D in October 2017, which older reports still use.
 */
export const WriteOffCategorySchema = z
  .enum(['A', 'B', 'C', 'D', 'S', 'N'])
  .meta({ id: 'WriteOffCategory' });
export type WriteOffCategory = z.infer<typeof WriteOffCategorySchema>;

const isoDate = z.iso.date();

const Flag = z.object({
  status: FlagStatusSchema,
  /** Lender, police force, agreement type and so on, as the report gives it. */
  detail: z.string().trim().max(500).nullable().default(null),
});

export const PlateChangeSchema = z
  .object({
    from: z.string().trim().min(1).max(20),
    to: z.string().trim().min(1).max(20),
    date: isoDate.nullable().default(null),
  })
  .meta({ id: 'PlateChange' });
export type PlateChange = z.infer<typeof PlateChangeSchema>;

/** The findings typed in from one purchased report (HPI, Total Car Check, carVertical, …). */
export const ManualReportInputSchema = z
  .object({
    /** Which vehicle: at least one of these. Stored without spaces, upper case. */
    registration: z.string().trim().max(20).nullable().default(null),
    vin: z.string().trim().max(17).nullable().default(null),
    provider: z.string().trim().min(1).max(80),
    purchasedOn: isoDate,
    costPence: z.number().int().min(0).max(100_000),
    reference: z.string().trim().max(80).nullable().default(null),
    finance: Flag,
    stolen: Flag,
    writeOff: z.object({
      status: FlagStatusSchema,
      category: WriteOffCategorySchema.nullable().default(null),
      date: isoDate.nullable().default(null),
    }),
    scrapped: FlagStatusSchema.default('not_checked'),
    imported: FlagStatusSchema.default('not_checked'),
    exported: FlagStatusSchema.default('not_checked'),
    previousKeepers: z.number().int().min(0).max(99).nullable().default(null),
    /** Dates the registered keeper changed, as listed in the report. */
    keeperChanges: z.array(isoDate).max(50).default([]),
    plateChanges: z.array(PlateChangeSchema).max(20).default([]),
    notes: z.string().trim().max(2000).nullable().default(null),
  })
  .refine((r) => Boolean(r.registration || r.vin), {
    message: 'Give the registration, the VIN or both.',
    path: ['registration'],
  })
  .refine((r) => r.writeOff.status === 'recorded' || r.writeOff.category === null, {
    message: 'A write-off category only goes with a recorded write-off.',
    path: ['writeOff', 'category'],
  })
  .meta({ id: 'ManualReportBody' });
export type ManualReportInput = z.input<typeof ManualReportInputSchema>;
export type ManualReportFields = z.output<typeof ManualReportInputSchema>;

export const ManualReportSchema = z
  .object({
    id: z.string(),
    registration: z.string().nullable(),
    vin: z.string().nullable(),
    provider: z.string(),
    purchasedOn: z.string(),
    costPence: z.number().int(),
    reference: z.string().nullable(),
    finance: z.object({ status: FlagStatusSchema, detail: z.string().nullable() }),
    stolen: z.object({ status: FlagStatusSchema, detail: z.string().nullable() }),
    writeOff: z.object({
      status: FlagStatusSchema,
      category: WriteOffCategorySchema.nullable(),
      date: z.string().nullable(),
    }),
    scrapped: FlagStatusSchema,
    imported: FlagStatusSchema,
    exported: FlagStatusSchema,
    previousKeepers: z.number().int().nullable(),
    keeperChanges: z.array(z.string()),
    plateChanges: z.array(
      z.object({ from: z.string(), to: z.string(), date: z.string().nullable() }),
    ),
    notes: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'ManualReport' });
export type ManualReport = z.infer<typeof ManualReportSchema>;
