import type { TransitProvider } from '../services/types';

/**
 * A single PATH line/route available at a station. The official ridepath.json
 * feed (see PathService) does not expose a distinct route/line code — only a
 * per-arrival `headSign` (destination name) and direction label. We identify
 * a "line" here by the set of headsigns it can produce, so filtering by line
 * means matching an arrival's headSign against this list.
 */
export interface LineDefinition {
  /** Canonical internal id, e.g. "path-jsq-33". */
  id: string;
  /** Human-friendly name used in Alexa responses, e.g. "Journal Square to 33rd Street". */
  displayName: string;
  /** Destination headsigns (case-insensitive) that identify this line. */
  headSigns: string[];
  /** Alternate spoken forms that should resolve to this line, lower-cased. */
  aliases: string[];
}

/**
 * A single PATH station.
 */
export interface StationDefinition {
  /** Canonical internal id, e.g. "path-grove-street". */
  id: string;
  provider: TransitProvider;
  /** Human-friendly name used in Alexa responses, e.g. "Grove Street". */
  displayName: string;
  /** PATH's `consideredStation` station code from the official ridepath.json feed. */
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
 * General-purpose, in-memory directory of PATH stations/lines. Ships with
 * all 13 currently-operating PATH stations (used in the interaction model
 * samples and tests), defaulting to Grove Street when no station is spoken.
 */
export class StationRegistry {
  constructor(private readonly stations: StationDefinition[] = DEFAULT_STATIONS) {}

  getAll(): StationDefinition[] {
    return this.stations;
  }

  /**
   * Resolve a spoken station name (required) to a station definition.
   * Returns undefined if no station matches.
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
   * Resolve a line within a given station by spoken name. Returns undefined
   * if the station has no matching line (caller should fall back to "all
   * lines at this station").
   */
  findLine(station: StationDefinition, lineSlotValue: string): LineDefinition | undefined {
    const target = normalize(lineSlotValue);
    return station.lines.find(
      (line) =>
        normalize(line.displayName) === target || line.aliases.some((a) => normalize(a) === target),
    );
  }

  /** The station used when the user doesn't specify one (falls back to Grove Street). */
  getDefaultStation(): StationDefinition {
    return this.stations[0];
  }
}

/**
 * The four PATH lines, identified by the destination headsigns they produce
 * in the official ridepath.json feed. Stop patterns below reflect PATH's
 * public system map at the time of writing but were NOT verified against a
 * live feed in this environment — double-check against
 * https://www.panynj.gov/path/en/index.html before relying on them.
 */
const NWK_WTC: LineDefinition = {
  id: 'path-nwk-wtc',
  displayName: 'Newark to World Trade Center',
  headSigns: ['Newark', 'World Trade Center'],
  aliases: ['newark world trade center', 'newark line', 'nwk wtc'],
};

const HOB_WTC: LineDefinition = {
  id: 'path-hob-wtc',
  displayName: 'Hoboken to World Trade Center',
  headSigns: ['Hoboken', 'World Trade Center'],
  aliases: ['hoboken world trade center', 'wtc line', 'hob wtc'],
};

const HOB_33: LineDefinition = {
  id: 'path-hob-33',
  displayName: 'Hoboken to 33rd Street',
  headSigns: ['Hoboken', '33rd Street'],
  aliases: ['hoboken 33rd street', 'hoboken line', 'hob 33'],
};

const JSQ_33: LineDefinition = {
  id: 'path-jsq-33',
  displayName: 'Journal Square to 33rd Street',
  headSigns: ['Journal Square', '33rd Street'],
  aliases: ['journal square 33rd street', 'journal square line', 'jsq 33'],
};

/**
 * All 13 currently-operating PATH stations. `providerStationId` values are
 * the official station codes used by the ridepath.json feed's
 * `consideredStation` field.
 */
export const DEFAULT_STATIONS: StationDefinition[] = [
  {
    id: 'path-grove-street',
    provider: 'PATH',
    displayName: 'Grove Street',
    providerStationId: 'GRV',
    aliases: ['grove st', 'grove street station'],
    lines: [NWK_WTC, JSQ_33],
  },
  {
    id: 'path-33rd-street',
    provider: 'PATH',
    displayName: '33rd Street',
    providerStationId: '33S',
    aliases: ['33rd st', '33rd street station', 'thirty third street'],
    lines: [HOB_33, JSQ_33],
  },
  {
    id: 'path-newark',
    provider: 'PATH',
    displayName: 'Newark',
    providerStationId: 'NWK',
    aliases: ['newark station', 'newark penn station'],
    lines: [NWK_WTC],
  },
  {
    id: 'path-harrison',
    provider: 'PATH',
    displayName: 'Harrison',
    providerStationId: 'HAR',
    aliases: ['harrison station'],
    lines: [NWK_WTC],
  },
  {
    id: 'path-journal-square',
    provider: 'PATH',
    displayName: 'Journal Square',
    providerStationId: 'JSQ',
    aliases: ['journal square station'],
    lines: [NWK_WTC, JSQ_33],
  },
  {
    id: 'path-newport',
    provider: 'PATH',
    displayName: 'Newport',
    providerStationId: 'NEW',
    aliases: ['newport station'],
    lines: [NWK_WTC, HOB_WTC],
  },
  {
    id: 'path-exchange-place',
    provider: 'PATH',
    displayName: 'Exchange Place',
    providerStationId: 'EXP',
    aliases: ['exchange place station'],
    lines: [NWK_WTC, HOB_WTC],
  },
  {
    id: 'path-hoboken',
    provider: 'PATH',
    displayName: 'Hoboken',
    providerStationId: 'HOB',
    aliases: ['hoboken station', 'hoboken terminal'],
    lines: [HOB_WTC, HOB_33],
  },
  {
    id: 'path-world-trade-center',
    provider: 'PATH',
    displayName: 'World Trade Center',
    providerStationId: 'WTC',
    aliases: ['wtc', 'world trade center station'],
    lines: [NWK_WTC, HOB_WTC],
  },
  {
    id: 'path-christopher-street',
    provider: 'PATH',
    displayName: 'Christopher Street',
    providerStationId: 'CHR',
    aliases: ['christopher st', 'christopher street station'],
    lines: [HOB_33, JSQ_33],
  },
  {
    id: 'path-9th-street',
    provider: 'PATH',
    displayName: '9th Street',
    providerStationId: '09S',
    aliases: ['9th st', 'ninth street', 'ninth st'],
    lines: [HOB_33, JSQ_33],
  },
  {
    id: 'path-14th-street',
    provider: 'PATH',
    displayName: '14th Street',
    providerStationId: '14S',
    aliases: ['14th st', 'fourteenth street'],
    lines: [HOB_33, JSQ_33],
  },
  {
    id: 'path-23rd-street',
    provider: 'PATH',
    displayName: '23rd Street',
    providerStationId: '23S',
    aliases: ['23rd st', 'twenty third street'],
    lines: [HOB_33, JSQ_33],
  },
];
