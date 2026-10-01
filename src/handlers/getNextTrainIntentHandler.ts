import type { RequestHandler } from 'ask-sdk-core';
import { getSlotValue } from 'ask-sdk-core';
import type { TransitRouter } from '../services/transitRouter';
import { formatNextTrainSpeech } from '../services/formatting';
import { getHomeStationDisplayName } from '../services/homeStation';

const DEFAULT_ARRIVAL_COUNT = 3;
const MAX_ARRIVAL_COUNT = 5;

/** Parses a spoken COUNT slot value (e.g. "2") into a clamped arrival count. */
function parseArrivalCount(countSlot: string | undefined | null): number {
  const parsed = countSlot ? Number.parseInt(countSlot, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_ARRIVAL_COUNT;
  }
  return Math.min(parsed, MAX_ARRIVAL_COUNT);
}

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
      const destinationSlot =
        request.type === 'IntentRequest'
          ? getSlotValue(handlerInput.requestEnvelope, 'DESTINATION')
          : undefined;
      const countSlot =
        request.type === 'IntentRequest'
          ? getSlotValue(handlerInput.requestEnvelope, 'COUNT')
          : undefined;

      try {
        // Fall back to the caller's saved "home base" station (see
        // SetHomeStationIntent) when they didn't mention one by name.
        const effectiveStationSlot =
          stationSlot ?? (await getHomeStationDisplayName(handlerInput.attributesManager));

        const result = await router.getNextArrivals(effectiveStationSlot, lineSlot, destinationSlot);
        if (!result) {
          const speakOutput = stationSlot
            ? `Sorry, I don't recognize the station "${stationSlot}". Try asking about Grove Street or 33rd Street.`
            : "Sorry, I couldn't figure out which station you meant. Try asking about a specific station, or set a home base station.";
          return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
        }

        const arrivalCount = parseArrivalCount(countSlot);
        const speakOutput = formatNextTrainSpeech(
          result.station.displayName,
          result.arrivals,
          arrivalCount,
        );
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

