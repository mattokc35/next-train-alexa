import type { RequestHandler } from 'ask-sdk-core';
import { getSlotValue } from 'ask-sdk-core';
import type { StationRegistry } from '../data/stationRegistry';
import { setHomeStationDisplayName } from '../services/homeStation';

/**
 * Handles "set my home base station to <station>" style requests, saving
 * the resolved station (per-user, via the DynamoDB persistence adapter) so
 * that GetNextTrainIntent/GetDelayStatusIntent can default to it when the
 * caller doesn't mention a station.
 */
export function createSetHomeStationIntentHandler(registry: StationRegistry): RequestHandler {
  return {
    canHandle(handlerInput) {
      return (
        handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
        handlerInput.requestEnvelope.request.intent.name === 'SetHomeStationIntent'
      );
    },
    async handle(handlerInput) {
      const request = handlerInput.requestEnvelope.request;
      const stationSlot =
        request.type === 'IntentRequest'
          ? getSlotValue(handlerInput.requestEnvelope, 'STATION')
          : undefined;

      if (!stationSlot) {
        const speakOutput =
          'Which station would you like to set as your home base? For example, Grove Street.';
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt(speakOutput)
          .getResponse();
      }

      const station = registry.findStation(stationSlot);
      if (!station) {
        const speakOutput = `Sorry, I don't recognize the station "${stationSlot}". Try Grove Street or 33rd Street.`;
        return handlerInput.responseBuilder
          .speak(speakOutput)
          .reprompt(speakOutput)
          .getResponse();
      }

      await setHomeStationDisplayName(handlerInput.attributesManager, station.displayName);

      const speakOutput = `Got it — I'll use ${station.displayName} as your home base station from now on.`;
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .withSimpleCard('Next Train — Home Base', speakOutput)
        .getResponse();
    },
  };
}
