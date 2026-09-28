import type { RequestHandler } from 'ask-sdk-core';
import { getSlotValue } from 'ask-sdk-core';
import type { TransitRouter } from '../services/transitRouter';
import { formatDelayStatusSpeech } from '../services/formatting';

/**
 * Handles "are there any delays" / "should I detour" style questions, using
 * the injected TransitRouter to resolve the station/line and fetch status.
 */
export function createGetDelayStatusIntentHandler(router: TransitRouter): RequestHandler {
  return {
    canHandle(handlerInput) {
      return (
        handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
        handlerInput.requestEnvelope.request.intent.name === 'GetDelayStatusIntent'
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
        const result = await router.getDelayStatus(stationSlot, lineSlot);
        if (!result) {
          const speakOutput = stationSlot
            ? `Sorry, I don't recognize the station "${stationSlot}". Try asking about Grove Street or 33rd Street.`
            : "Sorry, I couldn't figure out which station you meant.";
          return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
        }

        const speakOutput = formatDelayStatusSpeech(result.station.displayName, result.arrivals);
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .withSimpleCard('Next Train — Delays', speakOutput)
          .getResponse();
      } catch (error) {
        const speakOutput =
          "Sorry, I'm having trouble reaching real-time service alerts right now. Please try again shortly.";
        console.error('GetDelayStatusIntent error', error);
        return handlerInput.responseBuilder.speak(speakOutput).getResponse();
      }
    },
  };
}
