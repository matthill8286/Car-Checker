import { describe, expect, it } from 'vitest';
import { detectIdentifier } from '../src/detect.js';

const NOW = new Date('2026-11-18T00:00:00Z');

describe('detectIdentifier', () => {
  it('detects a current UK reg', () => {
    const r = detectIdentifier('ab12 cde', 'auto', NOW);
    expect(r).toMatchObject({
      ok: true,
      identifier: { kind: 'uk_reg', value: 'AB12CDE' },
      ambiguous: false,
    });
  });

  it('detects a Dutch plate that cannot be British', () => {
    const r = detectIdentifier('12-ABC-3', 'auto', NOW);
    expect(r).toMatchObject({ ok: true, identifier: { kind: 'nl_plate', sidecode: 7 } });
  });

  it('prefers UK for ambiguous input, offering NL as an alternative', () => {
    const r = detectIdentifier('A12BCD', 'auto', NOW);
    expect(r).toMatchObject({
      ok: true,
      identifier: { kind: 'uk_reg', format: 'prefix' },
      alternatives: [{ kind: 'nl_plate', sidecode: 12 }],
      ambiguous: true,
    });
  });

  it('prefers NL when the user typed Dutch dashes', () => {
    const r = detectIdentifier('A-12-BCD', 'auto', NOW);
    expect(r).toMatchObject({
      ok: true,
      identifier: { kind: 'nl_plate' },
      alternatives: [{ kind: 'uk_reg' }],
    });
  });

  it('detects a VIN', () => {
    const r = detectIdentifier('WVWZZZ1KZ6W000001', 'auto', NOW);
    expect(r).toMatchObject({
      ok: true,
      identifier: { kind: 'vin', region: 'europe', country: null },
    });
  });

  it('honours the hint', () => {
    expect(detectIdentifier('A12BCD', 'NL', NOW)).toMatchObject({
      ok: true,
      identifier: { kind: 'nl_plate' },
      alternatives: [],
    });
    expect(detectIdentifier('AB12CDE', 'NL', NOW)).toMatchObject({ ok: false });
  });

  it('explains failures', () => {
    const r = detectIdentifier('not a car', 'auto', NOW);
    expect(r).toMatchObject({ ok: false });
    expect(detectIdentifier('   ', 'auto', NOW)).toMatchObject({ ok: false });
  });
});
