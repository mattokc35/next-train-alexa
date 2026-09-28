import type { ResolvedStation } from '../services/types';

const decodeMock = jest.fn();

jest.mock('gtfs-realtime-bindings', () => ({
  __esModule: true,
  default: {
    transit_realtime: {
      FeedMessage: {
        decode: (...args: unknown[]) => decodeMock(...args),
      },
    },
  },
}));

// Import after the mock so MtaService picks up the mocked module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { MtaService } from '../services/mtaService';

const wtc: ResolvedStation = {
  provider: 'MTA',
  displayName: 'World Trade Center',
  providerStationId: '142',
  providerLineId: '1',
  lineDisplayName: '1',
  feedGroup: '123456s',
};

function buildFeed() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    entity: [
      {
        tripUpdate: {
          trip: { routeId: '1' },
          stopTimeUpdate: [
            { stopId: '142N', arrival: { time: nowSeconds + 3 * 60 } },
            { stopId: '142S', arrival: { time: nowSeconds + 7 * 60 } },
          ],
        },
      },
      {
        tripUpdate: {
          trip: { routeId: '2' },
          stopTimeUpdate: [{ stopId: '142N', arrival: { time: nowSeconds + 1 * 60 } }],
        },
      },
    ],
  };
}

function okResponse(buffer = Buffer.from('proto')) {
  return { ok: true, status: 200, statusText: 'OK', buffer: async () => buffer };
}

describe('MtaService', () => {
  beforeEach(() => {
    decodeMock.mockReset();
  });

  it('filters stop updates by station id prefix and route id', async () => {
    decodeMock.mockReturnValue(buildFeed());
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const service = new MtaService({ apiKey: 'test-key', fetchImpl });

    const arrivals = await service.getNextArrivals(wtc);

    expect(arrivals).toHaveLength(2);
    expect(arrivals.every((a) => a.lineName === '1')).toBe(true);
    expect(arrivals[0].destination).toBe('Uptown');
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('nyct%2Fgtfs'),
      expect.objectContaining({ headers: { 'x-api-key': 'test-key' } }),
    );
  });

  it('marks arrivals as alert status when a relevant service alert is present', async () => {
    const feed = buildFeed();
    (feed.entity as unknown[]).push({
      alert: {
        informedEntity: [{ routeId: '1', stopId: '142N' }],
        headerText: { translation: [{ text: 'Delays on the 1 line due to signal problems.' }] },
      },
    });
    decodeMock.mockReturnValue(feed);
    const fetchImpl = jest.fn().mockResolvedValue(okResponse());
    const service = new MtaService({ apiKey: 'test-key', fetchImpl });

    const arrivals = await service.getDelayStatus(wtc);

    expect(arrivals.every((a) => a.status === 'alert')).toBe(true);
    expect(arrivals[0].statusDetail).toContain('signal problems');
  });

  it('throws when constructed without an API key', () => {
    expect(() => new MtaService({ apiKey: '' })).toThrow(/requires an MTA API key/);
  });

  it('throws a clear error when the upstream request fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const service = new MtaService({ apiKey: 'test-key', fetchImpl });

    await expect(service.getNextArrivals(wtc)).rejects.toThrow(/MTA GTFS-realtime request failed/);
  });
});
