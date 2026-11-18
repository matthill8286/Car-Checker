import type { SourceMismatch } from '../schemas/insights.js';
import type { FactConflict } from '../schemas/vehicle.js';

/** Engine sizes within this many cc are the same engine reported with different rounding. */
export const ENGINE_TOLERANCE_CC = 50;

const FUELS: Array<[RegExp, string]> = [
  [/hybrid/i, 'hybrid'],
  [/electric|elektriciteit/i, 'electric'],
  [/diesel|heavy oil/i, 'diesel'],
  [/petrol|benzine|gasoline/i, 'petrol'],
  [/lpg|cng|gas/i, 'gas'],
];

function fuel(value: unknown): string {
  const text = String(value);
  return FUELS.find(([re]) => re.test(text))?.[1] ?? text.trim().toLowerCase();
}

function colour(value: unknown): string {
  return String(value).trim().toLowerCase().replace('gray', 'grey');
}

/**
 * Real disagreements between sources on the facts that identify a car: colour, fuel and engine
 * size. Rounding and naming differences are ignored, so what is left is worth asking about: a
 * respray, an engine swap, or a plate that belongs to a different car.
 */
export function sourceMismatches(conflicts: readonly FactConflict[]): SourceMismatch[] {
  const out: SourceMismatch[] = [];
  for (const c of conflicts) {
    if (c.field === 'colour' || c.field === 'fuelType') {
      const norm = c.field === 'colour' ? colour : fuel;
      if (new Set(c.values.map((v) => norm(v.value))).size > 1) {
        out.push({ field: c.field, values: c.values });
      }
    } else if (c.field === 'engineCapacityCc') {
      const sizes = c.values.map((v) => Number(v.value)).filter(Number.isFinite);
      if (Math.max(...sizes) - Math.min(...sizes) > ENGINE_TOLERANCE_CC) {
        out.push({ field: c.field, values: c.values });
      }
    }
  }
  return out;
}
