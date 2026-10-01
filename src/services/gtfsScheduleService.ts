import AdmZip from 'adm-zip';
import { parseCsv } from './gtfsParser';
import { TtlCache } from './cache';
import type { ResolvedStation, TrainArrival } from './types';

const GTFS_URL =
  'https://rapid.nationalrtap.org/GTFSFileManagement/UserUploadFiles/14843/PATHGTFS.zip';
// PATH republishes this feed roughly monthly (per its calendar.txt date
// ranges); a day-long cache is plenty fresh while avoiding a multi-hundred
// KB download + CSV parse on every cold start.
const DEFAULT_SCHEDULE_TTL_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_CACHE_KEY = 'path-gtfs-schedule';
const SCHEDULE_TIMEZONE = 'America/New_York';

type WeekdayName =
  | 'sunday'
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday';

const WEEKDAY_NAMES: WeekdayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

interface CalendarEntry {
  serviceId: string;
  days: Record<WeekdayName, boolean>;
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD
}

interface CalendarException {
  serviceId: string;
  date: string; // YYYYMMDD
  /** '1' = service added for this date, '2' = service removed for this date. */
  exceptionType: '1' | '2';
}

interface ScheduledDeparture {
  serviceId: string;
  /**
   * Minutes since midnight of the service day. GTFS allows values >= 1440
   * for trips that continue past midnight while still belonging to the
   * earlier calendar day's service_id (e.g. "25:03:00" = 1:03 AM).
   */
  departureMinutes: number;
}

interface ParsedSchedule {
  /** normalized station name -> normalized destination name -> departures, sorted ascending */
  departuresByStationAndDestination: Map<string, Map<string, ScheduledDeparture[]>>;
  calendars: CalendarEntry[];
  exceptions: CalendarException[];
}

export type GtfsZipFetcher = () => Promise<ArrayBuffer>;

async function fetchGtfsZip(): Promise<ArrayBuffer> {
  const response = await fetch(GTFS_URL);
  if (!response.ok) {
    throw new Error(`Failed to download PATH GTFS feed: HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function parseGtfsTimeToMinutes(raw: string): number {
  const [h, m] = raw.split(':');
  const hours = Number.parseInt(h, 10);
  const minutes = Number.parseInt(m, 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return NaN;
  }
  return hours * 60 + minutes;
}

function parseCalendarRow(row: Record<string, string>): CalendarEntry {
  return {
    serviceId: row.service_id,
    days: {
      sunday: row.sunday === '1',
      monday: row.monday === '1',
      tuesday: row.tuesday === '1',
      wednesday: row.wednesday === '1',
      thursday: row.thursday === '1',
      friday: row.friday === '1',
      saturday: row.saturday === '1',
    },
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

/** Normalizes a station display name for use as an index key (case-insensitive exact match). */
function normalizeStationKey(name: string): string {
  return name.trim().toLowerCase();
}

function ymdMinusOneDay(ymd: string): string {
  const year = Number.parseInt(ymd.slice(0, 4), 10);
  const month = Number.parseInt(ymd.slice(4, 6), 10) - 1;
  const day = Number.parseInt(ymd.slice(6, 8), 10);
  // Use noon UTC to sidestep any DST/timezone edge cases in plain Date
  // arithmetic — we only need the calendar date, not a precise instant.
  const date = new Date(Date.UTC(year, month, day, 12));
  date.setUTCDate(date.getUTCDate() - 1);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Parses the raw GTFS zip buffer into the station/destination departure
 * index used by getUpcomingScheduledArrivals. Exported for testing.
 */
export function parseGtfsSchedule(buffer: ArrayBuffer): ParsedSchedule {
  const zip = new AdmZip(Buffer.from(buffer));
  const readEntry = (name: string): string => {
    const entry = zip.getEntry(name);
    if (!entry) {
      throw new Error(`PATH GTFS feed is missing expected file: ${name}`);
    }
    return entry.getData().toString('utf-8');
  };

  const stops = parseCsv(readEntry('stops.txt'));
  const trips = parseCsv(readEntry('trips.txt'));
  const stopTimes = parseCsv(readEntry('stop_times.txt'));
  const calendarRows = parseCsv(readEntry('calendar.txt'));
  const calendarDateRows = parseCsv(readEntry('calendar_dates.txt'));

  // PATH publishes two numeric stop_ids per physical station (one per
  // platform/direction) plus synthetic "place_XXX" parent-station rows —
  // stop_times only ever references the numeric ids, so map every numeric
  // stop_id straight to its human station name (these match our
  // StationRegistry displayNames, e.g. "Grove Street", "33rd Street").
  const stopNameById = new Map<string, string>();
  for (const stop of stops) {
    stopNameById.set(stop.stop_id, stop.stop_name);
  }

  const serviceIdByTrip = new Map<string, string>();
  for (const trip of trips) {
    serviceIdByTrip.set(trip.trip_id, trip.service_id);
  }

  // A trip's true destination is the station of its *last* scheduled stop
  // — more reliable than trip_headsign, which PATH sets to the full route
  // name (e.g. "Hoboken - 33rd Street") regardless of direction.
  const stopTimesByTrip = new Map<string, Record<string, string>[]>();
  for (const row of stopTimes) {
    const list = stopTimesByTrip.get(row.trip_id);
    if (list) {
      list.push(row);
    } else {
      stopTimesByTrip.set(row.trip_id, [row]);
    }
  }

  const destinationByTrip = new Map<string, string>();
  for (const [tripId, rows] of stopTimesByTrip) {
    const last = rows.reduce((a, b) =>
      Number.parseInt(a.stop_sequence, 10) > Number.parseInt(b.stop_sequence, 10) ? a : b,
    );
    const destinationName = stopNameById.get(last.stop_id);
    if (destinationName) {
      destinationByTrip.set(tripId, destinationName);
    }
  }

  const departuresByStationAndDestination = new Map<string, Map<string, ScheduledDeparture[]>>();
  for (const row of stopTimes) {
    const stationName = stopNameById.get(row.stop_id);
    const destinationName = destinationByTrip.get(row.trip_id);
    const serviceId = serviceIdByTrip.get(row.trip_id);
    if (!stationName || !destinationName || !serviceId || stationName === destinationName) {
      // Skip the terminal stop of a trip at its own destination station —
      // there's nothing "upcoming" to depart there toward itself.
      continue;
    }
    const departureMinutes = parseGtfsTimeToMinutes(row.departure_time);
    if (!Number.isFinite(departureMinutes)) {
      continue;
    }
    const stationKey = normalizeStationKey(stationName);
    const destinationKey = normalizeStationKey(destinationName);
    let byDestination = departuresByStationAndDestination.get(stationKey);
    if (!byDestination) {
      byDestination = new Map();
      departuresByStationAndDestination.set(stationKey, byDestination);
    }
    const list = byDestination.get(destinationKey) ?? [];
    list.push({ serviceId, departureMinutes });
    byDestination.set(destinationKey, list);
  }

  for (const byDestination of departuresByStationAndDestination.values()) {
    for (const list of byDestination.values()) {
      list.sort((a, b) => a.departureMinutes - b.departureMinutes);
    }
  }

  return {
    departuresByStationAndDestination,
    calendars: calendarRows.map(parseCalendarRow),
    exceptions: calendarDateRows.map((row) => ({
      serviceId: row.service_id,
      date: row.date,
      exceptionType: row.exception_type as '1' | '2',
    })),
  };
}

/**
 * Supplements PathService's live ridepath.json feed — which only ever
 * exposes ~2 upcoming arrivals per direction per station — with genuinely
 * scheduled (not estimated/guessed) departures from PATH's official static
 * GTFS timetable. Used by TransitRouter only when a caller asks for more
 * arrivals toward a specific destination than the live feed currently has.
 */
export class GtfsScheduleService {
  private readonly fetcher: GtfsZipFetcher;
  private readonly cache: TtlCache<ParsedSchedule>;

  constructor(options: { fetcher?: GtfsZipFetcher; cacheTtlMs?: number } = {}) {
    this.fetcher = options.fetcher ?? fetchGtfsZip;
    this.cache = new TtlCache(options.cacheTtlMs ?? DEFAULT_SCHEDULE_TTL_MS);
  }

  /**
   * Returns up to `limit` scheduled (non-live) arrivals at `station` headed
   * toward `destinationDisplayName`, strictly after `now`, soonest first.
   */
  async getUpcomingScheduledArrivals(
    station: ResolvedStation,
    destinationDisplayName: string,
    limit: number,
    now: Date = new Date(),
  ): Promise<TrainArrival[]> {
    if (limit <= 0) {
      return [];
    }
    const schedule = await this.cache.getOrCompute(SCHEDULE_CACHE_KEY, () => this.loadSchedule());
    const departures = schedule.departuresByStationAndDestination
      .get(normalizeStationKey(station.displayName))
      ?.get(normalizeStationKey(destinationDisplayName));
    if (!departures || departures.length === 0) {
      return [];
    }

    const { today, yesterday, nowMinutes } = this.resolveActiveServiceIds(schedule, now);

    const candidates: { minutesAway: number }[] = [];
    for (const departure of departures) {
      if (today.has(departure.serviceId) && departure.departureMinutes > nowMinutes) {
        candidates.push({ minutesAway: departure.departureMinutes - nowMinutes });
      } else if (
        departure.departureMinutes >= 1440 &&
        yesterday.has(departure.serviceId) &&
        departure.departureMinutes - 1440 > nowMinutes
      ) {
        // An after-midnight continuation of yesterday's service day (GTFS
        // represents e.g. 1:03 AM as "25:03:00" tied to the previous day's
        // service_id) that hasn't departed yet relative to "now".
        candidates.push({ minutesAway: departure.departureMinutes - 1440 - nowMinutes });
      }
    }

    candidates.sort((a, b) => a.minutesAway - b.minutesAway);

    return candidates.slice(0, limit).map((c) => ({
      provider: 'PATH' as const,
      stationName: station.displayName,
      lineName: station.lineDisplayName ?? destinationDisplayName,
      destination: destinationDisplayName,
      minutesAway: c.minutesAway,
      status: 'on-time' as const,
      source: 'scheduled' as const,
    }));
  }

  /** Clears the cached parsed schedule (mainly for tests). */
  clearCache(): void {
    this.cache.clear();
  }

  private resolveActiveServiceIds(
    schedule: ParsedSchedule,
    now: Date,
  ): { today: Set<string>; yesterday: Set<string>; nowMinutes: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: SCHEDULE_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'long',
    }).formatToParts(now);

    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = Number.parseInt(get('hour'), 10) % 24; // "24" shows up at the midnight edge
    const minute = Number.parseInt(get('minute'), 10);
    const weekdayName = get('weekday').toLowerCase() as WeekdayName;

    const todayYmd = `${year}${month}${day}`;
    const yesterdayYmd = ymdMinusOneDay(todayYmd);
    const weekdayIndex = WEEKDAY_NAMES.indexOf(weekdayName);
    const yesterdayWeekday = WEEKDAY_NAMES[(weekdayIndex + 6) % 7];

    return {
      today: this.activeServiceIdsFor(schedule, todayYmd, weekdayName),
      yesterday: this.activeServiceIdsFor(schedule, yesterdayYmd, yesterdayWeekday),
      nowMinutes: hour * 60 + minute,
    };
  }

  private activeServiceIdsFor(
    schedule: ParsedSchedule,
    ymd: string,
    weekday: WeekdayName,
  ): Set<string> {
    const active = new Set<string>();
    for (const calendar of schedule.calendars) {
      if (calendar.days[weekday] && ymd >= calendar.startDate && ymd <= calendar.endDate) {
        active.add(calendar.serviceId);
      }
    }
    for (const exception of schedule.exceptions) {
      if (exception.date !== ymd) {
        continue;
      }
      if (exception.exceptionType === '1') {
        active.add(exception.serviceId);
      } else if (exception.exceptionType === '2') {
        active.delete(exception.serviceId);
      }
    }
    return active;
  }

  private async loadSchedule(): Promise<ParsedSchedule> {
    const buffer = await this.fetcher();
    return parseGtfsSchedule(buffer);
  }
}
