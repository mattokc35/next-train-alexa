import * as Alexa from 'ask-sdk-core';
import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';
import { PathService } from '../services/pathService';
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

const registry = new StationRegistry(DEFAULT_STATIONS);
const pathService = new PathService();
const router = new TransitRouter(registry, pathService);

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
