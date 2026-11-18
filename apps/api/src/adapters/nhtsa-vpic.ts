import type { Identifier } from '@carcheck/core';
import { z } from 'zod';
import type { AdapterContext, AdapterOutcome, SourceAdapter } from './types.js';
import { compact, expectStatus, nonEmpty, parseUpstream, titleCase, toInt } from './util.js';

const VpicResultSchema = z.looseObject({
  VIN: z.string().optional(),
  Make: z.string().optional(),
  Model: z.string().optional(),
  ModelYear: z.string().optional(),
  Trim: z.string().optional(),
  BodyClass: z.string().optional(),
  FuelTypePrimary: z.string().optional(),
  FuelTypeSecondary: z.string().optional(),
  DisplacementCC: z.string().optional(),
  EngineCylinders: z.string().optional(),
  PlantCountry: z.string().optional(),
  Seats: z.string().optional(),
  ErrorCode: z.string().optional(),
  ErrorText: z.string().optional(),
});

/** NHTSA vPIC `DecodeVinValues` response. Unknown values come back as empty strings. */
export const VpicResponseSchema = z.looseObject({
  Count: z.number(),
  Message: z.string().optional(),
  Results: z.array(VpicResultSchema),
});
export type VpicResponse = z.infer<typeof VpicResponseSchema>;

const FUELS: Record<string, string> = {
  GASOLINE: 'Petrol',
  ELECTRIC: 'Electric',
  DIESEL: 'Diesel',
};

function fuelName(value: string): string {
  return FUELS[value.toUpperCase()] ?? titleCase(value);
}

export function normaliseVpic(r: z.infer<typeof VpicResultSchema>) {
  const make = nonEmpty(r.Make);
  const primary = nonEmpty(r.FuelTypePrimary);
  const secondary = nonEmpty(r.FuelTypeSecondary);
  return compact({
    vin: nonEmpty(r.VIN),
    make: make ? make.toUpperCase() : undefined,
    model: nonEmpty(r.Model),
    variant: nonEmpty(r.Trim),
    bodyType: nonEmpty(r.BodyClass),
    fuelType: primary
      ? secondary
        ? `${fuelName(primary)}/${fuelName(secondary)}`
        : fuelName(primary)
      : undefined,
    engineCapacityCc: toInt(r.DisplacementCC),
    cylinders: toInt(r.EngineCylinders),
    modelYear: toInt(r.ModelYear),
    // `UNITED STATES (USA)` → `United States`
    plantCountry: r.PlantCountry
      ? titleCase(r.PlantCountry.replace(/\s*\(.*\)\s*$/, ''))
      : undefined,
    seats: toInt(r.Seats),
  });
}

export interface VpicOptions {
  baseUrl: string;
}

export class NhtsaVpicAdapter implements SourceAdapter {
  readonly id = 'nhtsa_vpic' as const;
  readonly label = 'NHTSA VIN decoder';

  constructor(private readonly options: VpicOptions) {}

  supports(identifier: Identifier): boolean {
    return identifier.kind === 'vin';
  }

  unavailableReason(): string | null {
    return null;
  }

  async lookup(identifier: Identifier, ctx: AdapterContext): Promise<AdapterOutcome> {
    const res = await ctx.http.request({
      method: 'GET',
      url: `${this.options.baseUrl}/api/vehicles/DecodeVinValues/${encodeURIComponent(identifier.value)}?format=json`,
      fixture: `nhtsa-vpic/${identifier.value}`,
      signal: ctx.signal,
    });
    if (res.status === 404) return { status: 'not_found' };
    expectStatus(res, 'NHTSA');
    const body = parseUpstream(VpicResponseSchema, res.body, 'NHTSA');
    const result = body.Results[0];
    // vPIC "succeeds" with empty fields for VINs it cannot decode; no make means nothing useful.
    if (!result || !nonEmpty(result.Make)) return { status: 'not_found' };
    return {
      status: 'ok',
      raw: res.body,
      contribution: { source: this.id, facts: normaliseVpic(result) },
    };
  }
}
