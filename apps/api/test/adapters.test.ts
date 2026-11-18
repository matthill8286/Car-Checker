import type { Identifier } from '@carcheck/core';
import { detectIdentifier } from '@carcheck/core';
import { describe, expect, it } from 'vitest';
import { DvlaAdapter } from '../src/adapters/dvla.js';
import { DvsaMotAdapter } from '../src/adapters/dvsa-mot.js';
import { NhtsaVpicAdapter } from '../src/adapters/nhtsa-vpic.js';
import { RdwAdapter } from '../src/adapters/rdw.js';
import type { AdapterContext } from '../src/adapters/types.js';
import { FixtureHttpClient, type HttpClient, type HttpRequest } from '../src/http/client.js';
import { NOW, testConfig } from './helpers.js';

const config = testConfig();
const fixtures = new FixtureHttpClient(config.FIXTURES_DIR);

function ctx(http: HttpClient = fixtures): AdapterContext {
  return { http, signal: AbortSignal.timeout(5000), now: () => NOW };
}

function id(query: string): Identifier {
  const r = detectIdentifier(query, 'auto', NOW);
  if (!r.ok) throw new Error(r.message);
  return r.identifier;
}

describe('DvlaAdapter', () => {
  const dvla = new DvlaAdapter({ baseUrl: config.DVLA_BASE_URL, apiKey: 'k' });

  it('only handles UK registrations', () => {
    expect(dvla.supports(id('AB12CDE'))).toBe(true);
    expect(dvla.supports(id('ZK-472-T'))).toBe(false);
  });

  it('normalises the vehicle record', async () => {
    const out = await dvla.lookup(id('AB12 CDE'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.contribution.facts).toEqual({
      registration: 'AB12CDE',
      country: 'GB',
      make: 'FORD',
      colour: 'BLUE',
      fuelType: 'PETROL',
      engineCapacityCc: 1596,
      co2EmissionsGKm: 139,
      euroStatus: 'EURO 5',
      yearOfManufacture: 2012,
      firstRegistrationDate: '2012-04',
      taxStatus: 'Taxed',
      taxDueDate: '2027-04-01',
      motStatus: 'Valid',
      motExpiryDate: '2027-04-17',
      markedForExport: false,
    });
  });

  it('treats a 404 as not found', async () => {
    expect(await dvla.lookup(id('BD25XYZ'), ctx())).toEqual({ status: 'not_found' });
  });

  it('turns a 500 into an upstream error', async () => {
    await expect(dvla.lookup(id('ER12ROR'), ctx())).rejects.toThrow('DVLA returned HTTP 500.');
  });

  it('sends the key and registration the way DVLA expects', async () => {
    const seen: HttpRequest[] = [];
    const http: HttpClient = {
      mock: false,
      async request(req) {
        seen.push(req);
        return { status: 404, body: null };
      },
    };
    await dvla.lookup(id('AB12CDE'), ctx(http));
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: 'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles',
      headers: { 'x-api-key': 'k' },
      body: { registrationNumber: 'AB12CDE' },
    });
  });

  it('reports a missing key in live mode only', () => {
    const keyless = new DvlaAdapter({ baseUrl: config.DVLA_BASE_URL });
    expect(keyless.unavailableReason(false)).toMatch(/not configured/);
    expect(keyless.unavailableReason(true)).toBeNull();
  });
});

describe('DvsaMotAdapter', () => {
  const options = {
    baseUrl: config.DVSA_BASE_URL,
    scope: config.DVSA_SCOPE,
    tokenUrl: 'https://login.example/token',
    clientId: 'id',
    clientSecret: 'secret',
    apiKey: 'key',
  };

  it('normalises tests, defects and odometer readings', async () => {
    const out = await new DvsaMotAdapter(options).lookup(id('AB12CDE'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const tests = out.contribution.motTests ?? [];
    expect(tests).toHaveLength(10);
    expect(tests[0]).toEqual({
      testNumber: '100000000010',
      completedAt: '2026-04-15T09:12:44.000Z',
      result: 'passed',
      expiryDate: '2027-04-17',
      odometer: { value: 88310, unit: 'mi' },
      odometerResult: 'read',
      defects: [
        {
          text: 'Nearside Front Tyre worn close to legal limit/worn on edge (5.2.3 (e))',
          type: 'advisory',
          dangerous: false,
        },
      ],
      source: 'dvsa_mot',
    });
    expect(tests.find((t) => t.result === 'failed')?.defects[0]?.type).toBe('major');
    expect(out.contribution.facts).toMatchObject({ model: 'FOCUS', outstandingRecall: 'no' });
  });

  it('copes with a vehicle that has had no MOT yet', async () => {
    const out = await new DvsaMotAdapter(options).lookup(id('LN74NEW'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.contribution.motTests).toEqual([]);
    expect(out.contribution.facts.outstandingRecall).toBe('unknown');
  });

  it('fetches one token and reuses it', async () => {
    const seen: string[] = [];
    const http: HttpClient = {
      mock: false,
      async request(req) {
        seen.push(req.url);
        if (req.url === options.tokenUrl) {
          expect(req.form).toMatchObject({ grant_type: 'client_credentials', client_id: 'id' });
          return { status: 200, body: { access_token: 't', expires_in: 3600 } };
        }
        expect(req.headers).toMatchObject({ authorization: 'Bearer t', 'x-api-key': 'key' });
        return { status: 404, body: null };
      },
    };
    const adapter = new DvsaMotAdapter(options);
    await adapter.lookup(id('AB12CDE'), ctx(http));
    await adapter.lookup(id('WX65ABC'), ctx(http));
    expect(seen.filter((u) => u === options.tokenUrl)).toHaveLength(1);
    expect(seen).toContain('https://history.mot.api.gov.uk/v1/trade/vehicles/registration/WX65ABC');
  });

  it('needs all four credentials in live mode', () => {
    expect(new DvsaMotAdapter({ ...options, apiKey: undefined }).unavailableReason(false)).toMatch(
      /not configured/,
    );
    expect(new DvsaMotAdapter(options).unavailableReason(false)).toBeNull();
  });
});

describe('RdwAdapter', () => {
  const rdw = new RdwAdapter({ baseUrl: config.RDW_BASE_URL });

  it('normalises and translates the Dutch record', async () => {
    const out = await rdw.lookup(id('ZK-472-T'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.contribution.facts).toMatchObject({
      registration: 'ZK472T',
      country: 'NL',
      make: 'VOLKSWAGEN',
      model: 'GOLF',
      colour: 'Grey',
      fuelType: 'Petrol',
      firstRegistrationDate: '2015-03-01',
      motExpiryDate: '2027-06-12',
      motStatus: 'Valid',
      outstandingRecall: 'yes',
      co2EmissionsGKm: 119,
    });
  });

  it('treats an empty result as not found', async () => {
    const http: HttpClient = { mock: false, request: async () => ({ status: 200, body: [] }) };
    expect(await rdw.lookup(id('ZK-473-T'), ctx(http))).toEqual({ status: 'not_found' });
  });
});

describe('NhtsaVpicAdapter', () => {
  const vpic = new NhtsaVpicAdapter({ baseUrl: config.NHTSA_BASE_URL });

  it('decodes a US VIN', async () => {
    const out = await vpic.lookup(id('1HGCM82633A004352'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.contribution.facts).toMatchObject({
      make: 'HONDA',
      model: 'Accord',
      modelYear: 2003,
      fuelType: 'Petrol',
      engineCapacityCc: 2999,
      plantCountry: 'United States',
    });
  });

  it('keeps what little it knows about a European VIN', async () => {
    const out = await vpic.lookup(id('WVWZZZ1KZ6W000001'), ctx());
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.contribution.facts).toEqual({
      vin: 'WVWZZZ1KZ6W000001',
      make: 'VOLKSWAGEN',
      modelYear: 2006,
      plantCountry: 'Germany',
    });
  });
});
