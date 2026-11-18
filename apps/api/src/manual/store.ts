import { randomUUID } from 'node:crypto';
import { normalizeInput, type ManualReport, type ManualReportFields } from '@carcheck/core';
import { desc, eq, or } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { manualReports } from '../db/schema.js';

export interface VehicleKeys {
  registration?: string | null;
  vin?: string | null;
}

/** Bought reports, stored as typed in. Postgres when DATABASE_URL is set, otherwise memory. */
export interface ManualReportStore {
  /** Reports matching the registration or the VIN, newest purchase first. */
  find(keys: VehicleKeys): Promise<ManualReport[]>;
  get(id: string): Promise<ManualReport | null>;
  create(fields: ManualReportFields): Promise<ManualReport>;
  update(id: string, fields: ManualReportFields): Promise<ManualReport | null>;
  delete(id: string): Promise<boolean>;
}

function key(value: string | null | undefined): string | null {
  const v = value ? normalizeInput(value) : '';
  return v || null;
}

/** Normalises the plate and VIN the way checks store them, so lookups match. */
function build(
  fields: ManualReportFields,
  id: string,
  createdAt: string,
  updatedAt: string,
): ManualReport {
  return {
    ...fields,
    registration: key(fields.registration),
    vin: key(fields.vin),
    plateChanges: fields.plateChanges.map((p) => ({
      ...p,
      from: normalizeInput(p.from),
      to: normalizeInput(p.to),
    })),
    keeperChanges: [...fields.keeperChanges].sort(),
    id,
    createdAt,
    updatedAt,
  };
}

const newestFirst = (a: ManualReport, b: ManualReport) =>
  b.purchasedOn.localeCompare(a.purchasedOn) || b.createdAt.localeCompare(a.createdAt);

export class InMemoryManualReportStore implements ManualReportStore {
  private readonly reports = new Map<string, ManualReport>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async find(keys: VehicleKeys): Promise<ManualReport[]> {
    const reg = key(keys.registration);
    const vin = key(keys.vin);
    return [...this.reports.values()]
      .filter((r) => (reg && r.registration === reg) || (vin && r.vin === vin))
      .sort(newestFirst)
      .map((r) => structuredClone(r));
  }

  async get(id: string): Promise<ManualReport | null> {
    const r = this.reports.get(id);
    return r ? structuredClone(r) : null;
  }

  async create(fields: ManualReportFields): Promise<ManualReport> {
    const at = this.now().toISOString();
    const report = build(fields, randomUUID(), at, at);
    this.reports.set(report.id, report);
    return structuredClone(report);
  }

  async update(id: string, fields: ManualReportFields): Promise<ManualReport | null> {
    const existing = this.reports.get(id);
    if (!existing) return null;
    const report = build(fields, id, existing.createdAt, this.now().toISOString());
    this.reports.set(id, report);
    return structuredClone(report);
  }

  async delete(id: string): Promise<boolean> {
    return this.reports.delete(id);
  }
}

export class PostgresManualReportStore implements ManualReportStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async find(keys: VehicleKeys): Promise<ManualReport[]> {
    const reg = key(keys.registration);
    const vin = key(keys.vin);
    const conditions = [
      reg ? eq(manualReports.registration, reg) : undefined,
      vin ? eq(manualReports.vin, vin) : undefined,
    ].filter((c) => c !== undefined);
    if (conditions.length === 0) return [];
    const rows = await this.db
      .select({ report: manualReports.report })
      .from(manualReports)
      .where(or(...conditions))
      .orderBy(desc(manualReports.createdAt));
    return rows.map((r) => r.report).sort(newestFirst);
  }

  async get(id: string): Promise<ManualReport | null> {
    const [row] = await this.db
      .select({ report: manualReports.report })
      .from(manualReports)
      .where(eq(manualReports.id, id))
      .limit(1);
    return row?.report ?? null;
  }

  async create(fields: ManualReportFields): Promise<ManualReport> {
    const at = this.now();
    const report = build(fields, randomUUID(), at.toISOString(), at.toISOString());
    await this.db.insert(manualReports).values({
      id: report.id,
      registration: report.registration,
      vin: report.vin,
      report,
      createdAt: at,
      updatedAt: at,
    });
    return report;
  }

  async update(id: string, fields: ManualReportFields): Promise<ManualReport | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const at = this.now();
    const report = build(fields, id, existing.createdAt, at.toISOString());
    await this.db
      .update(manualReports)
      .set({ registration: report.registration, vin: report.vin, report, updatedAt: at })
      .where(eq(manualReports.id, id));
    return report;
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(manualReports)
      .where(eq(manualReports.id, id))
      .returning({ id: manualReports.id });
    return deleted.length > 0;
  }
}
