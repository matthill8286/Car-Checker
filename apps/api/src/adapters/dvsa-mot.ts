import type { Defect, DefectType, Identifier, MotTest } from '@carcheck/core';
import { z } from 'zod';
import { UpstreamError, type HttpClient } from '../http/client.js';
import type { AdapterContext, AdapterOutcome, SourceAdapter } from './types.js';
import { compact, expectStatus, nonEmpty, parseUpstream, toInt } from './util.js';

const DvsaDefectSchema = z.looseObject({
  text: z.string(),
  type: z.string(),
  dangerous: z.boolean().optional(),
});

const DvsaMotTestSchema = z.looseObject({
  completedDate: z.string(),
  testResult: z.string(),
  expiryDate: z.string().nullish(),
  odometerValue: z.union([z.string(), z.number()]).nullish(),
  odometerUnit: z.string().nullish(),
  odometerResultType: z.string().nullish(),
  motTestNumber: z.string().nullish(),
  dataSource: z.string().nullish(),
  defects: z.array(DvsaDefectSchema).nullish(),
});

/** DVSA MOT History API (`/v1/trade/vehicles/registration/{reg}`) response. */
export const DvsaVehicleSchema = z.looseObject({
  registration: z.string(),
  make: z.string().nullish(),
  model: z.string().nullish(),
  firstUsedDate: z.string().nullish(),
  fuelType: z.string().nullish(),
  primaryColour: z.string().nullish(),
  registrationDate: z.string().nullish(),
  manufactureDate: z.string().nullish(),
  engineSize: z.union([z.string(), z.number()]).nullish(),
  hasOutstandingRecall: z.string().nullish(),
  motTestDueDate: z.string().nullish(),
  motTests: z.array(DvsaMotTestSchema).nullish(),
});
export type DvsaVehicle = z.infer<typeof DvsaVehicleSchema>;

const TokenSchema = z.looseObject({ access_token: z.string(), expires_in: z.number() });

const DEFECT_TYPES: Record<string, DefectType> = {
  ADVISORY: 'advisory',
  MINOR: 'minor',
  MAJOR: 'major',
  DANGEROUS: 'dangerous',
  FAIL: 'fail',
  PRS: 'prs',
  'NON SPECIFIC': 'non_specific',
  'SYSTEM GENERATED': 'system_generated',
  'USER ENTERED': 'user_entered',
};

function normaliseDefect(d: z.infer<typeof DvsaDefectSchema>): Defect {
  const type = DEFECT_TYPES[d.type.toUpperCase()] ?? 'non_specific';
  return { text: d.text, type, dangerous: d.dangerous ?? type === 'dangerous' };
}

function normaliseTest(t: z.infer<typeof DvsaMotTestSchema>): MotTest {
  const value = toInt(t.odometerValue);
  const resultType = (t.odometerResultType ?? '').toUpperCase();
  const odometerResult =
    resultType === 'READ' ? 'read' : resultType === 'NO_ODOMETER' ? 'no_odometer' : 'unreadable';
  return {
    testNumber: nonEmpty(t.motTestNumber) ?? null,
    completedAt: t.completedDate,
    result: t.testResult.toUpperCase().startsWith('PASS') ? 'passed' : 'failed',
    expiryDate: nonEmpty(t.expiryDate) ?? null,
    odometer:
      odometerResult === 'read' && value !== undefined
        ? { value, unit: (t.odometerUnit ?? '').toUpperCase() === 'KM' ? 'km' : 'mi' }
        : null,
    odometerResult,
    defects: (t.defects ?? []).map(normaliseDefect),
    source: 'dvsa_mot',
  };
}

export function normaliseDvsa(v: DvsaVehicle) {
  const recall = (v.hasOutstandingRecall ?? '').toLowerCase();
  return {
    facts: compact({
      registration: v.registration,
      country: 'GB' as const,
      make: nonEmpty(v.make),
      model: nonEmpty(v.model),
      colour: nonEmpty(v.primaryColour),
      fuelType: nonEmpty(v.fuelType),
      engineCapacityCc: toInt(v.engineSize),
      firstRegistrationDate: nonEmpty(v.firstUsedDate ?? v.registrationDate),
      outstandingRecall:
        recall === 'yes'
          ? ('yes' as const)
          : recall === 'no'
            ? ('no' as const)
            : ('unknown' as const),
    }),
    motTests: (v.motTests ?? []).map(normaliseTest),
  };
}

export interface DvsaOptions {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  tokenUrl?: string;
  scope: string;
  baseUrl: string;
}

/** Caches the OAuth2 client-credentials token until shortly before it expires. */
class TokenCache {
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly options: DvsaOptions) {}

  async get(http: HttpClient, signal: AbortSignal, now: number): Promise<string> {
    if (this.token && this.token.expiresAt > now) return this.token.value;
    this.pending ??= this.fetch(http, signal, now).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetch(http: HttpClient, signal: AbortSignal, now: number): Promise<string> {
    const res = await http.request({
      method: 'POST',
      url: this.options.tokenUrl ?? '',
      form: {
        grant_type: 'client_credentials',
        client_id: this.options.clientId ?? '',
        client_secret: this.options.clientSecret ?? '',
        scope: this.options.scope,
      },
      fixture: 'dvsa-mot/_token',
      signal,
    });
    if (res.status >= 400) {
      throw new UpstreamError(`DVSA sign-in failed (HTTP ${res.status}).`, res.status);
    }
    const token = parseUpstream(TokenSchema, res.body, 'DVSA sign-in');
    this.token = { value: token.access_token, expiresAt: now + (token.expires_in - 60) * 1000 };
    return token.access_token;
  }
}

export class DvsaMotAdapter implements SourceAdapter {
  readonly id = 'dvsa_mot' as const;
  readonly label = 'DVSA MOT history';
  private readonly tokens: TokenCache;

  constructor(private readonly options: DvsaOptions) {
    this.tokens = new TokenCache(options);
  }

  supports(identifier: Identifier): boolean {
    return identifier.kind === 'uk_reg';
  }

  unavailableReason(mock: boolean): string | null {
    if (mock) return null;
    const { clientId, clientSecret, apiKey, tokenUrl } = this.options;
    if (clientId && clientSecret && apiKey && tokenUrl) return null;
    return 'DVSA MOT History credentials not configured.';
  }

  async lookup(identifier: Identifier, ctx: AdapterContext): Promise<AdapterOutcome> {
    const token = await this.tokens.get(ctx.http, ctx.signal, ctx.now().getTime());
    const res = await ctx.http.request({
      method: 'GET',
      url: `${this.options.baseUrl}/v1/trade/vehicles/registration/${encodeURIComponent(identifier.value)}`,
      headers: { authorization: `Bearer ${token}`, 'x-api-key': this.options.apiKey ?? '' },
      fixture: `dvsa-mot/${identifier.value}`,
      signal: ctx.signal,
    });
    if (res.status === 404) return { status: 'not_found' };
    expectStatus(res, 'DVSA');
    const vehicle = parseUpstream(DvsaVehicleSchema, res.body, 'DVSA');
    const { facts, motTests } = normaliseDvsa(vehicle);
    return { status: 'ok', raw: res.body, contribution: { source: this.id, facts, motTests } };
  }
}
