import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

const app = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: 'silent' }));
await app.ready();
const out = fileURLToPath(new URL('../../openapi.json', import.meta.url));
await writeFile(out, JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
console.log(`Wrote ${out}`);
