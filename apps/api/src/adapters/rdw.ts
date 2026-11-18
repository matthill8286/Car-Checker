import type { Identifier } from '@carcheck/core';
import { z } from 'zod';
import type { AdapterContext, AdapterOutcome, SourceAdapter } from './types.js';
import { compact, expectStatus, nonEmpty, parseUpstream, titleCase, toInt } from './util.js';

/** RDW "Gekentekende voertuigen" (m9d7-ebf2). Socrata returns every value as a string. */
export const RdwVehicleSchema = z.looseObject({
  kenteken: z.string(),
  voertuigsoort: z.string().optional(),
  merk: z.string().optional(),
  handelsbenaming: z.string().optional(),
  vervaldatum_apk: z.string().optional(),
  datum_tenaamstelling: z.string().optional(),
  inrichting: z.string().optional(),
  aantal_zitplaatsen: z.string().optional(),
  eerste_kleur: z.string().optional(),
  aantal_cilinders: z.string().optional(),
  cilinderinhoud: z.string().optional(),
  massa_ledig_voertuig: z.string().optional(),
  datum_eerste_toelating: z.string().optional(),
  catalogusprijs: z.string().optional(),
  wam_verzekerd: z.string().optional(),
  export_indicator: z.string().optional(),
  openstaande_terugroepactie_indicator: z.string().optional(),
  variant: z.string().optional(),
  uitvoering: z.string().optional(),
});
export type RdwVehicle = z.infer<typeof RdwVehicleSchema>;

/** RDW "Gekentekende voertuigen brandstof" (8ys7-d773): one row per fuel. */
export const RdwFuelSchema = z.looseObject({
  kenteken: z.string(),
  brandstof_volgnummer: z.string().optional(),
  brandstof_omschrijving: z.string().optional(),
  co2_uitstoot_gecombineerd: z.string().optional(),
  emissiecode_omschrijving: z.string().optional(),
  uitlaatemissieniveau: z.string().optional(),
});
export type RdwFuel = z.infer<typeof RdwFuelSchema>;

const COLOURS: Record<string, string> = {
  BEIGE: 'Beige',
  BLAUW: 'Blue',
  BRUIN: 'Brown',
  CREME: 'Cream',
  DIVERSEN: 'Multi-colour',
  GEEL: 'Yellow',
  GRIJS: 'Grey',
  GROEN: 'Green',
  ORANJE: 'Orange',
  PAARS: 'Purple',
  ROOD: 'Red',
  ROSE: 'Pink',
  WIT: 'White',
  ZWART: 'Black',
};

const FUELS: Record<string, string> = {
  BENZINE: 'Petrol',
  DIESEL: 'Diesel',
  ELEKTRICITEIT: 'Electric',
  LPG: 'LPG',
  CNG: 'CNG',
  LNG: 'LNG',
  WATERSTOF: 'Hydrogen',
  ALCOHOL: 'Ethanol',
};

/** `20150301` → `2015-03-01`. */
function rdwDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{8}$/.test(value)) return undefined;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function yesNo(value: string | undefined): boolean | undefined {
  if (value === 'Ja') return true;
  if (value === 'Nee') return false;
  return undefined;
}

function describeFuels(fuels: RdwFuel[]): string | undefined {
  const names = [...fuels]
    .sort((a, b) => Number(a.brandstof_volgnummer ?? 0) - Number(b.brandstof_volgnummer ?? 0))
    .map((f) => nonEmpty(f.brandstof_omschrijving))
    .filter((f): f is string => f !== undefined)
    .map((f) => FUELS[f.toUpperCase()] ?? f);
  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.join('/')} hybrid`;
}

export function normaliseRdw(v: RdwVehicle, fuels: RdwFuel[], today: Date) {
  const apk = rdwDate(v.vervaldatum_apk);
  const colour = nonEmpty(v.eerste_kleur);
  const recall = yesNo(v.openstaande_terugroepactie_indicator);
  const co2 = fuels.map((f) => toInt(f.co2_uitstoot_gecombineerd)).find((n) => n !== undefined);
  const euro = fuels
    .map((f) => nonEmpty(f.uitlaatemissieniveau ?? f.emissiecode_omschrijving))
    .find(Boolean);
  const exported = yesNo(v.export_indicator);
  const firstAdmission = rdwDate(v.datum_eerste_toelating);
  return compact({
    registration: v.kenteken,
    country: 'NL' as const,
    make: nonEmpty(v.merk),
    model: nonEmpty(v.handelsbenaming),
    variant: nonEmpty(v.uitvoering),
    bodyType: v.inrichting ? titleCase(v.inrichting) : undefined,
    colour: colour ? (COLOURS[colour.toUpperCase()] ?? titleCase(colour)) : undefined,
    fuelType: describeFuels(fuels),
    engineCapacityCc: toInt(v.cilinderinhoud),
    cylinders: toInt(v.aantal_cilinders),
    co2EmissionsGKm: co2,
    euroStatus: euro,
    massEmptyKg: toInt(v.massa_ledig_voertuig),
    seats: toInt(v.aantal_zitplaatsen),
    firstRegistrationDate: firstAdmission,
    lastKeeperChangeDate: rdwDate(v.datum_tenaamstelling),
    motExpiryDate: apk,
    motStatus: apk ? (apk >= today.toISOString().slice(0, 10) ? 'Valid' : 'Expired') : undefined,
    markedForExport: exported,
    outstandingRecall:
      recall === undefined ? undefined : recall ? ('yes' as const) : ('no' as const),
    insured: yesNo(v.wam_verzekerd),
    listPriceEur: toInt(v.catalogusprijs),
  });
}

export interface RdwOptions {
  appToken?: string;
  baseUrl: string;
}

export class RdwAdapter implements SourceAdapter {
  readonly id = 'rdw' as const;
  readonly label = 'RDW vehicle register (NL)';

  constructor(private readonly options: RdwOptions) {}

  supports(identifier: Identifier): boolean {
    return identifier.kind === 'nl_plate';
  }

  unavailableReason(): string | null {
    return null; // Open data; no key needed.
  }

  private headers(): Record<string, string> {
    return this.options.appToken ? { 'x-app-token': this.options.appToken } : {};
  }

  async lookup(identifier: Identifier, ctx: AdapterContext): Promise<AdapterOutcome> {
    const plate = encodeURIComponent(identifier.value);
    const [vehicleRes, fuelRes] = await Promise.all([
      ctx.http.request({
        method: 'GET',
        url: `${this.options.baseUrl}/resource/m9d7-ebf2.json?kenteken=${plate}`,
        headers: this.headers(),
        fixture: `rdw/${identifier.value}`,
        signal: ctx.signal,
      }),
      ctx.http.request({
        method: 'GET',
        url: `${this.options.baseUrl}/resource/8ys7-d773.json?kenteken=${plate}`,
        headers: this.headers(),
        fixture: `rdw/${identifier.value}.fuel`,
        signal: ctx.signal,
      }),
    ]);
    if (vehicleRes.status === 404) return { status: 'not_found' };
    expectStatus(vehicleRes, 'RDW');
    const vehicles = parseUpstream(z.array(RdwVehicleSchema), vehicleRes.body, 'RDW');
    const vehicle = vehicles[0];
    if (!vehicle) return { status: 'not_found' };
    // Fuel is a nice-to-have; a failure there should not sink the whole source.
    const fuels =
      fuelRes.status < 400 ? (z.array(RdwFuelSchema).safeParse(fuelRes.body).data ?? []) : [];
    return {
      status: 'ok',
      raw: { vehicle: vehicleRes.body, fuel: fuelRes.body },
      contribution: { source: this.id, facts: normaliseRdw(vehicle, fuels, ctx.now()) },
    };
  }
}
