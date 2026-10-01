import { StationRegistry, DEFAULT_STATIONS } from '../data/stationRegistry';
import { TransitRouter } from '../services/transitRouter';
import type { GtfsScheduleService } from '../services/gtfsScheduleService';
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

function buildStubScheduleService(arrivals: TrainArrival[]): GtfsScheduleService {
  return {
    getUpcomingScheduledArrivals: jest.fn(async () => arrivals),
    clearCache: jest.fn(),
  } as unknown as GtfsScheduleService;
}

describe('TransitRouter schedule supplementation', () => {
  const registry = new StationRegistry(DEFAULT_STATIONS);
  const scheduledArrival = (minutesAway: number): TrainArrival => ({
    provider: 'PATH',
    stationName: 'Grove Street',
    lineName: 'Journal Square to 33rd Street',
    destination: '33rd Street',
    minutesAway,
    status: 'on-time',
    source: 'scheduled',
  });

  it('supplements with scheduled arrivals when a destination is filtered and live results fall short', async () => {
    const liveArrivals: TrainArrival[] = [
      {
        provider: 'PATH',
        stationName: 'Grove Street',
        lineName: 'Journal Square to 33rd Street',
        destination: '33rd Street',
        minutesAway: 4,
        status: 'on-time',
      },
    ];
    const scheduleService = buildStubScheduleService([scheduledArrival(20), scheduledArrival(35)]);
    const router = new TransitRouter(registry, buildStubService(liveArrivals), scheduleService);

    const result = await router.getNextArrivals('Grove Street', undefined, '33rd Street', 3);

    expect(result?.arrivals).toHaveLength(3);
    expect(result?.arrivals.map((a) => a.minutesAway)).toEqual([4, 20, 35]);
    expect(result?.arrivals[1].source).toBe('scheduled');
  });

  it('does not call the schedule service when live results already satisfy the requested count', async () => {
    const liveArrivals: TrainArrival[] = [
      {
        provider: 'PATH',
        stationName: 'Grove Street',
        lineName: 'Journal Square to 33rd Street',
        destination: '33rd Street',
        minutesAway: 4,
        status: 'on-time',
      },
    ];
    const scheduleService = buildStubScheduleService([scheduledArrival(20)]);
    const router = new TransitRouter(registry, buildStubService(liveArrivals), scheduleService);

    const result = await router.getNextArrivals('Grove Street', undefined, '33rd Street', 1);

    expect(result?.arrivals).toHaveLength(1);
    expect(scheduleService.getUpcomingScheduledArrivals).not.toHaveBeenCalled();
  });

  it('drops a scheduled arrival that likely duplicates an already-shown live arrival', async () => {
    const liveArrivals: TrainArrival[] = [
      {
        provider: 'PATH',
        stationName: 'Grove Street',
        lineName: 'Journal Square to 33rd Street',
        destination: '33rd Street',
        minutesAway: 4,
        status: 'on-time',
      },
    ];
    // Scheduled entry at 5 minutes is within the de-dupe window of the live
    // arrival at 4 minutes — almost certainly the same physical train.
    const scheduleService = buildStubScheduleService([scheduledArrival(5), scheduledArrival(22)]);
    const router = new TransitRouter(registry, buildStubService(liveArrivals), scheduleService);

    const result = await router.getNextArrivals('Grove Street', undefined, '33rd Street', 3);

    expect(result?.arrivals.map((a) => a.minutesAway)).toEqual([4, 22]);
  });

  it('does not supplement when no destination was spoken', async () => {
    const scheduleService = buildStubScheduleService([scheduledArrival(20)]);
    const router = new TransitRouter(registry, buildStubService(groveStreetArrivals), scheduleService);

    const result = await router.getNextArrivals('Grove Street', undefined, undefined, 5);

    expect(result?.arrivals).toHaveLength(2);
    expect(scheduleService.getUpcomingScheduledArrivals).not.toHaveBeenCalled();
  });
});
