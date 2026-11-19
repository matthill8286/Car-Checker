import { summariseCheck, type Check, type CheckSummary } from '@carcheck/core';
import { desc, eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { checks } from '../db/schema.js';

/** Persistence for checks: Postgres when DATABASE_URL is set, otherwise memory. */
export interface CheckStore {
  save(check: Check): Promise<void>;
  get(id: string): Promise<Check | null>;
  /** Most recent first. */
  list(limit: number): Promise<CheckSummary[]>;
}

export class InMemoryCheckStore implements CheckStore {
  private readonly checks = new Map<string, Check>();

  constructor(private readonly limit = 500) {}

  async save(check: Check): Promise<void> {
    this.checks.delete(check.id);
    this.checks.set(check.id, structuredClone(check));
    while (this.checks.size > this.limit) {
      const oldest = this.checks.keys().next().value;
      if (oldest === undefined) break;
      this.checks.delete(oldest);
    }
  }

  async get(id: string): Promise<Check | null> {
    const check = this.checks.get(id);
    return check ? structuredClone(check) : null;
  }

  async list(limit: number): Promise<CheckSummary[]> {
    return [...this.checks.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(summariseCheck);
  }
}

type CheckRow = typeof checks.$inferSelect;

function toCheck(row: CheckRow): Check {
  return {
    id: row.id,
    query: row.query,
    status: row.status,
    identifier: row.identifier,
    alternatives: row.alternatives,
    sources: row.sources,
    record: row.record ?? null,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    vehicleId: row.vehicleId ?? null,
  };
}

export class PostgresCheckStore implements CheckStore {
  constructor(private readonly db: Database) {}

  async save(check: Check): Promise<void> {
    const values = {
      id: check.id,
      query: check.query,
      status: check.status,
      identifierKind: check.identifier.kind,
      identifierValue: check.identifier.value,
      identifier: check.identifier,
      alternatives: check.alternatives,
      sources: check.sources,
      record: check.record,
      title: summariseCheck(check).title,
      createdAt: new Date(check.createdAt),
      completedAt: check.completedAt ? new Date(check.completedAt) : null,
      vehicleId: check.vehicleId ?? null,
    };
    await this.db
      .insert(checks)
      .values(values)
      .onConflictDoUpdate({
        target: checks.id,
        set: {
          status: values.status,
          sources: values.sources,
          record: values.record,
          title: values.title,
          completedAt: values.completedAt,
          vehicleId: values.vehicleId,
        },
      });
  }

  async get(id: string): Promise<Check | null> {
    const [row] = await this.db.select().from(checks).where(eq(checks.id, id)).limit(1);
    return row ? toCheck(row) : null;
  }

  async list(limit: number): Promise<CheckSummary[]> {
    const rows = await this.db
      .select({
        id: checks.id,
        query: checks.query,
        status: checks.status,
        identifier: checks.identifier,
        title: checks.title,
        createdAt: checks.createdAt,
      })
      .from(checks)
      .orderBy(desc(checks.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
}
