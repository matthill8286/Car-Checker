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

| Route                        |                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `POST /api/checks`           | `{ "query": "AB12 CDE", "hint": "auto" \| "GB" \| "NL" \| "VIN" }` → `202` with the running check |
| `GET /api/checks/:id`        | The check, its per-source status and the merged record so far                                     |
| `GET /api/checks/:id/events` | Server-sent events: `snapshot`, then `source` and `record` as sources answer, then `complete`     |
| `GET /api/health`            | Mode and which sources are configured                                                             |
| `GET /api/docs`              | Swagger UI; `GET /api/openapi.json` for the document                                              |

Checks are held in memory for now; Postgres via Drizzle arrives in M2.

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

The stack joins the existing reverse proxy's Docker network (`PROXY_NETWORK`) and publishes no
ports. Point the chosen subdomain at it in the existing proxy: `/api` to `api:4000`, everything
else to `web:3000`. If the proxy can only target one upstream, send everything to `web:3000`;
Next forwards `/api` to the API itself. Do not add a second proxy, and keep proxy buffering off
for `/api/checks/*/events` (the API sends `X-Accel-Buffering: no`).

For a local container run without the server's proxy:
`docker compose -f docker-compose.yml -f docker-compose.local.yml up --build` (mock mode, ports
3000 and 4000).
