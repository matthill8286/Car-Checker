import { describe, expect, it } from 'vitest';
import { parseUkReg } from '../src/plates/uk.js';

const NOW = new Date('2026-11-18T00:00:00Z');

describe('parseUkReg', () => {
  it.each([
    ['AB12 CDE', 'AB12 CDE', { from: '2012-03', to: '2012-08' }],
    ['ab62cde', 'AB62 CDE', { from: '2012-09', to: '2013-02' }],
    ['LL51 ABC', 'LL51 ABC', { from: '2001-09', to: '2002-02' }],
    ['YX76 ZZZ', 'YX76 ZZZ', { from: '2026-09', to: '2027-02' }],
  ])('parses current format %s', (input, display, issuePeriod) => {
    const r = parseUkReg(input, NOW);
    expect(r).toEqual({
      ok: true,
      info: expect.objectContaining({ format: 'current', display, issuePeriod }),
    });
  });

  it('rejects an age identifier that has not been issued yet', () => {
    expect(parseUkReg('AB27 CDE', NOW)).toMatchObject({ ok: false, reason: 'age_identifier' });
  });

  it('rejects age identifiers that never existed', () => {
    expect(parseUkReg('AB01 CDE', NOW)).toMatchObject({ ok: false, reason: 'age_identifier' });
    expect(parseUkReg('AB50 CDE', NOW)).toMatchObject({ ok: false, reason: 'age_identifier' });
  });

  it('rejects I, Q and Z in the memory tag', () => {
    expect(parseUkReg('IB12 CDE', NOW).ok).toBe(false);
    expect(parseUkReg('AQ12 CDE', NOW).ok).toBe(false);
  });

  it.each([
    ['A123 BCD', 'A123 BCD', { from: '1983-08', to: '1984-07' }],
    ['R1 ABC', 'R1 ABC', { from: '1997-08', to: '1998-07' }],
    ['S123 ABC', 'S123 ABC', { from: '1998-08', to: '1999-02' }],
    ['T123 ABC', 'T123 ABC', { from: '1999-03', to: '1999-08' }],
    ['Y123 ABC', 'Y123 ABC', { from: '2001-03', to: '2001-08' }],
  ])('parses prefix %s', (input, display, issuePeriod) => {
    expect(parseUkReg(input, NOW)).toEqual({
      ok: true,
      info: expect.objectContaining({ format: 'prefix', display, issuePeriod }),
    });
  });

  it.each([
    ['ABC 123A', { from: '1963-01', to: '1963-12' }],
    ['ABC 12F', { from: '1967-08', to: '1968-07' }],
    ['ABC 1Y', { from: '1982-08', to: '1983-07' }],
  ])('parses suffix %s', (input, issuePeriod) => {
    expect(parseUkReg(input, NOW)).toEqual({
      ok: true,
      info: expect.objectContaining({ format: 'suffix', issuePeriod }),
    });
  });

  it('parses dateless marks and spots Northern Ireland', () => {
    expect(parseUkReg('1 A', NOW)).toMatchObject({ ok: true, info: { format: 'dateless' } });
    expect(parseUkReg('AIZ 1234', NOW)).toMatchObject({
      ok: true,
      info: { format: 'dateless', northernIreland: true, display: 'AIZ 1234' },
    });
    expect(parseUkReg('ABC 1234', NOW)).toMatchObject({
      ok: true,
      info: { northernIreland: false },
    });
  });

  it('rejects junk', () => {
    expect(parseUkReg('HELLO WORLD', NOW).ok).toBe(false);
    expect(parseUkReg('12345', NOW).ok).toBe(false);
  });
});
