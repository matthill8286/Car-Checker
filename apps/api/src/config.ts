import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ConfigSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** `mock` serves every source from recorded fixtures; `live` calls the real APIs. */
  CARCHECK_MODE: z.enum(['mock', 'live']).default('mock'),
  /** Delay added to each fixture response in mock mode, so streaming is visible in the UI. */
  MOCK_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
  FIXTURES_DIR: z.string().default(fileURLToPath(new URL('../fixtures', import.meta.url))),
  /** Comma-separated origins allowed to call the API from a browser. Empty means same origin only. */
  CORS_ORIGIN: z.string().default(''),
  SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  DVLA_API_KEY: z.string().optional(),
  DVLA_BASE_URL: z
    .string()
    .url()
    .default('https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry'),

  DVSA_CLIENT_ID: z.string().optional(),
  DVSA_CLIENT_SECRET: z.string().optional(),
  DVSA_API_KEY: z.string().optional(),
  /** Sent with the DVSA onboarding email; differs per tenant. */
  DVSA_TOKEN_URL: z.string().url().optional(),
  DVSA_SCOPE: z.string().default('https://tapi.dvsa.gov.uk/.default'),
  DVSA_BASE_URL: z.string().url().default('https://history.mot.api.gov.uk'),

  /** Optional Socrata app token; raises RDW rate limits but is not required. */
  RDW_APP_TOKEN: z.string().optional(),
  RDW_BASE_URL: z.string().url().default('https://opendata.rdw.nl'),

  NHTSA_BASE_URL: z.string().url().default('https://vpic.nhtsa.dot.gov'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings from .env files and Compose as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  return ConfigSchema.parse(cleaned);
}
