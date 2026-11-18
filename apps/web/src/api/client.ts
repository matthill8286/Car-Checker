import type { CheckEvent, QueryHint } from '@carcheck/core';
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type Check = components['schemas']['Check'];
export type CreatedCheck = components['schemas']['CreatedCheck'];
export type ApiError = components['schemas']['ApiError'];
export type CheckSummary = components['schemas']['CheckSummary'];

/**
 * Empty means same origin: the reverse proxy (or Next's rewrite in dev) routes `/api` to the
 * API. Set NEXT_PUBLIC_API_BASE_URL to call the API on another origin instead.
 */
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const api = createClient<paths>({ baseUrl });

export type StartResult = { ok: true; created: CreatedCheck } | { ok: false; error: ApiError };

export async function startCheck(
  query: string,
  hint: QueryHint = 'auto',
  fresh = false,
): Promise<StartResult> {
  const { data, error } = await api.POST('/api/checks', { body: { query, hint, fresh } });
  if (data) return { ok: true, created: data };
  return {
    ok: false,
    error: error ?? { error: 'network', message: 'Could not reach the car check API.' },
  };
}

export async function getCheck(id: string): Promise<Check | null> {
  const { data } = await api.GET('/api/checks/{id}', { params: { path: { id } } });
  return data ?? null;
}

export async function listChecks(limit = 10): Promise<CheckSummary[]> {
  const { data } = await api.GET('/api/checks', { params: { query: { limit } } });
  return data?.checks ?? [];
}

const EVENT_TYPES: ReadonlyArray<CheckEvent['type']> = ['snapshot', 'source', 'record', 'complete'];

/**
 * Follows a check's progress over server-sent events. Returns a function that stops listening.
 * The stream ends itself after `complete`.
 */
export function followCheck(
  id: string,
  onEvent: (event: CheckEvent) => void,
  onError: () => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/checks/${encodeURIComponent(id)}/stream`);
  let done = false;
  const listener = (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as CheckEvent;
    if (event.type === 'complete') {
      done = true;
      source.close();
    }
    onEvent(event);
  };
  for (const type of EVENT_TYPES) source.addEventListener(type, listener as EventListener);
  source.onerror = () => {
    // EventSource retries on its own; once the check is done there is nothing to retry.
    if (done) return;
    if (source.readyState === EventSource.CLOSED) onError();
  };
  return () => {
    done = true;
    source.close();
  };
}

export type ManualReport = components['schemas']['ManualReport'];
export type ManualReportBody = components['schemas']['ManualReportBodyInput'];

export type SaveResult = { ok: true; report: ManualReport } | { ok: false; error: ApiError };

const unreachable: ApiError = { error: 'network', message: 'Could not reach the car check API.' };

/** Creates a bought report, or replaces one when `id` is given. */
export async function saveManualReport(body: ManualReportBody, id?: string): Promise<SaveResult> {
  const { data, error } = id
    ? await api.PUT('/api/manual-reports/{id}', { params: { path: { id } }, body })
    : await api.POST('/api/manual-reports', { body });
  return data ? { ok: true, report: data } : { ok: false, error: error ?? unreachable };
}

export async function deleteManualReport(id: string): Promise<boolean> {
  const { response } = await api.DELETE('/api/manual-reports/{id}', { params: { path: { id } } });
  return response.status === 204;
}
