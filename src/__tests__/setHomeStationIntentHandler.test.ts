import type { HandlerInput } from 'ask-sdk-core';
import { createSetHomeStationIntentHandler } from '../handlers/setHomeStationIntentHandler';
import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';

function buildHandlerInput(slots: Record<string, string | undefined>): {
  handlerInput: HandlerInput;
  attributesManager: {
    getPersistentAttributes: jest.Mock;
    setPersistentAttributes: jest.Mock;
    savePersistentAttributes: jest.Mock;
  };
} {
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
    getPersistentAttributes: jest.fn().mockResolvedValue({}),
    setPersistentAttributes: jest.fn(),
    savePersistentAttributes: jest.fn().mockResolvedValue(undefined),
  };

  const handlerInput = {
    requestEnvelope: {
      version: '1.0',
      request: {
        type: 'IntentRequest',
        requestId: 'test-request',
        timestamp: new Date().toISOString(),
        locale: 'en-US',
        dialogState: 'COMPLETED',
        intent: {
          name: 'SetHomeStationIntent',
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

  return { handlerInput, attributesManager };
}

describe('SetHomeStationIntentHandler', () => {
  const registry = new StationRegistry(DEFAULT_STATIONS);

  it('canHandle matches only SetHomeStationIntent requests', () => {
    const handler = createSetHomeStationIntentHandler(registry);
    const { handlerInput } = buildHandlerInput({ STATION: 'Grove Street' });
    expect(handler.canHandle(handlerInput)).toBe(true);
  });

  it('saves the resolved station and confirms it back to the user', async () => {
    const handler = createSetHomeStationIntentHandler(registry);
    const { handlerInput, attributesManager } = buildHandlerInput({ STATION: 'Grove Street' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(attributesManager.setPersistentAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ homeStationDisplayName: 'Grove Street' }),
    );
    expect(attributesManager.savePersistentAttributes).toHaveBeenCalled();
    expect(response.outputSpeech).toContain('Grove Street');
  });

  it('resolves aliases the same way spoken STATION slots do elsewhere', async () => {
    const handler = createSetHomeStationIntentHandler(registry);
    const { handlerInput, attributesManager } = buildHandlerInput({ STATION: 'thirty third street' });

    await handler.handle(handlerInput);

    expect(attributesManager.setPersistentAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ homeStationDisplayName: '33rd Street' }),
    );
  });

  it('reprompts when no STATION slot is given', async () => {
    const handler = createSetHomeStationIntentHandler(registry);
    const { handlerInput, attributesManager } = buildHandlerInput({});

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(attributesManager.setPersistentAttributes).not.toHaveBeenCalled();
    expect(response.outputSpeech).toContain('Which station');
  });

  it('gives a friendly error for an unrecognized station', async () => {
    const handler = createSetHomeStationIntentHandler(registry);
    const { handlerInput, attributesManager } = buildHandlerInput({ STATION: 'Nowhereville' });

    const response = (await handler.handle(handlerInput)) as unknown as { outputSpeech: string };

    expect(attributesManager.setPersistentAttributes).not.toHaveBeenCalled();
    expect(response.outputSpeech).toContain("don't recognize");
  });
});
