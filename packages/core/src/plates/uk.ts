import { normalizeInput } from '../normalize.js';

export type UkRegFormat = 'current' | 'prefix' | 'suffix' | 'dateless';

export interface UkRegInfo {
  /** Normalised, without spaces: `AB12CDE`. */
  registration: string;
  /** As printed on the plate: `AB12 CDE`. */
  display: string;
  format: UkRegFormat;
  /**
   * When the registration was first issued, for formats that encode it. Cherished plates can be
   * moved to older vehicles, so this is the earliest the vehicle could be, not its age.
   */
  issuePeriod: { from: string; to: string } | null;
  /** Dateless marks with I or Z in the area code are Northern Ireland issues. */
  northernIreland: boolean;
}

export type UkRegParseResult =
  | { ok: true; info: UkRegInfo }
  | { ok: false; reason: 'format' | 'age_identifier'; message: string };

const CURRENT = /^([A-HJ-PR-Y][A-HJ-PR-Y])([0-9]{2})([A-HJ-PR-Z]{3})$/;
// Year letters skip I, O, Q, U and Z.
const YEAR_LETTERS = 'ABCDEFGHJKLMNPRSTVWXY';
const SUFFIX = /^([A-Z]{3})([0-9]{1,3})([A-HJ-NPR-TV-Y])$/;
const PREFIX = /^([A-HJ-NPR-TV-Y])([0-9]{1,3})([A-Z]{3})$/;
const DATELESS_LETTERS_FIRST = /^([A-Z]{1,3})([0-9]{1,4})$/;
const DATELESS_DIGITS_FIRST = /^([0-9]{1,4})([A-Z]{1,3})$/;

function isoMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Age identifier `12` is March 2012 to August 2012, `62` is September 2012 to February 2013. */
function currentFormatPeriod(age: number): { from: string; to: string; year: number } | null {
  if (age >= 2 && age <= 50) {
    const year = 2000 + age;
    return { from: isoMonth(year, 3), to: isoMonth(year, 8), year };
  }
  if (age >= 51 && age <= 99) {
    const year = 2000 + age - 50;
    return { from: isoMonth(year, 9), to: isoMonth(year + 1, 2), year };
  }
  return null;
}

/** Suffix letters ran from A (1963) to Y (1982-83), changing each August from 1967. */
function suffixPeriod(letter: string): { from: string; to: string } | null {
  const index = YEAR_LETTERS.indexOf(letter);
  if (index < 0) return null;
  if (index === 0) return { from: '1963-01', to: '1963-12' };
  if (index === 1) return { from: '1964-01', to: '1964-12' };
  if (index === 2) return { from: '1965-01', to: '1965-12' };
  if (index === 3) return { from: '1966-01', to: '1966-12' };
  if (index === 4) return { from: '1967-01', to: '1967-07' };
  // F is August 1967 onwards.
  const startYear = 1967 + (index - 5);
  return { from: isoMonth(startYear, 8), to: isoMonth(startYear + 1, 7) };
}

/** Prefix letters ran from A (August 1983) to Y (March 2001), twice-yearly from S (1998). */
function prefixPeriod(letter: string): { from: string; to: string } | null {
  const index = YEAR_LETTERS.indexOf(letter);
  if (index < 0) return null;
  const sIndex = YEAR_LETTERS.indexOf('S');
  if (index < sIndex) {
    const startYear = 1983 + index;
    return { from: isoMonth(startYear, 8), to: isoMonth(startYear + 1, 7) };
  }
  // S ran August 1998 to February 1999, then T onwards changed every March and September.
  if (index === sIndex) return { from: '1998-08', to: '1999-02' };
  const months = 1999 * 12 + 2 + (index - sIndex - 1) * 6; // zero-based month count
  const fromYear = Math.floor(months / 12);
  const fromMonth = (months % 12) + 1;
  const toMonths = months + 5;
  return {
    from: isoMonth(fromYear, fromMonth),
    to: isoMonth(Math.floor(toMonths / 12), (toMonths % 12) + 1),
  };
}

function display(parts: string[]): string {
  return parts.join(' ');
}

export function parseUkReg(input: string, now: Date = new Date()): UkRegParseResult {
  const reg = normalizeInput(input);

  const current = CURRENT.exec(reg);
  if (current) {
    const [, memory = '', ageText = '', random = ''] = current;
    const age = Number(ageText);
    const period = currentFormatPeriod(age);
    if (!period) {
      return {
        ok: false,
        reason: 'age_identifier',
        message: `Age identifier ${ageText} has never been issued.`,
      };
    }
    const issued = Date.UTC(Number(period.from.slice(0, 4)), Number(period.from.slice(5)) - 1, 1);
    if (issued > now.getTime()) {
      return {
        ok: false,
        reason: 'age_identifier',
        message: `Age identifier ${ageText} is not issued until ${period.from}.`,
      };
    }
    return {
      ok: true,
      info: {
        registration: reg,
        display: display([memory + ageText, random]),
        format: 'current',
        issuePeriod: { from: period.from, to: period.to },
        northernIreland: false,
      },
    };
  }

  const prefix = PREFIX.exec(reg);
  if (prefix) {
    const [, letter = '', digits = '', letters = ''] = prefix;
    return {
      ok: true,
      info: {
        registration: reg,
        display: display([letter + digits, letters]),
        format: 'prefix',
        issuePeriod: prefixPeriod(letter),
        northernIreland: false,
      },
    };
  }

  const suffix = SUFFIX.exec(reg);
  if (suffix) {
    const [, letters = '', digits = '', letter = ''] = suffix;
    return {
      ok: true,
      info: {
        registration: reg,
        display: display([letters, digits + letter]),
        format: 'suffix',
        issuePeriod: suffixPeriod(letter),
        northernIreland: false,
      },
    };
  }

  const lettersFirst = DATELESS_LETTERS_FIRST.exec(reg);
  const digitsFirst = DATELESS_DIGITS_FIRST.exec(reg);
  const dateless = lettersFirst ?? digitsFirst;
  if (dateless) {
    const letters = (lettersFirst ? lettersFirst[1] : digitsFirst?.[2]) ?? '';
    const digits = (lettersFirst ? lettersFirst[2] : digitsFirst?.[1]) ?? '';
    const areaCode = letters.slice(-2);
    return {
      ok: true,
      info: {
        registration: reg,
        display: lettersFirst ? display([letters, digits]) : display([digits, letters]),
        format: 'dateless',
        issuePeriod: null,
        northernIreland: areaCode.length === 2 && /[IZ]/.test(areaCode),
      },
    };
  }

  return {
    ok: false,
    reason: 'format',
    message: 'Not a recognised UK registration format.',
  };
}

export function isValidUkReg(input: string, now?: Date): boolean {
  return parseUkReg(input, now).ok;
}
