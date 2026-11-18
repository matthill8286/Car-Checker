import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** Sent as JSON unless `form` is set. */
  body?: unknown;
  /** Sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
  /**
   * Path of the recorded response under the fixtures directory, without `.json`. Ignored by the
   * live client.
   */
  fixture: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface HttpClient {
  readonly mock: boolean;
  request(req: HttpRequest): Promise<HttpResponse>;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class FetchHttpClient implements HttpClient {
  readonly mock = false;

  async request(req: HttpRequest): Promise<HttpResponse> {
    const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
    let body: string | undefined;
    if (req.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(req.form).toString();
    } else if (req.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
    const res = await fetch(req.url, { method: req.method, headers, body, signal: req.signal });
    const text = await res.text();
    let parsed: unknown = text;
    if (text.length > 0 && (res.headers.get('content-type') ?? '').includes('json')) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new UpstreamError(`Invalid JSON from ${new URL(req.url).host}`, res.status);
      }
    }
    return { status: res.status, body: parsed };
  }
}

/**
 * Serves recorded responses from `<dir>/<fixture>.json`, each shaped `{ "status": 200, "body": … }`.
 * A missing fixture is a 404, so unknown vehicles behave like the real APIs.
 */
export class FixtureHttpClient implements HttpClient {
  readonly mock = true;

  constructor(
    private readonly dir: string,
    private readonly latencyMs = 0,
  ) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
    req.signal?.throwIfAborted();
    const file = path.join(this.dir, `${req.fixture}.json`);
    if (!file.startsWith(path.resolve(this.dir) + path.sep)) {
      throw new Error('Fixture path escapes the fixtures directory');
    }
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, body: null };
      throw err;
    }
    const recorded = JSON.parse(raw) as HttpResponse;
    return { status: recorded.status, body: recorded.body };
  }
}
