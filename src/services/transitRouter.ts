import { StationRegistry } from '../data/stationRegistry';
import type { StationDefinition } from '../data/stationRegistry';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

/**
 * Resolves spoken station/line slot values to a ResolvedStation and
 * dispatches to the injected TransitService. Currently PATH-only, but
 * intent handlers only ever talk to the TransitRouter — reintroducing a
 * second provider would only require changing this class's constructor to
 * pick a service based on `station.provider`, not the handlers.
 */
export class TransitRouter {
  constructor(
    private readonly registry: StationRegistry,
    private readonly service: TransitService,
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

    const resolved: ResolvedStation = {
      provider: station.provider,
      displayName: station.displayName,
      providerStationId: station.providerStationId,
      lineDisplayName: line?.displayName,
      lineHeadSigns: line?.headSigns,
    };

    return { resolved, service: this.service, station };
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
