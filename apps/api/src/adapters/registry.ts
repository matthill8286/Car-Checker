import type { Config } from '../config.js';
import { DvlaAdapter } from './dvla.js';
import { DvsaMotAdapter } from './dvsa-mot.js';
import { ManualAdapter } from './manual.js';
import { NhtsaVpicAdapter } from './nhtsa-vpic.js';
import { RdwAdapter } from './rdw.js';
import type { ManualReportStore } from '../manual/store.js';
import type { SourceAdapter } from './types.js';

export function createAdapters(config: Config, manualReports?: ManualReportStore): SourceAdapter[] {
  return [
    new DvlaAdapter({ apiKey: config.DVLA_API_KEY, baseUrl: config.DVLA_BASE_URL }),
    new DvsaMotAdapter({
      clientId: config.DVSA_CLIENT_ID,
      clientSecret: config.DVSA_CLIENT_SECRET,
      apiKey: config.DVSA_API_KEY,
      tokenUrl: config.DVSA_TOKEN_URL,
      scope: config.DVSA_SCOPE,
      baseUrl: config.DVSA_BASE_URL,
    }),
    new RdwAdapter({ appToken: config.RDW_APP_TOKEN, baseUrl: config.RDW_BASE_URL }),
    new NhtsaVpicAdapter({ baseUrl: config.NHTSA_BASE_URL }),
    ...(manualReports ? [new ManualAdapter(manualReports)] : []),
  ];
}
