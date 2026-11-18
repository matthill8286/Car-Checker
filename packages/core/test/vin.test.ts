import { describe, expect, it } from 'vitest';
import { computeVinCheckDigit, isValidVin, modelYearCandidates, parseVin } from '../src/vin.js';

const NOW = new Date('2026-11-18T00:00:00Z');

describe('computeVinCheckDigit', () => {
  it('matches the 49 CFR 565 worked example', () => {
    expect(computeVinCheckDigit('1M8GDM9AXKP042788')).toBe('X');
  });
  it('handles all-ones', () => {
    expect(computeVinCheckDigit('11111111111111111')).toBe('1');
  });
});

describe('parseVin', () => {
  it('accepts a valid North American VIN and splits it', () => {
    const r = parseVin('1m8gdm9axkp042788', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info).toMatchObject({
      vin: '1M8GDM9AXKP042788',
      wmi: '1M8',
      vds: 'GDM9AX',
      vis: 'KP042788',
      region: 'north_america',
      checkDigit: { matches: true, required: true },
    });
    expect(r.info.modelYearCandidates).toEqual([1989, 2019]);
  });

  it('strips spaces and dashes', () => {
    expect(isValidVin('1M8 GDM9-AXKP 042788')).toBe(true);
  });

  it('rejects a North American VIN with a wrong check digit', () => {
    const r = parseVin('1M8GDM9A1KP042788', NOW);
    expect(r).toMatchObject({ ok: false, reason: 'check_digit' });
  });

  it('accepts a European VIN whose position 9 is not a check digit', () => {
    const r = parseVin('WVWZZZ1KZ6W000001', NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.region).toBe('europe');
    expect(r.info.checkDigit.required).toBe(false);
  });

  it('rejects I, O and Q', () => {
    expect(parseVin('WVWZZZ1KZ6W00000O')).toMatchObject({ ok: false, reason: 'characters' });
  });

  it('rejects the wrong length', () => {
    expect(parseVin('WVWZZZ1KZ6W0000')).toMatchObject({ ok: false, reason: 'length' });
  });
});

describe('modelYearCandidates', () => {
  it('stops at next year', () => {
    expect(modelYearCandidates('WVWZZZ1KZ6W000001', NOW)).toEqual([2006]);
    expect(modelYearCandidates('WVWZZZ1KZTW000001', NOW)).toEqual([1996, 2026]);
  });
});
