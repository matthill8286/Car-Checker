import type { Identifier } from '@carcheck/core';
import { z } from 'zod';
import type { AdapterContext, AdapterOutcome, SourceAdapter } from './types.js';
import { compact, expectStatus, parseUpstream } from './util.js';

/** DVLA Vehicle Enquiry Service response. Fields are optional because DVLA omits unknowns. */
export const DvlaVehicleSchema = z.looseObject({
  registrationNumber: z.string(),
  taxStatus: z.string().optional(),
  taxDueDate: z.string().optional(),
  artEndDate: z.string().optional(),
  motStatus: z.string().optional(),
  motExpiryDate: z.string().optional(),
  make: z.string().optional(),
  monthOfFirstRegistration: z.string().optional(),
  monthOfFirstDvlaRegistration: z.string().optional(),
  yearOfManufacture: z.number().int().optional(),
  engineCapacity: z.number().int().optional(),
  co2Emissions: z.number().optional(),
  fuelType: z.string().optional(),
  markedForExport: z.boolean().optional(),
  colour: z.string().optional(),
  typeApproval: z.string().optional(),
  wheelplan: z.string().optional(),
  revenueWeight: z.number().optional(),
  euroStatus: z.string().optional(),
  realDrivingEmissions: z.string().optional(),
  dateOfLastV5CIssued: z.string().optional(),
});
export type DvlaVehicle = z.infer<typeof DvlaVehicleSchema>;

export interface DvlaOptions {
  apiKey?: string;
  baseUrl: string;
}

export function normaliseDvla(v: DvlaVehicle) {
  return compact({
    registration: v.registrationNumber,
    country: 'GB' as const,
    make: v.make,
    colour: v.colour,
    fuelType: v.fuelType,
    engineCapacityCc: v.engineCapacity,
    co2EmissionsGKm: v.co2Emissions,
    euroStatus: v.euroStatus,
    yearOfManufacture: v.yearOfManufacture,
    // DVLA gives only the month (`2012-04`), which is still a valid partial ISO date.
    firstRegistrationDate: v.monthOfFirstRegistration,
    taxStatus: v.taxStatus,
    taxDueDate: v.taxDueDate,
    motStatus: v.motStatus,
    motExpiryDate: v.motExpiryDate,
    markedForExport: v.markedForExport,
  });
}

export class DvlaAdapter implements SourceAdapter {
  readonly id = 'dvla' as const;
  readonly label = 'DVLA vehicle record';

  constructor(private readonly options: DvlaOptions) {}

  supports(identifier: Identifier): boolean {
    return identifier.kind === 'uk_reg';
  }

  unavailableReason(mock: boolean): string | null {
    if (mock || this.options.apiKey) return null;
    return 'DVLA API key not configured.';
  }

  async lookup(identifier: Identifier, ctx: AdapterContext): Promise<AdapterOutcome> {
    const res = await ctx.http.request({
      method: 'POST',
      url: `${this.options.baseUrl}/v1/vehicles`,
      headers: { 'x-api-key': this.options.apiKey ?? '' },
      body: { registrationNumber: identifier.value },
      fixture: `dvla/${identifier.value}`,
      signal: ctx.signal,
    });
    // DVLA answers 404 for unknown registrations and 400 for malformed ones.
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    expectStatus(res, 'DVLA');
    const vehicle = parseUpstream(DvlaVehicleSchema, res.body, 'DVLA');
    return {
      status: 'ok',
      raw: res.body,
      contribution: { source: this.id, facts: normaliseDvla(vehicle) },
    };
  }
}
