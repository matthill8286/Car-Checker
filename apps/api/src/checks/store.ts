import type { Check } from '@carcheck/core';

/** Persistence for checks. In memory for M1; Postgres via Drizzle arrives in M2. */
export interface CheckStore {
  save(check: Check): Promise<void>;
  get(id: string): Promise<Check | null>;
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
}
