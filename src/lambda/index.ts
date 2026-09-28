import * as Alexa from 'ask-sdk-core';
import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';
import { PathService } from '../services/pathService';
import { MtaService } from '../services/mtaService';
import { TransitRouter } from '../services/transitRouter';
import { LaunchRequestHandler } from '../handlers/launchRequestHandler';
import { createGetNextTrainIntentHandler } from '../handlers/getNextTrainIntentHandler';
import { createGetDelayStatusIntentHandler } from '../handlers/getDelayStatusIntentHandler';
import {
  CancelAndStopIntentHandler,
  FallbackIntentHandler,
  HelpIntentHandler,
  SessionEndedRequestHandler,
} from '../handlers/helpAndBuiltinHandlers';
import { GenericErrorHandler } from '../handlers/errorHandler';

const mtaApiKey = process.env.MTA_API_KEY ?? '';

const registry = new StationRegistry(DEFAULT_STATIONS);
const pathService = new PathService();
// The MTA service requires an API key at request time; if it's missing we
// still build the skill (so PATH-only requests work) but MTA requests will
// throw a clear error, surfaced to the user as a friendly "try again" reply.
const mtaService = new MtaService({ apiKey: mtaApiKey || 'MISSING_MTA_API_KEY' });
const router = new TransitRouter(registry, { path: pathService, mta: mtaService });

export const handler = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    createGetNextTrainIntentHandler(router),
    createGetDelayStatusIntentHandler(router),
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(GenericErrorHandler)
  .lambda();
