import { PathService } from '../services/pathService';
import type { ResolvedStation } from '../services/types';

function buildResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      upcomingTrains: [
        {
          projectedArrival: new Date(Date.now() + 5 * 60_000).toISOString(),
          lastUpdated: new Date().toISOString(),
          direction: 'TO_NY',
          route: 'JSQ_33_HOB',
          lineName: 'Journal Square – 33rd (via Hoboken)',
          headSign: '33rd Street',
        },
        {
          projectedArrival: new Date(Date.now() + 2 * 60_000).toISOString(),
          lastUpdated: new Date().toISOString(),
          direction: 'TO_NJ',
          route: 'HOB_WTC',
          headSign: 'Hoboken',
        },
        ...((overrides.extraTrains as unknown[]) ?? []),
      ],
    }),
  };
}

const grove: ResolvedStation = {
  provider: 'PATH',
  displayName: 'Grove Street',
  providerStationId: 'grove_street',
};

describe('PathService', () => {
  it('normalizes and sorts upcoming trains soonest-first', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(buildResponse());
    const service = new PathService({ fetchImpl });

    const arrivals = await service.getNextArrivals(grove);

    expect(arrivals).toHaveLength(2);
    expect(arrivals[0].destination).toBe('Hoboken');
    expect(arrivals[0].minutesAway).toBeLessThanOrEqual(arrivals[1].minutesAway);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('grove_street'));
  });

  it('filters by providerLineId when a specific line is requested', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(buildResponse());
    const service = new PathService({ fetchImpl });

    const arrivals = await service.getNextArrivals({ ...grove, providerLineId: 'JSQ_33_HOB' });

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].destination).toBe('33rd Street');
  });

  it('caches responses for repeated requests to the same station', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(buildResponse());
    const service = new PathService({ fetchImpl, cacheTtlMs: 60_000 });

    await service.getNextArrivals(grove);
    await service.getNextArrivals(grove);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('marks arrivals as alert when the feed data is stale', async () => {
    const staleResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        upcomingTrains: [
          {
            projectedArrival: new Date(Date.now() + 5 * 60_000).toISOString(),
            lastUpdated: new Date(Date.now() - 10 * 60_000).toISOString(),
            direction: 'TO_NY',
            route: 'JSQ_33_HOB',
            headSign: '33rd Street',
          },
        ],
      }),
    };
    const fetchImpl = jest.fn().mockResolvedValue(staleResponse);
    const service = new PathService({ fetchImpl });

    const arrivals = await service.getDelayStatus(grove);

    expect(arrivals[0].status).toBe('alert');
  });

  it('throws a clear error when the upstream API request fails', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
    const service = new PathService({ fetchImpl });

    await expect(service.getNextArrivals(grove)).rejects.toThrow(/PATH API request failed/);
  });
});
