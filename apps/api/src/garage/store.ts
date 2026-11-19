import { randomUUID } from 'node:crypto';
import {
  categoriseDefect,
  vehicleFromCheck,
  type Check,
  type Identifier,
  type SaveVehicleFields,
  type SavedDetails,
  type VehicleSummary,
} from '@carcheck/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  fieldSources,
  mileageReadings,
  motDefects,
  motTests,
  savedVehicles,
  vehicleStatus,
  vehicles,
} from '../db/schema.js';

/**
 * Vehicles as of their latest finished check, and the garage of saved ones. Postgres keeps
 * them in the plan's normalised tables; memory mode keeps the latest check per vehicle.
 */
export interface VehicleStore {
  /** Files a finished check under its vehicle. Returns the vehicle id, or null without a record. */
  project(check: Check): Promise<string | null>;
  get(id: string): Promise<VehicleSummary | null>;
  /** Saved vehicles, most recently saved or edited first. */
  listSaved(): Promise<VehicleSummary[]>;
  save(id: string, fields: SaveVehicleFields): Promise<VehicleSummary | null>;
  unsave(id: string): Promise<boolean>;
}

function keyOf(identifier: Pick<Identifier, 'kind' | 'value'>): string {
  return `${identifier.kind}:${identifier.value}`;
}

export class InMemoryVehicleStore implements VehicleStore {
  private readonly ids = new Map<string, string>();
  private readonly latest = new Map<string, Check>();
  private readonly saved = new Map<string, SavedDetails>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async project(check: Check): Promise<string | null> {
    if (!check.record) return null;
    const key = keyOf(check.identifier);
    const id = this.ids.get(key) ?? randomUUID();
    this.ids.set(key, id);
    this.latest.set(id, structuredClone(check));
    return id;
  }

  private summary(id: string): VehicleSummary | null {
    const check = this.latest.get(id);
    if (!check) return null;
    return { id, ...vehicleFromCheck(check), saved: this.saved.get(id) ?? null };
  }

  async get(id: string): Promise<VehicleSummary | null> {
    return this.summary(id);
  }

  async listSaved(): Promise<VehicleSummary[]> {
    return [...this.saved.entries()]
      .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
      .map(([id]) => this.summary(id))
      .filter((v): v is VehicleSummary => v !== null);
  }

  async save(id: string, fields: SaveVehicleFields): Promise<VehicleSummary | null> {
    if (!this.latest.has(id)) return null;
    const at = this.now().toISOString();
    this.saved.set(id, { ...fields, savedAt: this.saved.get(id)?.savedAt ?? at, updatedAt: at });
    return this.summary(id);
  }

  async unsave(id: string): Promise<boolean> {
    return this.saved.delete(id);
  }
}

type VehicleRow = typeof vehicles.$inferSelect;
type StatusRow = typeof vehicleStatus.$inferSelect;
type SavedRow = typeof savedVehicles.$inferSelect;
type MileageRow = typeof mileageReadings.$inferSelect;

function toSummary(
  v: VehicleRow,
  status: StatusRow | null,
  saved: SavedRow | null,
  mileage: MileageRow | null,
): VehicleSummary {
  return {
    id: v.id,
    identifier: v.identifier,
    title: [v.make, v.model].filter(Boolean).join(' ') || null,
    registration: v.registration,
    vin: v.vin,
    colour: v.colour,
    fuelType: v.fuelType,
    firstRegistrationDate: v.firstRegistered,
    latestCheckId: v.latestCheckId,
    checkedAt: v.checkedAt.toISOString(),
    verdict: v.verdict ?? null,
    concerns: v.concerns,
    taxStatus: status?.taxStatus ?? null,
    motStatus: status?.motStatus ?? null,
    motExpiryDate: status?.motExpiry ?? null,
    latestMileage: mileage
      ? { date: mileage.date.toISOString(), odometer: { value: mileage.value, unit: mileage.unit } }
      : null,
    saved: saved
      ? {
          notes: saved.notes,
          askingPricePence: saved.askingPricePence,
          listingUrl: saved.listingUrl,
          savedAt: saved.savedAt.toISOString(),
          updatedAt: saved.updatedAt.toISOString(),
        }
      : null,
  };
}

export class PostgresVehicleStore implements VehicleStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Replaces the vehicle's rows with what this check found, in one transaction. */
  async project(check: Check): Promise<string | null> {
    const record = check.record;
    if (!record) return null;
    const v = vehicleFromCheck(check);
    const f = record.facts;
    const at = this.now();
    return this.db.transaction(async (tx) => {
      const values = {
        identifierKind: check.identifier.kind,
        identifierValue: check.identifier.value,
        identifier: check.identifier,
        registration: v.registration,
        vin: v.vin,
        country: f.country ?? check.identifier.country ?? null,
        make: f.make ?? null,
        model: f.model ?? null,
        variant: f.variant ?? null,
        colour: f.colour ?? null,
        fuelType: f.fuelType ?? null,
        engineCc: f.engineCapacityCc ?? null,
        firstRegistered: f.firstRegistrationDate ?? null,
        verdict: v.verdict,
        concerns: v.concerns,
        latestCheckId: check.id,
        checkedAt: new Date(v.checkedAt),
        updatedAt: at,
      };
      const [row] = await tx
        .insert(vehicles)
        .values({ id: randomUUID(), ...values })
        .onConflictDoUpdate({
          target: [vehicles.identifierKind, vehicles.identifierValue],
          set: values,
        })
        .returning({ id: vehicles.id });
      const id = row!.id;

      await tx
        .insert(vehicleStatus)
        .values({
          vehicleId: id,
          taxStatus: f.taxStatus ?? null,
          taxDue: f.taxDueDate ?? null,
          motStatus: f.motStatus ?? null,
          motExpiry: f.motExpiryDate ?? null,
          markedForExport: f.markedForExport ?? null,
          outstandingRecall: f.outstandingRecall ?? null,
        })
        .onConflictDoUpdate({
          target: vehicleStatus.vehicleId,
          set: {
            taxStatus: f.taxStatus ?? null,
            taxDue: f.taxDueDate ?? null,
            motStatus: f.motStatus ?? null,
            motExpiry: f.motExpiryDate ?? null,
            markedForExport: f.markedForExport ?? null,
            outstandingRecall: f.outstandingRecall ?? null,
          },
        });

      // Children are rewritten whole: the latest check is the truth (defects cascade).
      await tx.delete(motTests).where(eq(motTests.vehicleId, id));
      await tx.delete(mileageReadings).where(eq(mileageReadings.vehicleId, id));
      await tx.delete(fieldSources).where(eq(fieldSources.vehicleId, id));

      for (const t of record.motTests) {
        const [test] = await tx
          .insert(motTests)
          .values({
            vehicleId: id,
            testNumber: t.testNumber,
            completedAt: new Date(t.completedAt),
            result: t.result,
            odometer: t.odometer?.value ?? null,
            odometerUnit: t.odometer?.unit ?? null,
            odometerResult: t.odometerResult,
            expiry: t.expiryDate,
            source: t.source,
          })
          .returning({ id: motTests.id });
        if (t.defects.length > 0) {
          await tx.insert(motDefects).values(
            t.defects.map((d) => ({
              motTestId: test!.id,
              type: d.type,
              dangerous: d.dangerous,
              text: d.text,
              category: categoriseDefect(d.text),
            })),
          );
        }
      }
      const readings = record.mileage.readings;
      if (readings.length > 0) {
        const sourceOf = new Map(record.motTests.map((t) => [t.completedAt, t.source]));
        await tx.insert(mileageReadings).values(
          readings.map((r) => ({
            vehicleId: id,
            date: new Date(r.date),
            value: r.odometer.value,
            unit: r.odometer.unit,
            source: sourceOf.get(r.date) ?? 'dvsa_mot',
          })),
        );
      }
      const fetched = new Map(check.sources.map((s) => [s.source, s.fetchedAt]));
      const provenance = Object.entries(record.provenance);
      if (provenance.length > 0) {
        await tx.insert(fieldSources).values(
          provenance.map(([field, source]) => ({
            vehicleId: id,
            field,
            source,
            fetchedAt: fetched.get(source) ? new Date(fetched.get(source)!) : null,
          })),
        );
      }
      return id;
    });
  }

  private async summaries(rows: VehicleRow[]): Promise<VehicleSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [statuses, saved, mileage] = await Promise.all([
      this.db.select().from(vehicleStatus).where(inArray(vehicleStatus.vehicleId, ids)),
      this.db.select().from(savedVehicles).where(inArray(savedVehicles.vehicleId, ids)),
      this.db
        .selectDistinctOn([mileageReadings.vehicleId])
        .from(mileageReadings)
        .where(inArray(mileageReadings.vehicleId, ids))
        .orderBy(mileageReadings.vehicleId, desc(mileageReadings.date)),
    ]);
    const by = <T extends { vehicleId: string }>(list: T[]) =>
      new Map(list.map((x) => [x.vehicleId, x]));
    const s = by(statuses);
    const g = by(saved);
    const m = by(mileage);
    return rows.map((v) =>
      toSummary(v, s.get(v.id) ?? null, g.get(v.id) ?? null, m.get(v.id) ?? null),
    );
  }

  async get(id: string): Promise<VehicleSummary | null> {
    const rows = await this.db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    return (await this.summaries(rows))[0] ?? null;
  }

  async listSaved(): Promise<VehicleSummary[]> {
    const rows = await this.db
      .select({ v: vehicles })
      .from(savedVehicles)
      .innerJoin(vehicles, eq(vehicles.id, savedVehicles.vehicleId))
      .orderBy(desc(savedVehicles.updatedAt));
    return this.summaries(rows.map((r) => r.v));
  }

  async save(id: string, fields: SaveVehicleFields): Promise<VehicleSummary | null> {
    const exists = await this.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.id, id))
      .limit(1);
    if (exists.length === 0) return null;
    const at = this.now();
    await this.db
      .insert(savedVehicles)
      .values({ vehicleId: id, ...fields, savedAt: at, updatedAt: at })
      .onConflictDoUpdate({ target: savedVehicles.vehicleId, set: { ...fields, updatedAt: at } });
    return this.get(id);
  }

  async unsave(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(savedVehicles)
      .where(and(eq(savedVehicles.vehicleId, id)))
      .returning({ id: savedVehicles.vehicleId });
    return deleted.length > 0;
  }
}
