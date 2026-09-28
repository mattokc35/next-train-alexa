import { defaultFetch } from './httpClient';
import type { HttpFetch } from './httpClient';
import { TtlCache } from './cache';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

/**
 * Shape of a single upcoming train entry returned by the community PATH
 * real-time API (https://path.api.razza.dev). This is an unofficial,
 * best-effort API (there is no stable official PATH real-time API) — verify
 * this schema against the live endpoint before relying on it in production.
 */
interface PathUpcomingTrain {
  projectedArrival: string; // ISO-8601 timestamp
  lastUpdated: string; // ISO-8601 timestamp
  direction: 'TO_NY' | 'TO_NJ' | string;
  route: string; // e.g. "JSQ_33_HOB"
  lineName?: string;
  headSign?: string;
  status?: string; // e.g. "ON_TIME", "DELAYED"; not always present
}

interface PathRealtimeResponse {
  upcomingTrains: PathUpcomingTrain[];
}

export interface PathServiceOptions {
  /** Base URL for the community PATH real-time API. */
  baseUrl?: string;
  /** Cache TTL in milliseconds for realtime responses. */
  cacheTtlMs?: number;
  fetchImpl?: HttpFetch;
}

const DEFAULT_BASE_URL = 'https://path.api.razza.dev/v1';
const DEFAULT_CACHE_TTL_MS = 30_000;

/**
 * Adapter for NJ Transit/PANYNJ's PATH train system, backed by the
 * community-maintained path.api.razza.dev real-time JSON API.
 */
export class PathService implements TransitService {
  readonly provider = 'PATH' as const;

  private readonly baseUrl: string;
  private readonly fetchImpl: HttpFetch;
  private readonly cache: TtlCache<PathUpcomingTrain[]>;

  constructor(options: PathServiceOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.cache = new TtlCache(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  async getNextArrivals(station: ResolvedStation): Promise<TrainArrival[]> {
    const trains = await this.fetchRealtime(station.providerStationId);
    const filtered = station.providerLineId
      ? trains.filter((t) => t.route === station.providerLineId)
      : trains;
    return filtered
      .map((train) => this.toTrainArrival(station, train))
      .sort((a, b) => a.minutesAway - b.minutesAway);
  }

  async getDelayStatus(station: ResolvedStation): Promise<TrainArrival[]> {
    // PATH has no official alerts/delay feed; we derive a best-effort status
    // per-arrival from the `status` field the community API sometimes
    // includes, plus a stale-data heuristic (see toTrainArrival).
    return this.getNextArrivals(station);
  }

  private async fetchRealtime(providerStationId: string): Promise<PathUpcomingTrain[]> {
    return this.cache.getOrCompute(providerStationId, async () => {
      const url = `${this.baseUrl}/stations/${encodeURIComponent(providerStationId)}/realtime`;
      const response = await this.fetchImpl(url);
      if (!response.ok) {
        throw new Error(`PATH API request failed: ${response.status} ${response.statusText}`);
      }
      const data = (await response.json()) as PathRealtimeResponse;
      return data.upcomingTrains ?? [];
    });
  }

  private toTrainArrival(station: ResolvedStation, train: PathUpcomingTrain): TrainArrival {
    const minutesAway = Math.max(
      0,
      Math.round((new Date(train.projectedArrival).getTime() - Date.now()) / 60_000),
    );
    const staleMs = Date.now() - new Date(train.lastUpdated).getTime();
    const status = this.deriveStatus(train, staleMs);
    return {
      provider: 'PATH',
      stationName: station.displayName,
      lineName: station.lineDisplayName ?? train.lineName ?? train.route,
      destination: train.headSign ?? (train.direction === 'TO_NY' ? 'New York' : 'New Jersey'),
      minutesAway,
      status,
      statusDetail:
        status === 'alert' ? 'Real-time data may be stale; check PATH alerts.' : undefined,
    };
  }

  private deriveStatus(train: PathUpcomingTrain, staleMs: number): TrainArrival['status'] {
    if (train.status?.toUpperCase().includes('DELAY')) {
      return 'delayed';
    }
    // If the feed hasn't updated in over 5 minutes, treat it as a possible
    // service disruption rather than confidently reporting "on-time".
    if (staleMs > 5 * 60_000) {
      return 'alert';
    }
    return 'on-time';
  }
}
