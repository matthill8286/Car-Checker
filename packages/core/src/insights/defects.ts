import type { DefectType, MotTest } from '../schemas/vehicle.js';

/**
 * Defect areas from the build plan. Corrosion is its own area wherever it is, because rust is
 * what a buyer most needs to see across the years.
 */
export const DEFECT_CATEGORIES = [
  { id: 'brakes', label: 'Brakes' },
  { id: 'tyres', label: 'Tyres and wheels' },
  { id: 'suspension', label: 'Suspension and steering' },
  { id: 'corrosion', label: 'Corrosion' },
  { id: 'lights', label: 'Lights and electrics' },
  { id: 'emissions', label: 'Emissions and leaks' },
  { id: 'other', label: 'Other' },
] as const;

export type DefectCategory = (typeof DEFECT_CATEGORIES)[number]['id'];

/** Keyword rules, checked in order; the first match wins. */
const KEYWORDS: Array<[RegExp, DefectCategory]> = [
  [/\bcorro|\brust|\bexcessively weakened|\bperforat/i, 'corrosion'],
  [/\bbrak|\bhandbrake|\babs\b|\bcaliper|\bdiscs?\b|\bpads?\b/i, 'brakes'],
  [
    /\bsuspension|\bshock absorber|\bspring|\bball joint|\bbush|\barm\b|\banti-roll|\bstrut|\bsteer|\btrack rod|\brack\b|\bwheel bearing|\bdrive ?shaft|\bcv boot/i,
    'suspension',
  ],
  [/\btyre|\bwheel|\btread|\bsidewall|\bvalve\b/i, 'tyres'],
  [/lamp|\blight|\bindicator|\bbulb|\breflector|\bbattery|\bwiring|\bhorn\b|\bbeam/i, 'lights'],
  [/\bexhaust|\bemission|\bsmoke|\bleak|\bcatalyst|\blambda|\bdpf\b|\bparticulate/i, 'emissions'],
];

/** Manual sections (and sub-sections) for defects whose wording matches no keyword. */
function byReference(section: number, sub: number): DefectCategory | null {
  if (section === 1) return 'brakes';
  if (section === 2) return 'suspension';
  if (section === 4) return 'lights';
  if (section === 5) return sub === 2 ? 'tyres' : 'suspension';
  if (section === 8) return 'emissions';
  return null;
}

/**
 * Picks the area a defect belongs to: by wording first (so "brake pipe corroded" counts as
 * corrosion), then by its MOT manual reference such as "(5.2.3 (e))", else other.
 */
export function categoriseDefect(text: string): DefectCategory {
  for (const [pattern, category] of KEYWORDS) if (pattern.test(text)) return category;
  const ref = /\((\d+)\.(\d+)(?:\.\d+)?[^)]*\)?\s*\)?\s*$/.exec(text.trim());
  if (ref) return byReference(Number(ref[1]), Number(ref[2])) ?? 'other';
  return 'other';
}

export interface HeatmapCell {
  category: DefectCategory;
  year: number;
  count: number;
  /** Count of defects by type, for the tooltip and table. */
  byType: Partial<Record<DefectType, number>>;
  dangerous: number;
  defects: string[];
}

export interface DefectHeatmap {
  /** Only categories with at least one defect, in manual order. */
  categories: Array<{ id: DefectCategory; label: string }>;
  /** Every year from the first test to the last, so gaps show. */
  years: number[];
  cells: HeatmapCell[];
  max: number;
}

/**
 * Counts defects by area and year across all tests. Retests on the same day each count, as
 * the DVSA records them separately; that is what a buyer sees in the history too.
 */
export function defectHeatmap(tests: readonly MotTest[]): DefectHeatmap {
  const cells = new Map<string, HeatmapCell>();
  const years = tests.map((t) => Number(t.completedAt.slice(0, 4))).filter(Number.isFinite);
  for (const test of tests) {
    const year = Number(test.completedAt.slice(0, 4));
    for (const defect of test.defects) {
      const category = categoriseDefect(defect.text);
      const key = `${category}:${year}`;
      const cell = cells.get(key) ?? {
        category,
        year,
        count: 0,
        byType: {},
        dangerous: 0,
        defects: [],
      };
      cell.count += 1;
      cell.byType[defect.type] = (cell.byType[defect.type] ?? 0) + 1;
      if (defect.dangerous) cell.dangerous += 1;
      cell.defects.push(defect.text);
      cells.set(key, cell);
    }
  }
  const used = new Set([...cells.values()].map((c) => c.category));
  const first = Math.min(...years);
  const last = Math.max(...years);
  return {
    categories: DEFECT_CATEGORIES.filter((c) => used.has(c.id)).map((c) => ({
      id: c.id,
      label: c.label,
    })),
    years: years.length ? Array.from({ length: last - first + 1 }, (_, i) => first + i) : [],
    cells: [...cells.values()].sort((a, b) => a.year - b.year),
    max: Math.max(0, ...[...cells.values()].map((c) => c.count)),
  };
}
