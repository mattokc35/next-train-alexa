/**
 * Transit provider identifiers supported by the skill. Currently PATH-only,
 * but kept as a union (rather than a literal) so a future provider (e.g. MTA
 * subway) can be reintroduced by adding a value here and a corresponding
 * TransitService implementation, without touching this file's consumers.
 */
export type TransitProvider = 'PATH';

/**
 * Normalized status describing whether a train/line is running as expected.
 */
export type TrainStatus = 'on-time' | 'delayed' | 'alert' | 'unknown';

/**
 * A single normalized upcoming train arrival, regardless of which upstream
 * feed it originated from.
 */
export interface TrainArrival {
  /** Provider that produced this arrival. */
  provider: TransitProvider;
  /** Human-friendly station name, e.g. "Grove Street" or "World Trade Center". */
  stationName: string;
  /** Human-friendly line/route name, e.g. "Hoboken to 33rd Street". */
  lineName: string;
  /** Human-friendly headsign/direction, e.g. "33rd Street" or "Hoboken". */
  destination: string;
  /** Minutes from now until the train is expected to arrive. */
  minutesAway: number;
  /** Normalized service status for this arrival/line. */
  status: TrainStatus;
  /** Optional free-text detail, e.g. a service alert headline. */
  statusDetail?: string;
  /**
   * Where this arrival's timing came from. Defaults to `'live'` (the
   * real-time ridepath.json feed) when omitted. `'scheduled'` marks an
   * arrival computed from PATH's published GTFS static timetable rather
   * than live tracking — used to supplement the live feed, which only ever
   * exposes ~2 upcoming arrivals per direction (see GtfsScheduleService).
   */
  source?: 'live' | 'scheduled';
}

/**
 * Result of resolving a spoken station/line pair against the StationRegistry.
 */
export interface ResolvedStation {
  provider: TransitProvider;
  /** Canonical, human-friendly station name to use in Alexa responses. */
  displayName: string;
  /** Provider-specific station identifier (PATH's `consideredStation` code, e.g. "GRV"). */
  providerStationId: string;
  /** Human-friendly line name to use in Alexa responses, if the user specified a line. */
  lineDisplayName?: string;
  /**
   * Headsigns (destination names) that identify this line in PATH's official
   * ridepath.json feed, used to filter arrivals since that feed does not
   * expose a distinct route/line code (see PathService for details).
   * Undefined/empty means "any line at this station".
   */
  lineHeadSigns?: string[];
}

/**
 * Common interface implemented by each transit provider adapter (currently
 * just PathService). Consumers (the transit router / intent handlers) only
 * depend on this interface, never on provider-specific details, so a new
 * provider can be added later without changing handlers or the router.
 */
export interface TransitService {
  readonly provider: TransitProvider;

  /**
   * Fetch and normalize upcoming arrivals for a resolved station (optionally
   * filtered to a specific line), soonest first.
   */
  getNextArrivals(station: ResolvedStation): Promise<TrainArrival[]>;

  /**
   * Fetch and normalize current delay/alert status for a resolved station
   * (optionally filtered to a specific line).
   */
  getDelayStatus(station: ResolvedStation): Promise<TrainArrival[]>;
}
