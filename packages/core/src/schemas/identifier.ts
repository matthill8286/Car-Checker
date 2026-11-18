import { z } from 'zod';

export const CountryCodeSchema = z.enum(['GB', 'NL']).meta({ id: 'CountryCode' });
export type CountryCode = z.infer<typeof CountryCodeSchema>;

/** What the user says the input is. `auto` detects it from the format. */
export const QueryHintSchema = z.enum(['auto', 'GB', 'NL', 'VIN']).meta({ id: 'QueryHint' });
export type QueryHint = z.infer<typeof QueryHintSchema>;

export const UkRegIdentifierSchema = z
  .object({
    kind: z.literal('uk_reg'),
    country: z.literal('GB'),
    value: z.string(),
    display: z.string(),
    format: z.enum(['current', 'prefix', 'suffix', 'dateless']),
    issuePeriod: z.object({ from: z.string(), to: z.string() }).nullable(),
    northernIreland: z.boolean(),
  })
  .meta({ id: 'UkRegIdentifier' });

export const NlPlateIdentifierSchema = z
  .object({
    kind: z.literal('nl_plate'),
    country: z.literal('NL'),
    value: z.string(),
    display: z.string(),
    sidecode: z.number().int(),
  })
  .meta({ id: 'NlPlateIdentifier' });

export const VinIdentifierSchema = z
  .object({
    kind: z.literal('vin'),
    country: z.null(),
    value: z.string(),
    display: z.string(),
    wmi: z.string(),
    region: z
      .enum(['africa', 'asia', 'europe', 'north_america', 'oceania', 'south_america'])
      .nullable(),
    checkDigitMatches: z.boolean(),
    modelYearCandidates: z.array(z.number().int()),
  })
  .meta({ id: 'VinIdentifier' });

export const IdentifierSchema = z
  .discriminatedUnion('kind', [UkRegIdentifierSchema, NlPlateIdentifierSchema, VinIdentifierSchema])
  .meta({ id: 'Identifier' });

export type UkRegIdentifier = z.infer<typeof UkRegIdentifierSchema>;
export type NlPlateIdentifier = z.infer<typeof NlPlateIdentifierSchema>;
export type VinIdentifier = z.infer<typeof VinIdentifierSchema>;
export type Identifier = z.infer<typeof IdentifierSchema>;
export type IdentifierKind = Identifier['kind'];
