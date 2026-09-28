import { defaultFetch } from './httpClient';
import type { HttpFetch } from './httpClient';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { TtlCache } from './cache';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

/**
 * Base URL for the MTA's public GTFS-realtime feed endpoints
 * (https://api.mta.info -> "Real-Time GTFS" section). Each subway "feed
 * group" (a set of related lines) is served from its own path.
 */
const DEFAULT_BASE_URL = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds';
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Maps the `feedGroup` values used in the StationRegistry to the MTA's
 * GTFS-realtime feed path suffix. Extend this map as more lines are added
 * to the registry — no other code needs to change.
 */
const FEED_PATHS: Record<string, string> = {
  ace: 'nyct%2Fgtfs-ace',
  bdfm: 'nyct%2Fgtfs-bdfm',
  g: 'nyct%2Fgtfs-g',
  jz: 'nyct%2Fgtfs-jz',
  nqrw: 'nyct%2Fgtfs-nqrw',
  l: 'nyct%2Fgtfs-l',
  '123456s': 'nyct%2Fgtfs',
  sir: 'nyct%2Fgtfs-si',
};

export interface MtaServiceOptions {
  /** MTA real-time API key (free signup at https://api.mta.info). */
  apiKey: string;
  baseUrl?: string;
  cacheTtlMs?: number;
  fetchImpl?: HttpFetch;
}

/** Minimal shape we rely on from the decoded GTFS-realtime FeedMessage. */
interface DecodedFeed {
  entity: Array<{
    tripUpdate?: {
      trip?: { routeId?: string | null };
      stopTimeUpdate?: Array<{
        stopId?: string | null;
        arrival?: { time?: number | { toNumber(): number } | null } | null;
        departure?: { time?: number | { toNumber(): number } | null } | null;
      }>;
    } | null;
    alert?: {
      informedEntity?: Array<{ routeId?: string | null; stopId?: string | null }>;
      headerText?: { translation?: Array<{ text?: string | null }> } | null;
    } | null;
  }>;
}

function toUnixSeconds(
  value: number | { toNumber(): number } | null | undefined,
): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return typeof value === 'number' ? value : value.toNumber();
}

/**
 * Adapter for the MTA subway system, backed by the official GTFS-realtime
 * protobuf feeds (https://api.mta.info). Requires a free API key.
 */
export class MtaService implements TransitService {
  readonly provider = 'MTA' as const;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: HttpFetch;
  private readonly cache: TtlCache<DecodedFeed>;

  constructor(options: MtaServiceOptions) {
    if (!options.apiKey) {
      throw new Error('MtaService requires an MTA API key (set MTA_API_KEY).');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.cache = new TtlCache(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  async getNextArrivals(station: ResolvedStation): Promise<TrainArrival[]> {
    const feedGroup = this.requireFeedGroup(station);
    const feed = await this.fetchFeed(feedGroup);
    const arrivals: TrainArrival[] = [];

    for (const entity of feed.entity) {
      const trip = entity.tripUpdate;
      if (!trip?.trip?.routeId) {
        continue;
      }
      if (station.providerLineId && trip.trip.routeId !== station.providerLineId) {
        continue;
      }
      for (const stopUpdate of trip.stopTimeUpdate ?? []) {
        if (!stopUpdate.stopId?.startsWith(station.providerStationId)) {
          continue;
        }
        const epochSeconds =
          toUnixSeconds(stopUpdate.arrival?.time) ?? toUnixSeconds(stopUpdate.departure?.time);
        if (epochSeconds === undefined) {
          continue;
        }
        const minutesAway = Math.max(0, Math.round((epochSeconds * 1000 - Date.now()) / 60_000));
        arrivals.push({
          provider: 'MTA',
          stationName: station.displayName,
          lineName: station.lineDisplayName ?? trip.trip.routeId,
          destination: stopUpdate.stopId.endsWith('N') ? 'Uptown' : 'Downtown',
          minutesAway,
          status: 'on-time',
        });
      }
    }

    return arrivals.sort((a, b) => a.minutesAway - b.minutesAway);
  }

  async getDelayStatus(station: ResolvedStation): Promise<TrainArrival[]> {
    const feedGroup = this.requireFeedGroup(station);
    const feed = await this.fetchFeed(feedGroup);
    const arrivals = await this.getNextArrivals(station);

    const relevantAlerts = feed.entity
      .map((e) => e.alert)
      .filter(
        (alert): alert is NonNullable<typeof alert> =>
          !!alert &&
          !!alert.informedEntity?.some(
            (informed) =>
              (!station.providerLineId || informed.routeId === station.providerLineId) &&
              (!informed.stopId || informed.stopId.startsWith(station.providerStationId)),
          ),
      );

    if (relevantAlerts.length === 0) {
      return arrivals;
    }

    const detail = relevantAlerts
      .map((alert) => alert.headerText?.translation?.[0]?.text)
      .filter((text): text is string => !!text)
      .join(' ');

    return arrivals.map((arrival) => ({
      ...arrival,
      status: 'alert',
      statusDetail: detail || 'Service alert in effect for this line.',
    }));
  }

  private requireFeedGroup(station: ResolvedStation): string {
    // The TransitRouter is responsible for resolving and stashing the feed
    // group (from the matched LineDefinition) onto the ResolvedStation.
    const feedGroup = station.feedGroup;
    if (!feedGroup || !FEED_PATHS[feedGroup]) {
      throw new Error(`Unknown or missing MTA feed group for station "${station.displayName}".`);
    }
    return feedGroup;
  }

  private async fetchFeed(feedGroup: string): Promise<DecodedFeed> {
    return this.cache.getOrCompute(feedGroup, async () => {
      const url = `${this.baseUrl}/${FEED_PATHS[feedGroup]}`;
      const response = await this.fetchImpl(url, {
        headers: { 'x-api-key': this.apiKey },
      });
      if (!response.ok) {
        throw new Error(
          `MTA GTFS-realtime request failed: ${response.status} ${response.statusText}`,
        );
      }
      const buffer = await response.buffer();
      const decoded = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);
      return decoded as unknown as DecodedFeed;
    });
  }
}
