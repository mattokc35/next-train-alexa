# Next Train — Alexa Skill

A custom Alexa skill that answers "when's my next train" and "are there any
delays or should I detour" for **PATH** (Port Authority Trans-Hudson) riders.
Built to be general-purpose across any PATH station/line; ships with two
default stations used for testing and as the basis for the interaction model
samples:

- Grove Street
- 33rd Street

## Architecture

```
Alexa → Lambda (ask-sdk-core handlers) → TransitRouter → StationRegistry
                                              ├─ PathService (official ridepath.json feed,
                                              │                 scraped via headless Chromium)
                                              └─ GtfsScheduleService (official static GTFS
                                                                      timetable, as a fallback)
```

- **Handlers** (`src/handlers/`): `LaunchRequestHandler`, `GetNextTrainIntentHandler`,
  `GetDelayStatusIntentHandler`, `SetHomeStationIntentHandler`, plus built-in
  Help/Cancel/Stop/Fallback/SessionEnded and a generic error handler. Intent
  handlers are factory functions that take a `TransitRouter`, so they're
  unit-testable without a live Lambda.
- **Services** (`src/services/`): `TransitService` is the common interface a
  provider adapter implements, normalizing into a shared `TrainArrival` type.
  The interface (and the `TransitProvider` union) is intentionally kept
  general so another provider could be added later without touching the
  router or handlers. `PathService` is the only implementation today, backed
  by the official PATH `ridepath.json` feed. A `TtlCache` (30s) sits in front
  of it, since each "fetch" launches (or reuses) a real headless Chromium
  instance — see the caveat below. `GtfsScheduleService` supplements it with
  PATH's official static GTFS timetable (see below).
- **Data** (`src/data/stationRegistry.ts`): maps spoken station/line names to
  PATH's official station codes and to the destination "headsigns" that
  identify a line in the feed. Extend `DEFAULT_STATIONS` to add more PATH
  stations — no other code needs to change.
- **Infra** (`infra/`): AWS CDK (TypeScript) stack defining the Lambda
  function (bundled with `puppeteer-core` + `@sparticuz/chromium`), a
  DynamoDB table for per-user "home base" station persistence, and the
  resource policy that lets the Alexa Skills Kit invoke the Lambda.

### Home base station

Say "set my home base station to Grove Street" (or "make {station} my home
station") and the skill remembers it per-user in DynamoDB
(`ask-sdk-dynamodb-persistence-adapter`, keyed by Alexa `userId`). After
that, asking for a next train or delay status *without* naming a station
(e.g. just "when's my next train") falls back to the saved home base station
instead of requiring a `{STATION}` slot every time. A spoken station name
always takes precedence over the saved home base.

### Multiple upcoming arrivals

By default, "when's my next train" lists up to 3 upcoming arrivals. You can
ask for a specific count instead, e.g. "what are the next 2 trains at Grove
Street" or "when are the next few 33rd Street trains coming to Grove
Street" (capped at 5 to keep the spoken response reasonable).

### Scheduled-arrival fallback (GTFS static timetable)

PATH's live `ridepath.json` feed only ever exposes ~2 upcoming arrivals per
direction per station — asking for "the next 3 trains to 33rd Street" can
come up short on live data alone even though PATH's published timetable has
more trips later in the window. `GtfsScheduleService`
(`src/services/gtfsScheduleService.ts`) downloads and parses PATH's
[official static GTFS feed](https://www.transit.land/feeds/f-dr5r-path~nj~us)
(the same kind of published timetable Google Maps/Transit apps use), and
`TransitRouter` uses it to fill in the remainder **only** when a caller
names a specific destination and the live feed's filtered results fall short
of the requested count. Scheduled entries are genuine published departure
times (not a guess/average), are marked with `source: 'scheduled'` on the
`TrainArrival`, and the spoken response adds a brief one-time note ("Later
times are from the published schedule, not live tracking.") when any are
included. The parsed schedule is cached for 24 hours — PATH republishes this
feed roughly monthly, so there's no need to re-download/re-parse it on every
request.

### Data source & Akamai bot-check caveat

PATH does not publish a stable, documented public real-time API. This skill
scrapes the **official** Port Authority endpoint:

```
https://www.panynj.gov/bin/portauthority/ridepath.json
```

That endpoint sits behind an **Akamai bot-check** that returns an empty `200`
response to plain HTTP clients — `curl`, `fetch`, `node-fetch`, etc. all get
nothing back. It only serves the real JSON to a client that behaves like a
real browser (realistic Chrome user agent, viewport, and waiting for the page
to settle). To work around this, `src/services/pathService.ts` launches a
headless Chromium instance (`puppeteer-core` + `@sparticuz/chromium`, the
Lambda-compatible Chromium build — **not** plain `puppeteer`, which bundles a
full Chrome download that's far too large for Lambda), navigates to the
endpoint, and reads `document.body.innerText` before parsing it as JSON.

**This is inherently fragile.** Port Authority/Akamai could change this
behavior at any time without notice — tightening the bot-check, requiring a
different navigation pattern, or blocking headless browsers outright. If
`scrapeRidePathJson()` starts throwing "Failed to parse... as JSON" errors in
production, check whether the page content changed (it likely returned a
challenge page instead of the feed) before assuming a code bug. (PATH's
static GTFS feed, used by `GtfsScheduleService` above, is a separate, plain
HTTPS download with no such bot-check.)

Launching a browser is expensive (multiple seconds), so:

- Responses are cached for 30 seconds (`DEFAULT_CACHE_TTL_MS` in `pathService.ts`).
- The Chromium `Browser` instance itself is kept in a module-level singleton
  and reused across warm Lambda invocations, not relaunched per request.

## Project layout

```
src/
  lambda/index.ts              # Lambda entrypoint (ask-sdk-core SkillBuilder)
  handlers/                    # Intent + lifecycle handlers
  services/                    # TransitService interface, PathService,
                                # GtfsScheduleService + gtfsParser (static
                                # timetable fallback), TransitRouter,
                                # TtlCache, response formatting
  data/stationRegistry.ts      # Station/line directory + fuzzy name matching
  __tests__/                   # Jest unit tests
skill-package/
  skill.json                   # Alexa skill manifest
  interactionModels/custom/en-US.json
infra/
  bin/infra.ts, lib/next-train-stack.ts   # AWS CDK app/stack
.github/workflows/ci.yml       # Lint, format check, build, test
```

## Prerequisites

- Node.js 18+
- An [Amazon Developer account](https://developer.amazon.com/) (for the Alexa skill)
- The [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html) (`npm install -g ask-cli`)
- An AWS account with credentials configured (`aws configure`), and the
  [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) (`npm install -g aws-cdk`)

No API keys or environment variables are required — the PATH data source
needs no authentication (it's scraped as a public webpage). The Lambda is
configured with `HOME_STATION_TABLE_NAME` automatically by the CDK stack
(pointing at the DynamoDB table it provisions); you don't need to set it
by hand.

## Setup

```bash
npm install
```

## Build, lint, and test

```bash
npm run lint       # eslint
npm run format     # prettier --write
npm run build      # tsc -> dist/ (type-checking / local dev only, see below)
npm test           # jest — mocks puppeteer-core/@sparticuz/chromium and the PATH feed
```

## Deploying the Lambda (AWS CDK)

The CDK stack uses `aws-cdk-lib/aws-lambda-nodejs`'s `NodejsFunction`, which
bundles `src/lambda/index.ts` (and its dependencies) with esbuild at deploy
time — `npm run build`'s `dist/` output is used for local type-checking and
tests only, not for deployment.

```bash
cd infra
npx cdk bootstrap              # one-time per account/region
npx cdk deploy \
  -c alexaSkillId=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

`alexaSkillId` restricts which Alexa skill may invoke the Lambda (recommended,
but the skill ID isn't known until you create the skill — see below, then
redeploy with the flag once you have it). The stack outputs the deployed
Lambda's ARN, which you'll use as the skill's endpoint.

**Memory/timeout:** the function is provisioned with 2048 MB of memory and a
20 second timeout — headless Chromium needs meaningfully more of both than a
typical Lambda. `@sparticuz/chromium`'s docs recommend at least 512 MB (1600+
MB preferred); we use the high end of that range plus headroom for cold
starts. The function is also pinned to the `x86_64` architecture, since
`@sparticuz/chromium`'s npm package only ships x64 Chromium binaries.

## Creating the Alexa skill (ASK CLI)

```bash
ask init                       # first-time ASK CLI setup, links your Amazon Developer account
ask smapi create-skill-for-vendor \
  --manifest file:skill-package/skill.json
```

Then, from the Alexa Developer Console (or `ask smapi`):

1. Upload the interaction model from `skill-package/interactionModels/custom/en-US.json`
   for the `en-US` locale.
2. Set the skill's endpoint to the Lambda ARN output by `cdk deploy`.
3. Add the skill ID as an event source token / redeploy the CDK stack with
   `-c alexaSkillId=<skill-id>` to lock down invocation permissions.
4. Build and test in the console's simulator, e.g.:
   - "Alexa, open Next Train"
   - "when's my next train at Grove Street"
   - "are there any delays on the Hoboken line"
   - "set my home base station to Grove Street"
   - "what are the next 2 trains at Grove Street"

## Extending to more stations/lines

Add entries to `DEFAULT_STATIONS` in `src/data/stationRegistry.ts` with the
station's official `providerStationId` code (see the full list of PATH
station codes in `stationRegistry.ts`'s comments) and the `headSigns` that
identify each line serving it. Then add matching values/synonyms to
`skill-package/interactionModels/custom/en-US.json` so Alexa recognizes the
spoken names. No changes are needed to the handlers, services, or router —
they're fully driven by the registry.
