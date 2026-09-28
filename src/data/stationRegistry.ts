import type { TransitProvider } from '../services/types';

/**
 * A single line/route available at a station, in a provider-specific form.
 */
export interface LineDefinition {
  /** Canonical internal id, e.g. "mta-a" or "path-jsq-33-hob". */
  id: string;
  /** Human-friendly name used in Alexa responses, e.g. "A" or "Journal Square – 33rd". */
  displayName: string;
  /** Provider-specific route identifier (PATH route code or MTA GTFS route_id). */
  providerLineId: string;
  /** MTA GTFS-realtime feed group this route belongs to (e.g. "ace", "123456s"). Unused for PATH. */
  feedGroup?: string;
  /** Alternate spoken forms that should resolve to this line, lower-cased. */
  aliases: string[];
}

/**
 * A single station, general-purpose across both providers.
 */
export interface StationDefinition {
  /** Canonical internal id, e.g. "path-grove-street". */
  id: string;
  provider: TransitProvider;
  /** Human-friendly name used in Alexa responses, e.g. "Grove Street". */
  displayName: string;
  /** Provider-specific station identifier (PATH station slug or MTA GTFS parent stop_id). */
  providerStationId: string;
  /** Alternate spoken forms that should resolve to this station, lower-cased. */
  aliases: string[];
  /** Lines/routes that serve this station. */
  lines: LineDefinition[];
}

/**
 * Normalizes free-text Alexa slot values for fuzzy matching: lower-cases,
 * strips punctuation, and collapses common station-name variants ("st" vs
 * "street", "ave" vs "avenue", etc.) so "grove st" and "Grove Street" match.
 */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\bstreet\b/g, 'st')
    .replace(/\bavenue\b/g, 'ave')
    .replace(/\bsaint\b/g, 'st')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * General-purpose, in-memory directory of stations/lines for both providers.
 * Ships with a small set of default stations (used in the interaction model
 * samples and tests) but is designed to be extended with the full PATH and
 * MTA station lists without any code changes elsewhere in the skill.
 */
export class StationRegistry {
  constructor(private readonly stations: StationDefinition[] = DEFAULT_STATIONS) {}

  getAll(): StationDefinition[] {
    return this.stations;
  }

  /**
   * Resolve a spoken station name (required) and optional line/route name to
   * a station definition. Returns undefined if no station matches.
   */
  findStation(stationSlotValue: string): StationDefinition | undefined {
    const target = normalize(stationSlotValue);
    return this.stations.find(
      (station) =>
        normalize(station.displayName) === target ||
        station.aliases.some((a) => normalize(a) === target),
    );
  }

  /**
   * Resolve a line/route within a given station by spoken name. Returns
   * undefined if the station has no matching line (caller should fall back
   * to "all lines at this station").
   */
  findLine(station: StationDefinition, lineSlotValue: string): LineDefinition | undefined {
    const target = normalize(lineSlotValue);
    return station.lines.find(
      (line) =>
        normalize(line.displayName) === target || line.aliases.some((a) => normalize(a) === target),
    );
  }

  /** The station used when the user doesn't specify one (falls back to Grove St). */
  getDefaultStation(): StationDefinition {
    return this.stations[0];
  }
}

/**
 * Default/example stations covering both providers, used for local testing
 * and as the basis for the interaction model's sample utterances:
 *  - PATH: Grove Street, 33rd Street
 *  - MTA: 9th Street (A/C/E), World Trade Center (1/2/3)
 *
 * NOTE: `providerStationId` / `providerLineId` values below reflect the
 * publicly documented PATH (path.api.razza.dev) and MTA GTFS-realtime
 * identifiers at the time of writing. Because this scaffold was built
 * without live network access to verify the upstream schemas, double-check
 * these ids against the live APIs (see README) before deploying, and extend
 * this list with additional stations/lines as needed — the rest of the
 * skill is provider-agnostic and requires no other changes to support them.
 */
export const DEFAULT_STATIONS: StationDefinition[] = [
  {
    id: 'path-grove-street',
    provider: 'PATH',
    displayName: 'Grove Street',
    providerStationId: 'grove_street',
    aliases: ['grove st', 'grove street station'],
    lines: [
      {
        id: 'path-jsq-33-hob',
        displayName: 'Journal Square to 33rd Street',
        providerLineId: 'JSQ_33_HOB',
        aliases: ['journal square 33rd', 'jsq 33rd', 'hoboken line'],
      },
      {
        id: 'path-hob-wtc',
        displayName: 'Hoboken to World Trade Center',
        providerLineId: 'HOB_WTC',
        aliases: ['hoboken world trade center', 'wtc line'],
      },
    ],
  },
  {
    id: 'path-33rd-street',
    provider: 'PATH',
    displayName: '33rd Street',
    providerStationId: 'thirty_third_street',
    aliases: ['33rd st', '33rd street station', 'thirty third street'],
    lines: [
      {
        id: 'path-jsq-33-hob',
        displayName: 'Journal Square to 33rd Street',
        providerLineId: 'JSQ_33_HOB',
        aliases: ['journal square 33rd', 'jsq 33rd'],
      },
      {
        id: 'path-nwk-33',
        displayName: 'Newark to 33rd Street',
        providerLineId: 'NWK_33',
        aliases: ['newark 33rd'],
      },
    ],
  },
  {
    id: 'mta-9th-street',
    provider: 'MTA',
    displayName: '9th Street',
    providerStationId: 'A32',
    aliases: ['9th st', 'ninth street', 'ninth st'],
    lines: [
      {
        id: 'mta-a',
        displayName: 'A',
        providerLineId: 'A',
        feedGroup: 'ace',
        aliases: ['a train', 'a line'],
      },
      {
        id: 'mta-c',
        displayName: 'C',
        providerLineId: 'C',
        feedGroup: 'ace',
        aliases: ['c train', 'c line'],
      },
      {
        id: 'mta-e',
        displayName: 'E',
        providerLineId: 'E',
        feedGroup: 'ace',
        aliases: ['e train', 'e line'],
      },
    ],
  },
  {
    id: 'mta-world-trade-center',
    provider: 'MTA',
    displayName: 'World Trade Center',
    providerStationId: '142',
    aliases: ['wtc', 'world trade center station'],
    lines: [
      {
        id: 'mta-1',
        displayName: '1',
        providerLineId: '1',
        feedGroup: '123456s',
        aliases: ['1 train', 'one train', 'one line'],
      },
      {
        id: 'mta-2',
        displayName: '2',
        providerLineId: '2',
        feedGroup: '123456s',
        aliases: ['2 train', 'two train', 'two line'],
      },
      {
        id: 'mta-3',
        displayName: '3',
        providerLineId: '3',
        feedGroup: '123456s',
        aliases: ['3 train', 'three train', 'three line'],
      },
    ],
  },
];
