import type { RequestHandler } from 'ask-sdk-core';

/**
 * Handles the skill launch (e.g. "Alexa, open Next Train") with a short
 * welcome + prompt for a station.
 */
export const LaunchRequestHandler: RequestHandler = {
  canHandle(handlerInput) {
    return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speakOutput =
      "Welcome to Next Train. You can ask, when's my next train at Grove Street, " +
      'What would you like to know?';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt(speakOutput)
      .withSimpleCard('Next Train', speakOutput)
      .getResponse();
  },
};
