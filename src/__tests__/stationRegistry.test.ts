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

  it('ships with all 13 official PATH stations', () => {
    expect(DEFAULT_STATIONS).toHaveLength(13);
  });

  it('resolves a station by exact display name', () => {
    const station = registry.findStation('Grove Street');
    expect(station?.id).toBe('path-grove-street');
    expect(station?.providerStationId).toBe('GRV');
  });

  it('resolves a station by alias, case-insensitively', () => {
    const station = registry.findStation('grove st');
    expect(station?.id).toBe('path-grove-street');
  });

  it('resolves the 33rd Street station', () => {
    const station = registry.findStation('33rd Street');
    expect(station?.id).toBe('path-33rd-street');
    expect(station?.providerStationId).toBe('33S');
  });

  it('resolves the World Trade Center station', () => {
    const station = registry.findStation('World Trade Center');
    expect(station?.id).toBe('path-world-trade-center');
    expect(station?.providerStationId).toBe('WTC');
  });

  it('returns undefined for an unknown station', () => {
    expect(registry.findStation('Nonexistent Station')).toBeUndefined();
  });

  it('resolves a line within a station by alias', () => {
    const station = registry.findStation('33rd Street')!;
    const line = registry.findLine(station, 'hoboken line');
    expect(line?.id).toBe('path-hob-33');
    expect(line?.headSigns).toEqual(expect.arrayContaining(['Hoboken', '33rd Street']));
  });

  it('returns undefined for a line not served at the station', () => {
    const station = registry.findStation('Newark')!;
    expect(registry.findLine(station, 'hoboken line')).toBeUndefined();
  });

  it('falls back to the first station (Grove Street) as the default', () => {
    expect(registry.getDefaultStation().id).toBe(DEFAULT_STATIONS[0].id);
    expect(registry.getDefaultStation().id).toBe('path-grove-street');
  });
});
