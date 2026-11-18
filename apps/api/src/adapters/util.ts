import { UpstreamError, type HttpResponse } from '../http/client.js';
import type { z } from 'zod';

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function toInt(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export function nonEmpty(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Drops undefined values so a source never "contributes" a missing fact. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function expectStatus(res: HttpResponse, source: string): void {
  if (res.status === 401 || res.status === 403) {
    throw new UpstreamError(`${source} rejected our credentials (HTTP ${res.status}).`, res.status);
  }
  if (res.status === 429) {
    throw new UpstreamError(`${source} is rate limiting us; try again shortly.`, res.status);
  }
  if (res.status >= 400) {
    throw new UpstreamError(`${source} returned HTTP ${res.status}.`, res.status);
  }
}

export function parseUpstream<S extends z.ZodType>(
  schema: S,
  body: unknown,
  source: string,
): z.infer<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new UpstreamError(`${source} sent a response in a shape we do not recognise.`);
  }
  return result.data;
}
