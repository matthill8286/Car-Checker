import { normalizeInput } from './normalize.js';
import { hasDutchDashes, parseNlPlate } from './plates/nl.js';
import { parseUkReg } from './plates/uk.js';
import type {
  Identifier,
  NlPlateIdentifier,
  QueryHint,
  UkRegIdentifier,
  VinIdentifier,
} from './schemas/identifier.js';
import { parseVin } from './vin.js';

export type DetectResult =
  | { ok: true; identifier: Identifier; alternatives: Identifier[]; ambiguous: boolean }
  | { ok: false; message: string; details: string[] };

function ukIdentifier(input: string, now: Date): UkRegIdentifier | string {
  const parsed = parseUkReg(input, now);
  if (!parsed.ok) return parsed.message;
  const { info } = parsed;
  return {
    kind: 'uk_reg',
    country: 'GB',
    value: info.registration,
    display: info.display,
    format: info.format,
    issuePeriod: info.issuePeriod,
    northernIreland: info.northernIreland,
  };
}

function nlIdentifier(input: string): NlPlateIdentifier | string {
  const parsed = parseNlPlate(input);
  if (!parsed.ok) return parsed.message;
  return {
    kind: 'nl_plate',
    country: 'NL',
    value: parsed.info.plate,
    display: parsed.info.display,
    sidecode: parsed.info.sidecode,
  };
}

function vinIdentifier(input: string, now: Date): VinIdentifier | string {
  const parsed = parseVin(input, now);
  if (!parsed.ok) return parsed.message;
  const { info } = parsed;
  return {
    kind: 'vin',
    country: null,
    value: info.vin,
    display: info.vin,
    wmi: info.wmi,
    region: info.region,
    checkDigitMatches: info.checkDigit.matches,
    modelYearCandidates: info.modelYearCandidates,
  };
}

/**
 * Works out what the user typed. With `hint: 'auto'`, a 17-character input is a VIN; otherwise
 * UK formats win over Dutch ones (UK first), unless the user typed Dutch-style dashes. When both
 * readings are valid, the other one is returned in `alternatives` so the UI can offer it.
 */
export function detectIdentifier(
  input: string,
  hint: QueryHint = 'auto',
  now: Date = new Date(),
): DetectResult {
  const normalized = normalizeInput(input);
  if (normalized.length === 0) {
    return { ok: false, message: 'Enter a registration, plate or VIN.', details: [] };
  }

  const attempts: Record<'GB' | 'NL' | 'VIN', Identifier | string> = {
    GB: ukIdentifier(input, now),
    NL: nlIdentifier(input),
    VIN: vinIdentifier(input, now),
  };

  if (hint !== 'auto') {
    const result = attempts[hint];
    if (typeof result === 'string') {
      return { ok: false, message: result, details: [] };
    }
    return { ok: true, identifier: result, alternatives: [], ambiguous: false };
  }

  if (normalized.length === 17) {
    const vin = attempts.VIN;
    if (typeof vin === 'string') return { ok: false, message: vin, details: [] };
    return { ok: true, identifier: vin, alternatives: [], ambiguous: false };
  }

  const order: Array<'GB' | 'NL'> = hasDutchDashes(input) ? ['NL', 'GB'] : ['GB', 'NL'];
  const matches = order
    .map((key) => attempts[key])
    .filter((r): r is Identifier => typeof r !== 'string');

  const [first, ...rest] = matches;
  if (!first) {
    const details = [attempts.GB, attempts.NL]
      .filter((r): r is string => typeof r === 'string')
      .concat(normalized.length > 10 ? [String(attempts.VIN)] : []);
    return {
      ok: false,
      message: 'That does not look like a UK registration, a Dutch plate or a VIN.',
      details,
    };
  }
  return { ok: true, identifier: first, alternatives: rest, ambiguous: rest.length > 0 };
}
