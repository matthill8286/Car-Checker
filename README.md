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
| `GET /api/vehicles`                          | Saved vehicles (the garage), most recently edited first                                                           |
| `GET /api/vehicles/:id`                      | One vehicle with its latest check summary and saved notes                                                         |
| `POST /api/vehicles/:id/notes`               | Save to the garage, or replace notes, asking price (pence) and listing link                                       |
| `DELETE /api/vehicles/:id/saved`             | Remove from the garage (the vehicle and its checks stay)                                                          |
| `GET /api/jobs`                              | Background jobs, their schedules and last runs                                                                    |
| `POST /api/jobs/:name/run`                   | Run `source-keepalive` or `refresh-saved` now                                                                     |
| `GET /api/docs`                              | Swagger UI; `GET /api/openapi.json` for the document                                                              |

## Storage and caching

With `DATABASE_URL` set, checks and every source answer are stored in Postgres (Drizzle; schema in
`apps/api/src/db/schema.ts`, migrations in `apps/api/drizzle`, applied on startup unless
`DB_MIGRATE=false`). Without it, both live in memory, which is fine for development.

- `checks`: one row per check; its sources, record and identifiers as JSONB.
- `source_responses`: every answer a source gave, with the raw upstream payload as JSONB.
- `vehicles`, `vehicle_status`, `mot_tests`, `mot_defects`, `mileage_readings`, `field_sources`:
  normalised tables, re-projected from each finished check so they mirror its latest record.
- `saved_vehicles`: the garage (notes, asking price, listing link).
- `manual_reports`: bought reports typed in by hand.

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

Car check runs on the netcup box on its own: its own Caddy, Postgres and Docker network, and
nothing shared with the other apps there. Another app's Caddy already holds ports 80 and 443, so
car check's Caddy serves `https://carcheck.impkt-apps.duckdns.org:8443` behind one basic-auth
login. It gets its certificate from Let's Encrypt over the DNS challenge through DuckDNS, which
needs no port 80. DuckDNS already answers every name under `impkt-apps.duckdns.org` with the
box's address, so there is no DNS record to add.

Deploys run from GitHub Actions (`.github/workflows/deploy.yml`). After CI passes on `main`, it
builds the `api`, `web` and `caddy` images to GHCR, copies `deploy/compose.yml` and
`deploy/backup.sh` to `~/carcheck` on the box, writes `.env` from a secret, then pulls,
restarts and checks the site answers. Until the secrets exist, the workflow skips itself.

Once, on the box: open the port with `sudo ufw allow 8443/tcp`.

Secrets on the repo's `production` environment:

| Secret                                 | Value                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_HOST`, `DEPLOY_USER`           | The box, and a user in the `docker` group                                                                     |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | That user's private key, and `ssh-keyscan <host>` output                                                      |
| `CARCHECK_ENV`                         | The box's `.env`, from `deploy/.env.example` (domain, DuckDNS token, login hash, database password, API keys) |
| `CARCHECK_URL`                         | `https://carcheck.impkt-apps.duckdns.org:8443`, for the check after a deploy                                  |
| `CARCHECK_AUTH`                        | Optional `user:password`, so that check can log in                                                            |

Run it by hand from the Actions tab ("Deploy", "Run workflow") once the secrets are set.

For a local container run without the box:
`docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` (mock mode, its own
Postgres on port 5433, web on 3000 and api on 4000).

### Backups

`deploy/backup.sh` dumps the `carcheck` database, keeps 14 days of dumps on the server and
copies each one off the box with rsync. The deploy copies the script to `~/carcheck`; on the box, create
`~/carcheck/backup.env` from `deploy/backup.env.example` with `PG_CONTAINER=carcheck-postgres-1`,
`BACKUP_DIR=$HOME/carcheck/backups` and `BACKUP_REMOTE`, then add it to the deploy user's cron:

```cron
15 3 * * * $HOME/carcheck/backup.sh >> $HOME/carcheck/backup.log 2>&1
```

Restore with `gunzip -c carcheck-<stamp>.sql.gz | psql "$DATABASE_URL"`. Test a restore once
after setting it up.

## Bought reports

Finance, theft and write-off records only exist in paid checks (HPI, Total Car Check,
carVertical and others). Buy one per car, then use "Record a bought report" on the report page.
The `manual` source adds every bought report saved for the registration or VIN to each check,
so its findings sit in the same verdict as the free data. It reads the local database, so it is
never cached and saving a report then re-running the check shows it straight away.

## Garage, compare and PDF

"Save to garage" on a report keeps the car with notes, an asking price and the listing link.
The Garage page lists saved cars; tick two to compare them side by side. "Save as PDF" on a
report opens the browser's print dialog with a print stylesheet (A4, light theme, no buttons or
forms); choose "Save as PDF". The file name is the plate, car and date.

## Background jobs

With `DATABASE_URL` set, the API schedules two jobs with pg-boss (tables in the `pgboss` schema
of the same database, so no Redis):

- `source-keepalive`, weekly by default (`KEEPALIVE_CRON`): one lookup at DVLA and DVSA so an
  idle key is never revoked (DVSA revokes after 90 days). It looks up `KEEPALIVE_REG`; "not
  found" still counts as a use. Sources without keys are skipped.
- `refresh-saved`, off by default (`REFRESH_CRON`): a new check for every saved vehicle.

Run either now with `curl -X POST https://<host>/api/jobs/source-keepalive/run`; `GET /api/jobs`
shows each one's last run. `JOBS_ENABLED=false` turns the schedules off.
