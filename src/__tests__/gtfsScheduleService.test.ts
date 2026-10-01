import AdmZip from 'adm-zip';
import { GtfsScheduleService, parseGtfsSchedule } from '../services/gtfsScheduleService';
import type { ResolvedStation } from '../services/types';

/**
 * Builds a tiny in-memory GTFS zip buffer for tests, standing in for PATH's
 * real (much larger) feed. Covers: a normal weekday trip, an after-midnight
 * continuation trip tied to the previous service day, and a calendar_dates
 * exception that adds an otherwise-inactive service.
 */
function buildFixtureGtfsZip(): ArrayBuffer {
  const zip = new AdmZip();

  zip.addFile(
    'stops.txt',
    Buffer.from(
      'stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,location_type,parent_station\n' +
        '1,,Grove Street,,0,0,,,\n' +
        '2,,33rd Street,,0,0,,,\n',
    ),
  );

  zip.addFile(
    'trips.txt',
    Buffer.from(
      'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n' +
        'R1,WD,T1,Test,1,,\n' +
        'R1,WD,T2,Test,1,,\n' +
        'R1,WD,T3,Test,1,,\n' +
        'R1,HOL,T4,Test,1,,\n',
    ),
  );

  zip.addFile(
    'stop_times.txt',
    Buffer.from(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n' +
        'T1,10:15:00,10:15:00,1,1,0,0\n' +
        'T1,10:30:00,10:30:00,2,2,0,0\n' +
        'T2,10:45:00,10:45:00,1,1,0,0\n' +
        'T2,11:00:00,11:00:00,2,2,0,0\n' +
        // After-midnight continuation of the Monday ("WD") service day.
        'T3,25:10:00,25:10:00,1,1,0,0\n' +
        'T3,25:25:00,25:25:00,2,2,0,0\n' +
        'T4,09:00:00,09:00:00,1,1,0,0\n' +
        'T4,09:15:00,09:15:00,2,2,0,0\n',
    ),
  );

  zip.addFile(
    'calendar.txt',
    Buffer.from(
      'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n' +
        'WD,1,1,1,1,1,0,0,20240101,20241231\n' +
        // HOL has every day off by default — only active via calendar_dates.
        'HOL,0,0,0,0,0,0,0,20240101,20241231\n',
    ),
  );

  zip.addFile(
    'calendar_dates.txt',
    Buffer.from(
      'service_id,date,exception_type\n' +
        'HOL,20240108,1\n' + // added on Mon Jan 8, 2024
        'WD,20240109,2\n', // removed on Tue Jan 9, 2024
    ),
  );

  return zip.toBuffer() as unknown as ArrayBuffer;
}

const GROVE_STREET: ResolvedStation = {
  provider: 'PATH',
  displayName: 'Grove Street',
  providerStationId: 'GRV',
};

describe('parseGtfsSchedule', () => {
  it('derives each trip destination from its last scheduled stop, keyed by station', () => {
    const schedule = parseGtfsSchedule(buildFixtureGtfsZip());
    const groveToThirtyThird = schedule.departuresByStationAndDestination
      .get('grove street')
      ?.get('33rd street');
    // T4 (09:00, HOL), T1 (10:15, WD), T2 (10:45, WD), T3 (25:10,
    // after-midnight, WD) all depart Grove Street toward 33rd Street. This
    // index is calendar-agnostic — service-day filtering happens later in
    // GtfsScheduleService, not here.
    expect(groveToThirtyThird).toHaveLength(4);
    expect(groveToThirtyThird?.map((d) => d.departureMinutes)).toEqual([540, 615, 645, 1510]);
  });
});

describe('GtfsScheduleService.getUpcomingScheduledArrivals', () => {
  function buildService(): GtfsScheduleService {
    return new GtfsScheduleService({
      fetcher: async () => buildFixtureGtfsZip(),
      cacheTtlMs: 60_000,
    });
  }

  it('returns scheduled departures later today, soonest first', async () => {
    const service = buildService();
    // Monday Jan 8, 2024, 9:00 AM America/New_York — before both near-term
    // WD trips; T3 (WD's after-midnight continuation, "25:10" ~= 1:10 AM
    // Tuesday) is also still "later today" relative to this service day.
    const now = new Date('2024-01-08T14:00:00.000Z');

    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      5,
      now,
    );

    expect(arrivals.map((a) => a.minutesAway)).toEqual([75, 105, 970]);
    expect(arrivals.every((a) => a.source === 'scheduled')).toBe(true);
    expect(arrivals[0].destination).toBe('33rd Street');
  });

  it('respects the requested limit', async () => {
    const service = buildService();
    const now = new Date('2024-01-08T14:00:00.000Z');

    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      1,
      now,
    );

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].minutesAway).toBe(75);
  });

  it('includes an after-midnight continuation trip from the previous service day', async () => {
    const service = buildService();
    // Tuesday Jan 9, 2024, 12:30 AM America/New_York — T3 (25:10 on Monday's
    // WD service, i.e. 1:10 AM) hasn't departed yet.
    const now = new Date('2024-01-09T05:30:00.000Z');

    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      5,
      now,
    );

    expect(arrivals.map((a) => a.minutesAway)).toEqual([40]);
  });

  it('applies a calendar_dates "removed" exception even when the base calendar would include the service', async () => {
    const service = buildService();
    // Tuesday Jan 9, 2024, 9:00 AM — WD is normally active on Tuesdays, but
    // calendar_dates.txt removes it for this specific date.
    const now = new Date('2024-01-09T14:00:00.000Z');

    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      5,
      now,
    );

    expect(arrivals).toHaveLength(0);
  });

  it('applies a calendar_dates "added" exception for a service with no active weekday', async () => {
    const service = buildService();
    // Monday Jan 8, 2024, 8:00 AM — HOL has no active weekday in
    // calendar.txt, but calendar_dates.txt adds it for this exact date, so
    // its 9:00 AM trip (T4) appears alongside WD's normal Monday trips.
    const now = new Date('2024-01-08T13:00:00.000Z');

    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      5,
      now,
    );

    expect(arrivals.map((a) => a.minutesAway)).toEqual([60, 135, 165, 1030]);
  });

  it('returns an empty array when the station/destination pair has no scheduled trips', async () => {
    const service = buildService();
    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      'Nowhere Street',
      5,
      new Date('2024-01-08T14:00:00.000Z'),
    );
    expect(arrivals).toEqual([]);
  });

  it('returns an empty array immediately when limit is zero or negative', async () => {
    const service = buildService();
    const arrivals = await service.getUpcomingScheduledArrivals(
      GROVE_STREET,
      '33rd Street',
      0,
      new Date('2024-01-08T14:00:00.000Z'),
    );
    expect(arrivals).toEqual([]);
  });
});
