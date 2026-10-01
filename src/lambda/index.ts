import * as Alexa from 'ask-sdk-core';
import { DynamoDbPersistenceAdapter } from 'ask-sdk-dynamodb-persistence-adapter';
import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';
import { PathService } from '../services/pathService';
import { TransitRouter } from '../services/transitRouter';
import { LaunchRequestHandler } from '../handlers/launchRequestHandler';
import { createGetNextTrainIntentHandler } from '../handlers/getNextTrainIntentHandler';
import { createGetDelayStatusIntentHandler } from '../handlers/getDelayStatusIntentHandler';
import { createSetHomeStationIntentHandler } from '../handlers/setHomeStationIntentHandler';
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

// Persists each user's "home base" station (see SetHomeStationIntent) in the
// DynamoDB table provisioned by infra/lib/next-train-stack.ts, keyed by
// Alexa userId.
const persistenceAdapter = new DynamoDbPersistenceAdapter({
  tableName: process.env.HOME_STATION_TABLE_NAME ?? 'next-train-alexa-home-stations',
  createTable: false,
});

const skillHandler = Alexa.SkillBuilders.custom()
  .withPersistenceAdapter(persistenceAdapter)
  .addRequestHandlers(
    LaunchRequestHandler,
    createGetNextTrainIntentHandler(router),
    createGetDelayStatusIntentHandler(router),
    createSetHomeStationIntentHandler(registry),
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    FallbackIntentHandler,
    SessionEndedRequestHandler,
  )
  .addErrorHandlers(GenericErrorHandler)
  .lambda();

// We intentionally keep a warm headless-Chromium instance alive across
// invocations (see pathService.ts) to avoid relaunching a browser on every
// request. That keeps Node's event loop non-empty (open IPC handles to the
// browser process), which by default makes the Lambda runtime wait for the
// full configured timeout before invoking the callback — even after the
// response is ready. Disabling callbackWaitsForEmptyEventLoop makes Lambda
// return as soon as ask-sdk-core's callback fires, instead of waiting on
// those lingering handles.
export const handler: Alexa.LambdaHandler = (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;
  skillHandler(event, context, callback);
};
