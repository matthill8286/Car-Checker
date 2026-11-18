import { loadConfig, type Config } from '../src/config.js';
import { buildApp, type AppOverrides } from '../src/app.js';

export const NOW = new Date('2026-11-18T12:00:00Z');

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ LOG_LEVEL: 'silent', CARCHECK_MODE: 'mock', ...env });
}

export async function testApp(env: Record<string, string> = {}, overrides: AppOverrides = {}) {
  const app = await buildApp(testConfig(env), { now: () => NOW, ...overrides });
  await app.ready();
  return app;
}

/** Parses an SSE body into its events. */
export function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(':'))
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7) ?? 'message';
      const data = lines
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      return { event, data: JSON.parse(data) as unknown };
    });
}
