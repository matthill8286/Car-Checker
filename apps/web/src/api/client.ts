import type { CheckEvent, QueryHint } from '@carcheck/core';
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

export type Check = components['schemas']['Check'];
export type CreatedCheck = components['schemas']['CreatedCheck'];
export type ApiError = components['schemas']['ApiError'];

/**
 * Empty means same origin: the reverse proxy (or Next's rewrite in dev) routes `/api` to the
 * API. Set NEXT_PUBLIC_API_BASE_URL to call the API on another origin instead.
 */
const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

export const api = createClient<paths>({ baseUrl });

export type StartResult = { ok: true; created: CreatedCheck } | { ok: false; error: ApiError };

export async function startCheck(query: string, hint: QueryHint = 'auto'): Promise<StartResult> {
  const { data, error } = await api.POST('/api/checks', { body: { query, hint } });
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
  const source = new EventSource(`${baseUrl}/api/checks/${encodeURIComponent(id)}/events`);
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
