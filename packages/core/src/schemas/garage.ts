import { z } from 'zod';
import type { Check } from './check.js';
import { IdentifierSchema } from './identifier.js';
import { OdometerSchema } from './vehicle.js';

/** What the user keeps about a vehicle they are considering. */
export const SaveVehicleBodySchema = z
  .object({
    notes: z.string().trim().max(4000).nullable().default(null),
    /** Asking price in pence, so £8,995 is 899500. */
    askingPricePence: z.number().int().min(0).max(100_000_000).nullable().default(null),
    listingUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .nullable()
      .default(null),
  })
  .meta({ id: 'SaveVehicleBody' });
export type SaveVehicleBody = z.input<typeof SaveVehicleBodySchema>;
export type SaveVehicleFields = z.output<typeof SaveVehicleBodySchema>;

export const SavedDetailsSchema = z
  .object({
    notes: z.string().nullable(),
    askingPricePence: z.number().int().nullable(),
    listingUrl: z.string().nullable(),
    savedAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: 'SavedDetails' });
export type SavedDetails = z.infer<typeof SavedDetailsSchema>;

/** One vehicle, as of its latest finished check, plus what the user saved about it. */
export const VehicleSummarySchema = z
  .object({
    id: z.string(),
    identifier: IdentifierSchema,
    title: z.string().nullable(),
    registration: z.string().nullable(),
    vin: z.string().nullable(),
    colour: z.string().nullable(),
    fuelType: z.string().nullable(),
    firstRegistrationDate: z.string().nullable(),
    latestCheckId: z.string(),
    checkedAt: z.string(),
    verdict: z.enum(['avoid', 'caution', 'good', 'unknown']).nullable(),
    /** Number of critical and warning findings behind the verdict. */
    concerns: z.number().int(),
    taxStatus: z.string().nullable(),
    motStatus: z.string().nullable(),
    motExpiryDate: z.string().nullable(),
    latestMileage: z.object({ date: z.string(), odometer: OdometerSchema }).nullable(),
    saved: SavedDetailsSchema.nullable(),
  })
  .meta({ id: 'VehicleSummary' });
export type VehicleSummary = z.infer<typeof VehicleSummarySchema>;

/** The vehicle-level facts of a finished check, without the garage fields. */
export function vehicleFromCheck(check: Check): Omit<VehicleSummary, 'id' | 'saved'> {
  const r = check.record;
  const f = r?.facts ?? {};
  const title = [f.make, f.model].filter(Boolean).join(' ') || null;
  return {
    identifier: check.identifier,
    title,
    registration:
      f.registration ?? (check.identifier.kind === 'vin' ? null : check.identifier.value),
    vin: f.vin ?? (check.identifier.kind === 'vin' ? check.identifier.value : null),
    colour: f.colour ?? null,
    fuelType: f.fuelType ?? null,
    firstRegistrationDate: f.firstRegistrationDate ?? null,
    latestCheckId: check.id,
    checkedAt: check.completedAt ?? check.createdAt,
    verdict: r?.insights?.verdict.rating ?? null,
    concerns: r?.insights?.verdict.reasons.length ?? 0,
    taxStatus: f.taxStatus ?? null,
    motStatus: f.motStatus ?? null,
    motExpiryDate: f.motExpiryDate ?? null,
    latestMileage: r?.mileage.latest ?? null,
  };
}
