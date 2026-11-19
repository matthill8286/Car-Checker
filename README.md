# Car Check

Personal pre-purchase vehicle check. Enter a UK registration, a Dutch plate or a VIN; the API asks
every source that can answer, merges what they say into one record, and streams it to the web app.

## Layout

| Path            | What it is                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Pure logic and shared types: UK reg, Dutch plate and VIN validation, country detection, Zod schemas, merge and mileage analysis. No I/O. |
| `apps/api`      | Fastify API. The only part that talks to external sources (and, from M2, the database). One adapter per source.                          |
| `apps/web`      | Next.js App Router UI. Talks to the API only over HTTP, through a client generated from the API's OpenAPI document.                      |

## Running it

```bash
pnpm install
cp .env.example .env        # optional; mock mode needs nothing
pnpm dev                    # api on :4000, web on :3000
```

`pnpm dev` runs in **mock mode**: every source answers from `apps/api/fixtures`. Try `AB12 CDE`,
`WX65 ABC` (clocked odometer), `ER12 ROR` (DVLA failure), `ZK-472-T` (Dutch) or
`1HGCM82633A004352` (VIN). The fixtures are hand-built from the documented response shapes, not
real recordings; see `apps/api/fixtures/README.md`.

Set `CARCHECK_MODE=live` and the keys in `.env` to call the real APIs. A source without its keys
is reported as skipped rather than failing the check.

| Command                                              | Does                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm test`                                          | Vitest across all packages (fixtures; no network)                                                 |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Static checks                                                                                     |
| `pnpm gen:client`                                    | Regenerates `apps/api/openapi.json` and the web app's typed client after a route or schema change |
| `pnpm build`                                         | Builds everything                                                                                 |

## API

| Route                                        |                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST /api/checks`                           | `{ "query": "AB12 CDE", "hint": "auto" \| "GB" \| "NL" \| "VIN", "fresh": false }` → `202` with the running check |
| `GET /api/checks/:id`                        | The check, its per-source status and the merged record so far                                                     |
| `GET /api/checks/:id/stream`                 | Server-sent events: `snapshot`, then `source` and `record` as sources answer, then `complete`                     |
| `GET /api/health`                            | Mode and which sources are configured                                                                             |
| `GET /api/manual-reports?registration=&vin=` | Bought reports for a vehicle, newest first                                                                        |
| `POST /api/manual-reports`                   | Record what a bought report found (finance, stolen, write-off, keepers, plate changes, provider and cost)         |
| `PUT` / `DELETE /api/manual-reports/:id`     | Correct or remove a bought report                                                                                 |
| `GET /api/docs`                              | Swagger UI; `GET /api/openapi.json` for the document                                                              |

## Storage and caching

With `DATABASE_URL` set, checks and every source answer are stored in Postgres (Drizzle; schema in
`apps/api/src/db/schema.ts`, migrations in `apps/api/drizzle`, applied on startup unless
`DB_MIGRATE=false`). Without it, both live in memory, which is fine for development.

- `checks`: one row per check; its sources, record and identifiers as JSONB.
- `source_responses`: every answer a source gave, with the raw upstream payload as JSONB.

A source's stored answer is reused while fresh: 24 hours for DVLA, DVSA and RDW, 30 days for
NHTSA, 1 hour for "not found". Errors are never cached. `"fresh": true` (or "Check again" in the
UI) skips the cache. The terms behind these choices are in `docs/source-terms.md`.

After changing the schema, run `pnpm --filter @carcheck/api db:generate` and commit the new
migration. Tests run against an in-process Postgres (PGlite), so they need no database.

## Sources

| Source                       | Input       | Adapter                               | Needs                                                                    |
| ---------------------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------ |
| DVLA Vehicle Enquiry Service | UK reg      | `apps/api/src/adapters/dvla.ts`       | `DVLA_API_KEY`                                                           |
| DVSA MOT History             | UK reg      | `apps/api/src/adapters/dvsa-mot.ts`   | `DVSA_CLIENT_ID`, `DVSA_CLIENT_SECRET`, `DVSA_API_KEY`, `DVSA_TOKEN_URL` |
| RDW open data                | Dutch plate | `apps/api/src/adapters/rdw.ts`        | nothing (`RDW_APP_TOKEN` optional)                                       |
| NHTSA vPIC                   | VIN         | `apps/api/src/adapters/nhtsa-vpic.ts` | nothing                                                                  |

Adding a source: implement `SourceAdapter` (`apps/api/src/adapters/types.ts`), add it to
`registry.ts`, add fixtures and tests. If it reveals a VIN, return it in `discovered` and the
orchestrator will run VIN sources next.

## Deploying

Two containers, `api` and `web`, built from the repo root:

```bash
cp .env.example .env   # set CARCHECK_MODE=live, keys, and PROXY_NETWORK
docker compose up -d --build
```

On the server, give the app its own database and role in the existing Postgres (not Supabase's
internal one), then set `DATABASE_URL` in `.env`:

```sql
CREATE ROLE carcheck LOGIN PASSWORD '…';
CREATE DATABASE carcheck OWNER carcheck;
```

The api container must be able to reach that Postgres: either put it on the Postgres container's
Docker network or use the host's address.

The stack joins the existing reverse proxy's Docker network (`PROXY_NETWORK`) and publishes no
ports. Point the chosen subdomain at it in the existing proxy: `/api` to `api:4000`, everything
else to `web:3000`. If the proxy can only target one upstream, send everything to `web:3000`;
Next forwards `/api` to the API itself. Do not add a second proxy, and keep proxy buffering off
for `/api/checks/*/stream` (the API sends `X-Accel-Buffering: no`).

For a local container run without the server's proxy:
`docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` (mock mode, its own
Postgres on port 5433, web on 3000 and api on 4000).

### Backups

`deploy/backup.sh` dumps the `carcheck` database, keeps 14 days of dumps on the server and
copies each one off the box with rsync. Copy `deploy/backup.env.example` to `deploy/backup.env`,
set `PG_CONTAINER` (the existing Postgres container) or `DATABASE_URL`, and `BACKUP_REMOTE`, then
add it to cron:

```cron
15 3 * * * /opt/car-check/deploy/backup.sh >> /var/log/carcheck-backup.log 2>&1
```

Restore with `gunzip -c carcheck-<stamp>.sql.gz | psql "$DATABASE_URL"`. Test a restore once
after setting it up.

## Bought reports

Finance, theft and write-off records only exist in paid checks (HPI, Total Car Check,
carVertical and others). Buy one per car, then use "Record a bought report" on the report page.
The `manual` source adds every bought report saved for the registration or VIN to each check,
so its findings sit in the same verdict as the free data. It reads the local database, so it is
never cached and saving a report then re-running the check shows it straight away.
