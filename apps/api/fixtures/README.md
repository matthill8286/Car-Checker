# Fixtures

Recorded upstream responses served by `FixtureHttpClient` in mock mode (`CARCHECK_MODE=mock`).
Each file is `{ "status": <http status>, "body": <upstream JSON> }`, at
`<source>/<identifier>.json`. A missing file is served as a 404, like an unknown vehicle.

**These are hand-built from each API's documented response shape, not captured from the live
APIs**, because no keys exist yet. Replace them with real recordings once the DVLA and DVSA keys
arrive, and keep the registrations below so the tests keep working.

| Query               | What it exercises                                                            |
| ------------------- | ---------------------------------------------------------------------------- |
| `AB12 CDE`          | Clean 2012 Ford Focus: DVLA and ten MOT tests, one fail and retest           |
| `WX65 ABC`          | BMW 320d on SORN: odometer drops 38,000 miles, dangerous defect on last test |
| `LN74 NEW`          | Nearly new Tesla: no MOT tests yet                                           |
| `ER12 ROR`          | DVLA returns 500, DVSA works: a partial check                                |
| `ZK-472-T`          | Dutch VW Golf from RDW, with an open recall                                  |
| `1HGCM82633A004352` | US Honda Accord decoded by NHTSA vPIC                                        |
| `WVWZZZ1KZ6W000001` | European VW VIN that vPIC can only partly decode                             |
| anything else valid | Every source answers "not found"                                             |
