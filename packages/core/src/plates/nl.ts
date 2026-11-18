import { normalizeInput, shapeOf } from '../normalize.js';

export interface NlPlateInfo {
  /** Normalised, without dashes, as the RDW open data uses it: `XXDDXX`. */
  plate: string;
  /** As printed, with dashes: `XX-99-XX`. */
  display: string;
  /** RDW sidecode (1 to 14), which fixes where the dashes go. */
  sidecode: number;
}

export type NlPlateParseResult =
  { ok: true; info: NlPlateInfo } | { ok: false; reason: 'format'; message: string };

/**
 * Dutch sidecodes as letter/digit shapes with dash positions.
 * L = letter, D = digit. See RDW "kentekenseries" for the history of each series.
 */
const SIDECODES: ReadonlyArray<{
  sidecode: number;
  groups: [number, number, number];
  shape: string;
}> = [
  { sidecode: 1, shape: 'LLDDDD', groups: [2, 2, 2] },
  { sidecode: 2, shape: 'DDDDLL', groups: [2, 2, 2] },
  { sidecode: 3, shape: 'DDLLDD', groups: [2, 2, 2] },
  { sidecode: 4, shape: 'LLDDLL', groups: [2, 2, 2] },
  { sidecode: 5, shape: 'LLLLDD', groups: [2, 2, 2] },
  { sidecode: 6, shape: 'DDLLLL', groups: [2, 2, 2] },
  { sidecode: 7, shape: 'DDLLLD', groups: [2, 3, 1] },
  { sidecode: 8, shape: 'DLLLDD', groups: [1, 3, 2] },
  { sidecode: 9, shape: 'LLDDDL', groups: [2, 3, 1] },
  { sidecode: 10, shape: 'LDDDLL', groups: [1, 3, 2] },
  { sidecode: 11, shape: 'LLLDDL', groups: [3, 2, 1] },
  { sidecode: 12, shape: 'LDDLLL', groups: [1, 2, 3] },
  { sidecode: 13, shape: 'DLLDDD', groups: [1, 2, 3] },
  { sidecode: 14, shape: 'DDDLLD', groups: [3, 2, 1] },
];

function withDashes(plate: string, groups: [number, number, number]): string {
  const [a, b] = groups;
  return `${plate.slice(0, a)}-${plate.slice(a, a + b)}-${plate.slice(a + b)}`;
}

export function parseNlPlate(input: string): NlPlateParseResult {
  const plate = normalizeInput(input);
  if (plate.length === 6) {
    const shape = shapeOf(plate);
    const match = SIDECODES.find((s) => s.shape === shape);
    if (match) {
      return {
        ok: true,
        info: { plate, display: withDashes(plate, match.groups), sidecode: match.sidecode },
      };
    }
  }
  return { ok: false, reason: 'format', message: 'Not a recognised Dutch plate format.' };
}

/**
 * True when the dashes the user typed sit where a Dutch plate puts them, which is a strong hint
 * that the input is Dutch rather than a UK dateless or prefix mark.
 */
export function hasDutchDashes(input: string): boolean {
  const parsed = parseNlPlate(input);
  if (!parsed.ok) return false;
  return input.trim().toUpperCase().replace(/\s/g, '') === parsed.info.display;
}

export function isValidNlPlate(input: string): boolean {
  return parseNlPlate(input).ok;
}
