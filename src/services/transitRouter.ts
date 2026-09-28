import { StationRegistry } from '../data/stationRegistry';
import type { StationDefinition } from '../data/stationRegistry';
import type { MtaService } from './mtaService';
import type { PathService } from './pathService';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

/**
 * Resolves spoken station/line slot values to a concrete provider + service,
 * and dispatches to the matching TransitService (PathService or MtaService).
 * This is the only place that knows both providers exist — intent handlers
 * only ever talk to the TransitRouter.
 */
export class TransitRouter {
  constructor(
    private readonly registry: StationRegistry,
    private readonly services: {
      path: TransitService | PathService;
      mta: TransitService | MtaService;
    },
  ) {}

  /**
   * Resolve a station (and optional line) slot value pair into a
   * ResolvedStation plus the TransitService that should serve it. Returns
   * undefined if the station could not be matched.
   */
  resolve(
    stationSlotValue: string | undefined,
    lineSlotValue: string | undefined,
  ):
    { resolved: ResolvedStation; service: TransitService; station: StationDefinition } | undefined {
    const station = stationSlotValue
      ? this.registry.findStation(stationSlotValue)
      : this.registry.getDefaultStation();
    if (!station) {
      return undefined;
    }

    const line = lineSlotValue ? this.registry.findLine(station, lineSlotValue) : undefined;
    const effectiveLine = line ?? station.lines[0];

    const resolved: ResolvedStation = {
      provider: station.provider,
      displayName: station.displayName,
      providerStationId: station.providerStationId,
      providerLineId: line?.providerLineId,
      lineDisplayName: line?.displayName,
      feedGroup: effectiveLine?.feedGroup,
    };

    const service = station.provider === 'PATH' ? this.services.path : this.services.mta;
    return { resolved, service, station };
  }

  async getNextArrivals(
    stationSlotValue: string | undefined,
    lineSlotValue: string | undefined,
  ): Promise<{ station: StationDefinition; arrivals: TrainArrival[] } | undefined> {
    const match = this.resolve(stationSlotValue, lineSlotValue);
    if (!match) {
      return undefined;
    }
    const arrivals = await match.service.getNextArrivals(match.resolved);
    return { station: match.station, arrivals };
  }

  async getDelayStatus(
    stationSlotValue: string | undefined,
    lineSlotValue: string | undefined,
  ): Promise<{ station: StationDefinition; arrivals: TrainArrival[] } | undefined> {
    const match = this.resolve(stationSlotValue, lineSlotValue);
    if (!match) {
      return undefined;
    }
    const arrivals = await match.service.getDelayStatus(match.resolved);
    return { station: match.station, arrivals };
  }
}
