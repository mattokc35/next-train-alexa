import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';
import { TransitRouter } from '../services/transitRouter';
import type { ResolvedStation, TrainArrival, TransitService } from '../services/types';

const groveStreetArrivals: TrainArrival[] = [
  {
    provider: 'PATH',
    stationName: 'Grove Street',
    lineName: 'Journal Square to 33rd Street',
    destination: '33rd Street',
    minutesAway: 2,
    status: 'on-time',
  },
  {
    provider: 'PATH',
    stationName: 'Grove Street',
    lineName: 'Newark to World Trade Center',
    destination: 'Newark',
    minutesAway: 5,
    status: 'on-time',
  },
];

function buildStubService(arrivals: TrainArrival[]): TransitService {
  return {
    provider: 'PATH',
    getNextArrivals: jest.fn(async (_station: ResolvedStation) => arrivals),
    getDelayStatus: jest.fn(async (_station: ResolvedStation) => arrivals),
  };
}

describe('TransitRouter destination filtering', () => {
  const registry = new StationRegistry(DEFAULT_STATIONS);

  it('returns all arrivals when no destination is spoken', async () => {
    const router = new TransitRouter(registry, buildStubService(groveStreetArrivals));
    const result = await router.getNextArrivals('Grove Street', undefined);
    expect(result?.arrivals).toHaveLength(2);
  });

  it('filters arrivals to only the spoken destination station', async () => {
    const router = new TransitRouter(registry, buildStubService(groveStreetArrivals));
    const result = await router.getNextArrivals('Grove Street', undefined, '33rd Street');
    expect(result?.arrivals).toHaveLength(1);
    expect(result?.arrivals[0].destination).toBe('33rd Street');
  });

  it('matches destination aliases (e.g. "thirty third street") the same way stations do', async () => {
    const router = new TransitRouter(registry, buildStubService(groveStreetArrivals));
    const result = await router.getNextArrivals('Grove Street', undefined, 'thirty third street');
    expect(result?.arrivals).toHaveLength(1);
    expect(result?.arrivals[0].destination).toBe('33rd Street');
  });

  it('also filters delay-status arrivals by destination', async () => {
    const router = new TransitRouter(registry, buildStubService(groveStreetArrivals));
    const result = await router.getDelayStatus('Grove Street', undefined, 'Newark');
    expect(result?.arrivals).toHaveLength(1);
    expect(result?.arrivals[0].destination).toBe('Newark');
  });

  it('matches a destination even when the headsign carries a "via" qualifier', async () => {
    const arrivalsWithVia: TrainArrival[] = [
      {
        provider: 'PATH',
        stationName: 'Grove Street',
        lineName: 'Journal Square to 33rd Street',
        destination: '33rd Street via Hoboken',
        minutesAway: 3,
        status: 'on-time',
      },
      {
        provider: 'PATH',
        stationName: 'Grove Street',
        lineName: 'Newark to World Trade Center',
        destination: 'Newark',
        minutesAway: 19,
        status: 'on-time',
      },
    ];
    const router = new TransitRouter(registry, buildStubService(arrivalsWithVia));
    const result = await router.getNextArrivals('Grove Street', undefined, '33rd Street');
    expect(result?.arrivals).toHaveLength(1);
    expect(result?.arrivals[0].destination).toBe('33rd Street via Hoboken');
  });
});
