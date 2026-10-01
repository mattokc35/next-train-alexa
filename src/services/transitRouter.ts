import { StationRegistry, normalize } from '../data/stationRegistry';
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

  /**
   * Filters arrivals down to those heading toward a spoken destination
   * station (e.g. "the 33rd Street train"). PATH's official feed already
   * reports each arrival's `destination` as a station name, so we resolve
   * the spoken destination to a canonical station and match on its
   * `displayName` rather than requiring an exact full line name like the
   * LINE slot does.
   */
  private filterByDestination(
    arrivals: TrainArrival[],
    destinationSlotValue: string | undefined,
  ): TrainArrival[] {
    if (!destinationSlotValue) {
      return arrivals;
    }
    const destinationStation = this.registry.findStation(destinationSlotValue);
    const target = normalize(destinationStation?.displayName ?? destinationSlotValue);
    // PATH headsigns sometimes carry a routing qualifier, e.g.
    // "33rd Street via Hoboken" — match on the base destination name so a
    // spoken "33rd Street" still matches regardless of the via-suffix.
    return arrivals.filter((arrival) => {
      const baseDestination = arrival.destination.split(/\s+via\s+/i)[0];
      return normalize(baseDestination) === target;
    });
  }

  async getNextArrivals(
    stationSlotValue: string | undefined,
    lineSlotValue: string | undefined,
    destinationSlotValue?: string,
  ): Promise<{ station: StationDefinition; arrivals: TrainArrival[] } | undefined> {
    const match = this.resolve(stationSlotValue, lineSlotValue);
    if (!match) {
      return undefined;
    }
    const arrivals = await match.service.getNextArrivals(match.resolved);
    return { station: match.station, arrivals: this.filterByDestination(arrivals, destinationSlotValue) };
  }

  async getDelayStatus(
    stationSlotValue: string | undefined,
    lineSlotValue: string | undefined,
    destinationSlotValue?: string,
  ): Promise<{ station: StationDefinition; arrivals: TrainArrival[] } | undefined> {
    const match = this.resolve(stationSlotValue, lineSlotValue);
    if (!match) {
      return undefined;
    }
    const arrivals = await match.service.getDelayStatus(match.resolved);
    return { station: match.station, arrivals: this.filterByDestination(arrivals, destinationSlotValue) };
  }
}
