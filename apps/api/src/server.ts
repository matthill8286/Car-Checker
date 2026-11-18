import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config, { fixtureLatencyMs: config.MOCK_LATENCY_MS });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ mode: config.CARCHECK_MODE }, 'car check api ready');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
