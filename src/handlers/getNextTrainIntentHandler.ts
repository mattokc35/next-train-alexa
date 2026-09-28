import type { RequestHandler } from 'ask-sdk-core';
import { getSlotValue } from 'ask-sdk-core';
import type { TransitRouter } from '../services/transitRouter';
import { formatNextTrainSpeech } from '../services/formatting';

/**
 * Handles "when is my next train at <station>" / "on the <line>", using the
 * injected TransitRouter to resolve the station/line and fetch arrivals.
 * Exported as a factory so tests can supply a mock router without needing a
 * live Lambda/skill build.
 */
export function createGetNextTrainIntentHandler(router: TransitRouter): RequestHandler {
  return {
    canHandle(handlerInput) {
      return (
        handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
        handlerInput.requestEnvelope.request.intent.name === 'GetNextTrainIntent'
      );
    },
    async handle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      const stationSlot =
        request.type === 'IntentRequest'
          ? getSlotValue(handlerInput.requestEnvelope, 'STATION')
          : undefined;
      const lineSlot =
        request.type === 'IntentRequest'
          ? getSlotValue(handlerInput.requestEnvelope, 'LINE')
          : undefined;

      try {
        const result = await router.getNextArrivals(stationSlot, lineSlot);
        if (!result) {
          const speakOutput = stationSlot
            ? `Sorry, I don't recognize the station "${stationSlot}". Try asking about Grove Street or 9th Street.`
            : "Sorry, I couldn't figure out which station you meant.";
          return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
        }

        const speakOutput = formatNextTrainSpeech(result.station.displayName, result.arrivals);
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .withSimpleCard('Next Train', speakOutput)
          .getResponse();
      } catch (error) {
        const speakOutput =
          "Sorry, I'm having trouble reaching real-time train data right now. Please try again shortly.";
        console.error('GetNextTrainIntent error', error);
        return handlerInput.responseBuilder.speak(speakOutput).getResponse();
      }
    },
  };
}
