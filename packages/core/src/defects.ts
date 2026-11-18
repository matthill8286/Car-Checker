import type { DefectType, MotTest } from './schemas/vehicle.js';

/**
 * Defect areas, following the sections of the MOT inspection manual for cars (since May 2018
 * every DVSA defect ends with its manual reference, such as "(5.2.3 (e))").
 */
export const DEFECT_CATEGORIES = [
  { id: 'brakes', label: 'Brakes', section: 1 },
  { id: 'steering', label: 'Steering', section: 2 },
  { id: 'visibility', label: 'Visibility', section: 3 },
  { id: 'lights', label: 'Lights and electrics', section: 4 },
  { id: 'wheels', label: 'Tyres, wheels and suspension', section: 5 },
  { id: 'body', label: 'Body and structure', section: 6 },
  { id: 'emissions', label: 'Emissions and leaks', section: 8 },
  { id: 'other', label: 'Other', section: null },
] as const;

export type DefectCategory = (typeof DEFECT_CATEGORIES)[number]['id'];

const BY_SECTION = new Map<number, DefectCategory>(
  DEFECT_CATEGORIES.filter((c) => c.section !== null).map((c) => [c.section as number, c.id]),
);

/** Keywords for older defects that carry no manual reference. Checked in order. */
const KEYWORDS: Array<[RegExp, DefectCategory]> = [
  [/\bbrak|\bhandbrake|\bparking brake|\babs\b/i, 'brakes'],
  [/\bsteer|\btrack rod|\brack\b|\bpower steering/i, 'steering'],
  [/\bwiper|\bwindscreen|\bwasher|\bmirror|\bview\b/i, 'visibility'],
  [/lamp|\blight|\bindicator|\bbulb|\breflector|\bbattery|\bwiring|\bhorn\b/i, 'lights'],
  [
    /\btyre|\bwheel|\bsuspension|\bshock absorber|\bspring|\bball joint|\bbush|\bhub\b|\baxle|\bdrive shaft/i,
    'wheels',
  ],
  [
    /\bcorro|\bbody|\bchassis|\bsill|\bsubframe|\bdoor|\bbonnet|\bseat|\bbelt|\bbumper|\bmount/i,
    'body',
  ],
  [/\bexhaust|\bemission|\bsmoke|\bleak|\bnoise|\bcatalyst|\blambda/i, 'emissions'],
];

/** Picks the area a defect belongs to, from its manual reference or failing that its wording. */
export function categoriseDefect(text: string): DefectCategory {
  const ref = /\((\d+)\.\d+(?:\.\d+)?[^)]*\)?\s*\)?\s*$/.exec(text.trim());
  if (ref) {
    const section = Number(ref[1]);
    const byRef = BY_SECTION.get(section);
    if (byRef) return byRef;
    if (section === 0 || section === 7) return 'other';
  }
  for (const [pattern, category] of KEYWORDS) if (pattern.test(text)) return category;
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
