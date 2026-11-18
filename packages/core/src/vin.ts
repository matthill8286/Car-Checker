import { normalizeInput } from './normalize.js';

/** ISO 3779 forbids I, O and Q so they cannot be confused with 1 and 0. */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

// prettier-ignore
const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};

const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

/** Model-year codes at position 10, starting at 1980 and repeating every 30 years. */
const MODEL_YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export type VinRegion =
  'africa' | 'asia' | 'europe' | 'north_america' | 'oceania' | 'south_america';

export interface VinCheckDigit {
  /** The character found at position 9. */
  actual: string;
  /** The character the ISO 3779 / 49 CFR 565 algorithm expects. */
  expected: string;
  matches: boolean;
  /**
   * Whether the check digit is mandatory for this VIN. It is required for vehicles built for
   * North America (and China); European manufacturers often use position 9 for other data.
   */
  required: boolean;
}

export interface VinInfo {
  vin: string;
  /** World manufacturer identifier: the first three characters. */
  wmi: string;
  /** Vehicle descriptor section: characters 4 to 9. */
  vds: string;
  /** Vehicle identifier section: characters 10 to 17. */
  vis: string;
  region: VinRegion | null;
  checkDigit: VinCheckDigit;
  /**
   * Possible model years from position 10. Only meaningful when the manufacturer follows the
   * North American convention, so treat it as a hint.
   */
  modelYearCandidates: number[];
}

export type VinParseResult =
  | { ok: true; info: VinInfo }
  | { ok: false; reason: 'length' | 'characters' | 'check_digit'; message: string };

export function computeVinCheckDigit(vin: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i] ?? '';
    const value = /[0-9]/.test(ch) ? Number(ch) : TRANSLITERATION[ch];
    if (value === undefined) throw new Error(`Invalid VIN character: ${ch}`);
    sum += value * (WEIGHTS[i] ?? 0);
  }
  const remainder = sum % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

export function vinRegion(vin: string): VinRegion | null {
  const c = vin[0] ?? '';
  if (/[A-H]/.test(c)) return 'africa';
  if (/[J-R]/.test(c)) return 'asia';
  if (/[S-Z]/.test(c)) return 'europe';
  if (/[1-5]/.test(c)) return 'north_america';
  if (/[67]/.test(c)) return 'oceania';
  if (/[89]/.test(c)) return 'south_america';
  return null;
}

function checkDigitRequired(vin: string): boolean {
  // North America (1-5) and China (L) mandate the check digit.
  return /^[1-5L]/.test(vin);
}

export function modelYearCandidates(vin: string, now: Date = new Date()): number[] {
  const index = MODEL_YEAR_CODES.indexOf(vin[9] ?? '');
  if (index < 0) return [];
  const latest = now.getUTCFullYear() + 1;
  const years: number[] = [];
  for (let year = 1980 + index; year <= latest; year += 30) years.push(year);
  return years;
}

export function parseVin(input: string, now: Date = new Date()): VinParseResult {
  const vin = normalizeInput(input);
  if (vin.length !== 17) {
    return { ok: false, reason: 'length', message: 'A VIN has exactly 17 characters.' };
  }
  if (!VIN_PATTERN.test(vin)) {
    return {
      ok: false,
      reason: 'characters',
      message: 'A VIN uses only A-Z and 0-9, and never the letters I, O or Q.',
    };
  }
  const expected = computeVinCheckDigit(vin);
  const actual = vin[8] ?? '';
  const required = checkDigitRequired(vin);
  const matches = expected === actual;
  if (required && !matches) {
    return {
      ok: false,
      reason: 'check_digit',
      message: `Check digit is ${actual} but should be ${expected}; the VIN is probably mistyped.`,
    };
  }
  return {
    ok: true,
    info: {
      vin,
      wmi: vin.slice(0, 3),
      vds: vin.slice(3, 9),
      vis: vin.slice(9),
      region: vinRegion(vin),
      checkDigit: { actual, expected, matches, required },
      modelYearCandidates: modelYearCandidates(vin, now),
    },
  };
}

export function isValidVin(input: string): boolean {
  return parseVin(input).ok;
}
