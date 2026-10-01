import type { HandlerInput } from 'ask-sdk-core';
import { createGetNextTrainIntentHandler } from '../handlers/getNextTrainIntentHandler';
import { createGetDelayStatusIntentHandler } from '../handlers/getDelayStatusIntentHandler';
import type { TransitRouter } from '../services/transitRouter';
import type { StationDefinition } from '../data/stationRegistry';
import type { TrainArrival } from '../services/types';

function buildHandlerInput(
  intentName: string,
  slots: Record<string, string | undefined>,
  persistentAttributes: Record<string, unknown> = {},
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

  const attributesManager = {
    getPersistentAttributes: jest.fn().mockResolvedValue(persistentAttributes),
    setPersistentAttributes: jest.fn(),
    savePersistentAttributes: jest.fn().mockResolvedValue(undefined),
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
    attributesManager,
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

    expect(router.getNextArrivals).toHaveBeenCalledWith('Grove Street', undefined, null, 3);
    expect(response.outputSpeech).toContain('World Trade Center');
    expect(response.outputSpeech).toContain('4 minutes');
  });

  it('passes a spoken DESTINATION slot through to the router', async () => {
    const router = {
      getNextArrivals: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', {
      STATION: 'Grove Street',
      DESTINATION: '33rd Street',
    });

    await handler.handle(handlerInput);

    expect(router.getNextArrivals).toHaveBeenCalledWith('Grove Street', null, '33rd Street', 3);
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

  it('falls back to the saved home base station when no STATION slot is given', async () => {
    const router = {
      getNextArrivals: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput(
      'GetNextTrainIntent',
      {},
      { homeStationDisplayName: 'Grove Street' },
    );

    await handler.handle(handlerInput);

    expect(router.getNextArrivals).toHaveBeenCalledWith('Grove Street', null, null, 3);
  });

  it('prefers a spoken STATION slot over the saved home base station', async () => {
    const router = {
      getNextArrivals: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput(
      'GetNextTrainIntent',
      { STATION: '33rd Street' },
      { homeStationDisplayName: 'Grove Street' },
    );

    await handler.handle(handlerInput);

    expect(router.getNextArrivals).toHaveBeenCalledWith('33rd Street', null, null, 3);
  });

  it('gives a friendly error mentioning home base when no station is known', async () => {
    const router = {
      getNextArrivals: jest.fn().mockResolvedValue(undefined),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', {});

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('home base station');
  });

  it('honors a spoken COUNT slot to list more upcoming arrivals', async () => {
    const arrivals: TrainArrival[] = [
      { ...mockArrival, minutesAway: 2 },
      { ...mockArrival, minutesAway: 8, destination: 'Journal Square' },
      { ...mockArrival, minutesAway: 14 },
      { ...mockArrival, minutesAway: 20, destination: 'Journal Square' },
    ];
    const router = {
      getNextArrivals: jest.fn().mockResolvedValue({ station: mockStation, arrivals }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', {
      STATION: 'Grove Street',
      COUNT: '4',
    });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('20 minutes');
  });

  it('combines home-base fallback, a DESTINATION slot, and a COUNT slot (e.g. "when are the next few 33rd Street trains coming")', async () => {
    const arrivals: TrainArrival[] = [
      { ...mockArrival, minutesAway: 3, destination: '33rd Street via Hoboken' },
      { ...mockArrival, minutesAway: 19, destination: 'Newark' },
      { ...mockArrival, minutesAway: 25, destination: '33rd Street via Hoboken' },
    ];
    const router = {
      getNextArrivals: jest.fn().mockResolvedValue({
        station: mockStation,
        arrivals: arrivals.filter((a) => a.destination.startsWith('33rd Street')),
      }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput(
      'GetNextTrainIntent',
      { DESTINATION: '33rd Street', COUNT: '3' },
      { homeStationDisplayName: 'Grove Street' },
    );

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(router.getNextArrivals).toHaveBeenCalledWith('Grove Street', null, '33rd Street', 3);
    expect(response.outputSpeech).toContain('3 minutes');
    expect(response.outputSpeech).toContain('25 minutes');
    expect(response.outputSpeech).not.toContain('Newark');
  });

  it('clamps an out-of-range COUNT slot to the maximum allowed', async () => {
    const arrivals: TrainArrival[] = Array.from({ length: 6 }, (_, index) => ({
      ...mockArrival,
      minutesAway: index + 1,
    }));
    const router = {
      getNextArrivals: jest.fn().mockResolvedValue({ station: mockStation, arrivals }),
    } as unknown as TransitRouter;
    const handler = createGetNextTrainIntentHandler(router);
    const handlerInput = buildHandlerInput('GetNextTrainIntent', {
      STATION: 'Grove Street',
      COUNT: '99',
    });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(response.outputSpeech).toContain('5 minutes');
    expect(response.outputSpeech).not.toContain('6 minutes');
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

  it('falls back to the saved home base station when no STATION slot is given', async () => {
    const router = {
      getDelayStatus: jest
        .fn()
        .mockResolvedValue({ station: mockStation, arrivals: [mockArrival] }),
    } as unknown as TransitRouter;
    const handler = createGetDelayStatusIntentHandler(router);
    const handlerInput = buildHandlerInput(
      'GetDelayStatusIntent',
      {},
      { homeStationDisplayName: 'Grove Street' },
    );

    await handler.handle(handlerInput);

    expect(router.getDelayStatus).toHaveBeenCalledWith('Grove Street', null);
  });
});
