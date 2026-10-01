import { StationRegistry, normalize } from '../data/stationRegistry';
import type { StationDefinition } from '../data/stationRegistry';
import type { GtfsScheduleService } from './gtfsScheduleService';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

// When supplementing live results with scheduled ones, skip any scheduled
// departure within this many minutes of an already-shown live arrival —
// PATH's live feed and its own published timetable both describe the same
// physical trains, so without this a train already reported by the live
// feed could also show up a second time as a "scheduled" duplicate.
const SCHEDULED_DEDUPE_WINDOW_MINUTES = 3;

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
    private readonly scheduleService?: GtfsScheduleService,
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
    desiredCount = 3,
  ): Promise<{ station: StationDefinition; arrivals: TrainArrival[] } | undefined> {
    const match = this.resolve(stationSlotValue, lineSlotValue);
    if (!match) {
      return undefined;
    }
    const arrivals = await match.service.getNextArrivals(match.resolved);
    const filtered = this.filterByDestination(arrivals, destinationSlotValue);

    if (this.scheduleService && destinationSlotValue && filtered.length < desiredCount) {
      const destinationStation = this.registry.findStation(destinationSlotValue);
      const destinationDisplayName = destinationStation?.displayName ?? destinationSlotValue;
      const scheduled = await this.scheduleService.getUpcomingScheduledArrivals(
        match.resolved,
        destinationDisplayName,
        desiredCount - filtered.length + SCHEDULED_DEDUPE_WINDOW_MINUTES, // fetch extra to absorb de-dup
      );
      return {
        station: match.station,
        arrivals: this.mergeWithScheduled(filtered, scheduled, desiredCount),
      };
    }

    return { station: match.station, arrivals: filtered };
  }

  /**
   * Combines live arrivals with schedule-derived ones computed from PATH's
   * official GTFS timetable, dropping any scheduled departure that likely
   * duplicates a live arrival already in the list (see
   * SCHEDULED_DEDUPE_WINDOW_MINUTES), then sorts and truncates to the
   * requested count.
   */
  private mergeWithScheduled(
    live: TrainArrival[],
    scheduled: TrainArrival[],
    desiredCount: number,
  ): TrainArrival[] {
    const deduped = scheduled.filter(
      (candidate) =>
        !live.some(
          (existing) =>
            Math.abs(existing.minutesAway - candidate.minutesAway) <=
            SCHEDULED_DEDUPE_WINDOW_MINUTES,
        ),
    );
    return [...live, ...deduped]
      .sort((a, b) => a.minutesAway - b.minutesAway)
      .slice(0, desiredCount);
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
