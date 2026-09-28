import type { HandlerInput } from 'ask-sdk-core';
import { createGetNextTrainIntentHandler } from '../handlers/getNextTrainIntentHandler';
import { createGetDelayStatusIntentHandler } from '../handlers/getDelayStatusIntentHandler';
import type { TransitRouter } from '../services/transitRouter';
import type { StationDefinition } from '../data/stationRegistry';
import type { TrainArrival } from '../services/types';

function buildHandlerInput(
  intentName: string,
  slots: Record<string, string | undefined>,
): HandlerInput {
  const speaks: string[] = [];
  const responseBuilder = {
    speak: jest.fn(function (this: unknown, text: string) {
      speaks.push(text);
      return this;
    }),
    reprompt: jest.fn(function (this: unknown) {
      return this;
    }),
    withSimpleCard: jest.fn(function (this: unknown) {
      return this;
    }),
    getResponse: jest.fn(() => ({ outputSpeech: speaks.join(' ') })),
  };

  return {
    requestEnvelope: {
      version: '1.0',
      request: {
        type: 'IntentRequest',
        requestId: 'test-request',
        timestamp: new Date().toISOString(),
        locale: 'en-US',
        dialogState: 'COMPLETED',
        intent: {
          name: intentName,
          confirmationStatus: 'NONE',
          slots: Object.fromEntries(
            Object.entries(slots).map(([name, value]) => [
              name,
              { name, value, confirmationStatus: 'NONE' as const },
            ]),
          ),
        },
      },
    },
    responseBuilder,
  } as unknown as HandlerInput;
}

const mockStation: StationDefinition = {
  id: 'path-grove-street',
  provider: 'PATH',
  displayName: 'Grove Street',
  providerStationId: 'GRV',
  aliases: [],
  lines: [],
};

const mockArrival: TrainArrival = {
  provider: 'PATH',
  stationName: 'Grove Street',
  lineName: 'Hoboken to World Trade Center',
  destination: 'World Trade Center',
  minutesAway: 4,
  status: 'on-time',
};

describe('GetNextTrainIntentHandler', () => {
  it('canHandle matches only GetNextTrainIntent requests', () => {
    const router = { getNextArrivals: jest.fn() } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    expect(
      handler.canHandle(buildHandlerInput('GetNextTrainIntent', { STATION: 'Grove Street' })),
    ).toBe(true);
    expect(handler.canHandle(buildHandlerInput('GetDelayStatusIntent', {}))).toBe(false);
  });

  it('speaks the next arrival when the router resolves a match', async () => {
    const router = {
      getNextArrivals: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', {
      STATION: 'Grove Street',
      LINE: undefined,
    });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(router.getNextArrivals).toHaveBeenCalledWith('Grove Street', undefined);
    expect(response.outputSpeech).toContain('World Trade Center');
    expect(response.outputSpeech).toContain('4 minutes');
  });

  it('gives a friendly error when the station cannot be resolved', async () => {
    const router = {
      getNextArrivals: jest.fn().mockResolvedValue(undefined),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', { STATION: 'Nowhereville' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain("don't recognize");
  });

  it('gives a friendly error when the transit service throws', async () => {
    const router = {
      getNextArrivals: jest.fn().mockRejectedValue(new Error('network down')),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', { STATION: 'Grove Street' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('trouble reaching real-time train data');
  });
});

describe('GetDelayStatusIntentHandler', () => {
  it('canHandle matches only GetDelayStatusIntent requests', () => {
    const router = { getDelayStatus: jest.fn() } as unknown as TransitRouter;
    const handler = createGetDelayStatusIntentHandler(router);
    expect(handler.canHandle(buildHandlerInput('GetDelayStatusIntent', {}))).toBe(true);
    expect(handler.canHandle(buildHandlerInput('GetNextTrainIntent', {}))).toBe(false);
  });

  it('reports on-time when no arrivals are delayed', async () => {
    const router = {
      getDelayStatus: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetDelayStatusIntentHandler(router);
    const handlerInput = buildHandlerInput('GetDelayStatusIntent', { STATION: 'Grove Street' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('on time');
  });

  it('reports delays when present', async () => {
    const delayedArrival: TrainArrival = {
      ...mockArrival,
      status: 'delayed',
      statusDetail: 'Signal problems near Exchange Place.',
    };
    const router = {
      getDelayStatus: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [delayedArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetDelayStatusIntentHandler(router);
    const handlerInput = buildHandlerInput('GetDelayStatusIntent', { STATION: 'Grove Street' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('Signal problems near Exchange Place');
  });
});
