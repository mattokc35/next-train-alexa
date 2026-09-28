import { StationRegistry, normalize, DEFAULT_STATIONS } from '../data/stationRegistry';

describe('normalize', () => {
  it('collapses common station-name variants for matching', () => {
    expect(normalize('Grove Street')).toBe('grove st');
    expect(normalize('grove st')).toBe('grove st');
    expect(normalize('9th Avenue')).toBe('9th ave');
  });
});

describe('StationRegistry', () => {
  const registry = new StationRegistry(DEFAULT_STATIONS);

  it('resolves a station by exact display name', () => {
    const station = registry.findStation('Grove Street');
    expect(station?.id).toBe('path-grove-street');
  });

  it('resolves a station by alias, case-insensitively', () => {
    const station = registry.findStation('grove st');
    expect(station?.id).toBe('path-grove-street');
  });

  it('resolves MTA default stations', () => {
    expect(registry.findStation('9th Street')?.id).toBe('mta-9th-street');
    expect(registry.findStation('World Trade Center')?.id).toBe('mta-world-trade-center');
  });

  it('returns undefined for an unknown station', () => {
    expect(registry.findStation('Nonexistent Station')).toBeUndefined();
  });

  it('resolves a line within a station by alias', () => {
    const station = registry.findStation('9th Street')!;
    const line = registry.findLine(station, 'a train');
    expect(line?.id).toBe('mta-a');
  });

  it('returns undefined for a line not served at the station', () => {
    const station = registry.findStation('9th Street')!;
    expect(registry.findLine(station, '1 train')).toBeUndefined();
  });

  it('falls back to the first station as the default', () => {
    expect(registry.getDefaultStation().id).toBe(DEFAULT_STATIONS[0].id);
  });
});
