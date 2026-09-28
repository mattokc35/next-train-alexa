# Next Train — Alexa Skill

A custom Alexa skill that answers "when's my next train" and "are there any
delays or should I detour" for **PATH** (NJ Transit / PANYNJ) and **MTA
subway** riders. Built to be general-purpose across any PATH station or MTA
line/station; ships with four default stations for testing and as the basis
for the interaction model samples:

- PATH: Grove Street, 33rd Street
- MTA: 9th Street (A/C/E), World Trade Center (1/2/3)

## Architecture

```
Alexa → Lambda (ask-sdk-core handlers) → TransitRouter → StationRegistry
                                              ├─ PathService  (path.api.razza.dev, REST/JSON)
                                              └─ MtaService   (api.mta.info, GTFS-realtime protobuf)
```

- **Handlers** (`src/handlers/`): `LaunchRequestHandler`, `GetNextTrainIntentHandler`,
  `GetDelayStatusIntentHandler`, plus built-in Help/Cancel/Stop/Fallback/SessionEnded
  and a generic error handler. Intent handlers are factory functions that take a
  `TransitRouter`, so they're unit-testable without a live Lambda.
- **Services** (`src/services/`): `TransitService` is the common interface both
  adapters implement, normalizing into a shared `TrainArrival` type. A small
  `TtlCache` (default 30s) sits in front of each adapter's upstream call to
  avoid hitting rate limits when Alexa retries or a container stays warm.
- **Data** (`src/data/stationRegistry.ts`): maps spoken station/line names to
  provider-specific IDs. Extend `DEFAULT_STATIONS` to add more PATH stations
  or MTA lines/stations — no other code needs to change.
- **Infra** (`infra/`): AWS CDK (TypeScript) stack defining the Lambda function,
  a scoped IAM policy for reading the MTA API key from SSM, and the
  resource policy that lets the Alexa Skills Kit invoke the function.

### Data sources — important caveats

- **PATH**: There is no official, stable public real-time API for PATH. This
  scaffold uses the community-run `https://path.api.razza.dev` API. Its
  station IDs and response schema (in `src/services/pathService.ts` /
  `src/data/stationRegistry.ts`) were captured from public documentation but
  **could not be verified against the live endpoint in this environment**
  (no outbound network access during scaffolding). Before deploying, hit the
  live API directly and adjust `PathUpcomingTrain`/station IDs if the schema
  has drifted.
- **MTA**: Uses the official GTFS-realtime protobuf feeds from
  `api.mta.info`. Requires a free API key (see below). Feed URLs are grouped
  by line family (`ace`, `bdfm`, `g`, `jz`, `nqrw`, `l`, `123456s`, `sir`) —
  see `FEED_PATHS` in `src/services/mtaService.ts`. Verify these paths against
  the current MTA developer docs, as the MTA has changed feed hosting before.

## Project layout

```
src/
  lambda/index.ts              # Lambda entrypoint (ask-sdk-core SkillBuilder)
  handlers/                    # Intent + lifecycle handlers
  services/                    # TransitService interface, PathService, MtaService,
                                # TransitRouter, TtlCache, response formatting
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
- A free [MTA real-time API key](https://api.mta.info/) (sign up, then find
  your key under your account)

## Setup

```bash
npm install
```

### Environment variables

| Variable      | Required | Description                                                                       |
| ------------- | -------- | --------------------------------------------------------------------------------- |
| `MTA_API_KEY` | Yes      | API key from api.mta.info, used as `x-api-key` header for GTFS-realtime requests. |

Locally (for running tests, nothing is required — tests mock all network
calls). For deployment, the key is stored in AWS Systems Manager Parameter
Store rather than passed as plaintext:

```bash
aws ssm put-parameter \
  --name /next-train/mta-api-key \
  --type SecureString \
  --value "<your-mta-api-key>"
```

## Build, lint, and test

```bash
npm run lint       # eslint
npm run format     # prettier --write
npm run build      # tsc -> dist/
npm test           # jest
```

## Deploying the Lambda (AWS CDK)

```bash
npm run build                 # compile TypeScript -> dist/
cd infra
npx cdk bootstrap              # one-time per account/region
npx cdk deploy \
  -c alexaSkillId=amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

`alexaSkillId` restricts which Alexa skill may invoke the Lambda (recommended,
but the skill ID isn't known until you create the skill — see below, then
redeploy with the flag once you have it). The stack outputs the deployed
Lambda's ARN, which you'll use as the skill's endpoint.

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
   - "are there any delays on the A line"

## Extending to more stations/lines

Add entries to `DEFAULT_STATIONS` in `src/data/stationRegistry.ts` with the
correct `providerStationId` (PATH station slug or MTA GTFS parent stop ID)
and, for MTA, the right `feedGroup`. Then add matching values/synonyms to
`skill-package/interactionModels/custom/en-US.json` so Alexa recognizes the
spoken names. No changes are needed to the handlers, services, or router —
they're fully driven by the registry.
