import { z } from 'zod';
import { CountryCodeSchema } from './identifier.js';

export const SourceIdSchema = z
  .enum(['dvla', 'dvsa_mot', 'rdw', 'nhtsa_vpic'])
  .meta({ id: 'SourceId' });
export type SourceId = z.infer<typeof SourceIdSchema>;

export const DefectTypeSchema = z
  .enum([
    'advisory',
    'minor',
    'major',
    'dangerous',
    'fail',
    'prs',
    'non_specific',
    'system_generated',
    'user_entered',
  ])
  .meta({ id: 'DefectType' });
export type DefectType = z.infer<typeof DefectTypeSchema>;

export const DefectSchema = z
  .object({ text: z.string(), type: DefectTypeSchema, dangerous: z.boolean() })
  .meta({ id: 'Defect' });
export type Defect = z.infer<typeof DefectSchema>;

export const OdometerSchema = z
  .object({ value: z.number().int().nonnegative(), unit: z.enum(['mi', 'km']) })
  .meta({ id: 'Odometer' });
export type Odometer = z.infer<typeof OdometerSchema>;

export const MotTestSchema = z
  .object({
    testNumber: z.string().nullable(),
    completedAt: z.string(),
    result: z.enum(['passed', 'failed']),
    expiryDate: z.string().nullable(),
    odometer: OdometerSchema.nullable(),
    odometerResult: z.enum(['read', 'unreadable', 'no_odometer']),
    defects: z.array(DefectSchema),
    source: SourceIdSchema,
  })
  .meta({ id: 'MotTest' });
export type MotTest = z.infer<typeof MotTestSchema>;

/** Scalar facts any source can contribute. Every field is optional. */
export const VehicleFactsSchema = z
  .object({
    registration: z.string(),
    vin: z.string(),
    country: CountryCodeSchema,
    make: z.string(),
    model: z.string(),
    variant: z.string(),
    bodyType: z.string(),
    colour: z.string(),
    fuelType: z.string(),
    engineCapacityCc: z.number().int(),
    cylinders: z.number().int(),
    co2EmissionsGKm: z.number(),
    euroStatus: z.string(),
    massEmptyKg: z.number().int(),
    seats: z.number().int(),
    yearOfManufacture: z.number().int(),
    modelYear: z.number().int(),
    firstRegistrationDate: z.string(),
    lastKeeperChangeDate: z.string(),
    plantCountry: z.string(),
    taxStatus: z.string(),
    taxDueDate: z.string(),
    motStatus: z.string(),
    motExpiryDate: z.string(),
    markedForExport: z.boolean(),
    outstandingRecall: z.enum(['yes', 'no', 'unknown']),
    insured: z.boolean(),
    listPriceEur: z.number(),
  })
  .partial()
  .meta({ id: 'VehicleFacts' });
export type VehicleFacts = z.infer<typeof VehicleFactsSchema>;
export type FactKey = keyof VehicleFacts;

export const FactConflictSchema = z
  .object({
    field: z.string(),
    values: z.array(z.object({ source: SourceIdSchema, value: z.unknown() })),
  })
  .meta({ id: 'FactConflict' });
export type FactConflict = z.infer<typeof FactConflictSchema>;

export const MileageAnomalySchema = z
  .object({
    kind: z.enum(['decrease', 'unit_change']),
    from: z.object({ date: z.string(), odometer: OdometerSchema }),
    to: z.object({ date: z.string(), odometer: OdometerSchema }),
    message: z.string(),
  })
  .meta({ id: 'MileageAnomaly' });
export type MileageAnomaly = z.infer<typeof MileageAnomalySchema>;

export const MileageSummarySchema = z
  .object({
    readings: z.array(z.object({ date: z.string(), odometer: OdometerSchema })),
    latest: z.object({ date: z.string(), odometer: OdometerSchema }).nullable(),
    averagePerYear: z.number().int().nullable(),
    unit: z.enum(['mi', 'km']).nullable(),
    anomalies: z.array(MileageAnomalySchema),
  })
  .meta({ id: 'MileageSummary' });
export type MileageSummary = z.infer<typeof MileageSummarySchema>;
