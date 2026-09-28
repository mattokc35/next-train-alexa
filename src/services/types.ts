/**
 * Transit provider identifiers supported by the skill. New providers should be
 * added here and given a corresponding TransitService implementation.
 */
export type TransitProvider = 'PATH' | 'MTA';

/**
 * Normalized status describing whether a train/line is running as expected.
 */
export type TrainStatus = 'on-time' | 'delayed' | 'alert' | 'unknown';

/**
 * A single normalized upcoming train arrival, regardless of which upstream
 * feed (PATH REST API or MTA GTFS-realtime) it originated from.
 */
export interface TrainArrival {
  /** Provider that produced this arrival. */
  provider: TransitProvider;
  /** Human-friendly station name, e.g. "Grove Street" or "World Trade Center". */
  stationName: string;
  /** Human-friendly line/route name, e.g. "A" or "Newark-World Trade Center". */
  lineName: string;
  /** Human-friendly headsign/direction, e.g. "to 33rd Street" or "Uptown". */
  destination: string;
  /** Minutes from now until the train is expected to arrive. */
  minutesAway: number;
  /** Normalized service status for this arrival/line. */
  status: TrainStatus;
  /** Optional free-text detail, e.g. a service alert headline. */
  statusDetail?: string;
}

/**
 * Result of resolving a spoken station/line pair against the StationRegistry.
 */
export interface ResolvedStation {
  provider: TransitProvider;
  /** Canonical, human-friendly station name to use in Alexa responses. */
  displayName: string;
  /** Provider-specific station identifier (PATH station id or MTA GTFS stop id). */
  providerStationId: string;
  /** Optional provider-specific line/route identifier, if the user specified one. */
  providerLineId?: string;
  /** Human-friendly line name to use in Alexa responses, if known. */
  lineDisplayName?: string;
  /** MTA GTFS-realtime feed group (e.g. "ace"); unused for PATH. */
  feedGroup?: string;
}

/**
 * Common interface implemented by each transit provider adapter (PathService,
 * MtaService). Consumers (the transit router / intent handlers) only depend on
 * this interface, never on provider-specific details.
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
