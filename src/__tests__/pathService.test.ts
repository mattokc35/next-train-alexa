import type { RidePathResponse } from '../services/pathService';
import type { ResolvedStation } from '../services/types';

const RIDEPATH_URL = 'https://www.panynj.gov/bin/portauthority/ridepath.json';

// puppeteer-core and @sparticuz/chromium are ESM-only packages that
// pathService.ts loads via a dynamic `import()`. jest.mock() calls are
// hoisted above imports and intercept that dynamic import the same way they
// intercept a plain `require()`, so we mock them here with jest.fn() doubles
// (names must start with "mock" to be usable inside the hoisted factory).
const mockPageSetUserAgent = jest.fn().mockResolvedValue(undefined);
const mockPageGoto = jest.fn().mockResolvedValue(undefined);
const mockPageEvaluate = jest.fn();
const mockPageClose = jest.fn().mockResolvedValue(undefined);
const mockPage = {
  setUserAgent: mockPageSetUserAgent,
  goto: mockPageGoto,
  evaluate: mockPageEvaluate,
  close: mockPageClose,
};
const mockNewPage = jest.fn().mockResolvedValue(mockPage);
const mockBrowserOnce = jest.fn();
const mockLaunch = jest.fn().mockResolvedValue({ newPage: mockNewPage, once: mockBrowserOnce });
const mockDefaultArgs = jest.fn().mockResolvedValue(['--headless-arg']);
const mockExecutablePath = jest.fn().mockResolvedValue('/opt/chromium/chromium');

jest.mock('puppeteer-core', () => ({
  __esModule: true,
  default: { launch: mockLaunch, defaultArgs: mockDefaultArgs },
}));
jest.mock('@sparticuz/chromium', () => ({
  __esModule: true,
  default: { args: ['--chromium-arg'], executablePath: mockExecutablePath },
}));

import { PathService, scrapeRidePathJson } from '../services/pathService';

function buildMessage(
  overrides: Partial<
    RidePathResponse['results'][number]['destinations'][number]['messages'][number]
  > = {},
) {
  return {
    target: 'NY',
    secondsToArrival: '120',
    arrivalTimeMessage: '2 min',
    lineColor: '#FF9900',
    headSign: '33rd Street',
    lastUpdated: String(Date.now()),
    ...overrides,
  };
}

function buildFeed(overrides: Partial<RidePathResponse> = {}): RidePathResponse {
  return {
    results: [
      {
        consideredStation: 'GRV',
        destinations: [
          {
            label: 'ToNY',
            messages: [buildMessage({ headSign: '33rd Street', secondsToArrival: '300' })],
          },
          {
            label: 'ToNJ',
            messages: [buildMessage({ headSign: 'Newark', secondsToArrival: '120' })],
          },
        ],
      },
    ],
    ...overrides,
  };
}

const grove: ResolvedStation = {
  provider: 'PATH',
  displayName: 'Grove Street',
  providerStationId: 'GRV',
};

describe('PathService (business logic via injected fetcher)', () => {
  it('normalizes and sorts upcoming arrivals soonest-first', async () => {
    const fetcher = jest.fn().mockResolvedValue(buildFeed());
    const service = new PathService({ fetcher });

    const arrivals = await service.getNextArrivals(grove);

    expect(arrivals).toHaveLength(2);
    expect(arrivals[0].destination).toBe('Newark');
    expect(arrivals[0].minutesAway).toBeLessThanOrEqual(arrivals[1].minutesAway);
  });

  it('filters by lineHeadSigns when a specific line is requested', async () => {
    const fetcher = jest.fn().mockResolvedValue(buildFeed());
    const service = new PathService({ fetcher });

    const arrivals = await service.getNextArrivals({ ...grove, lineHeadSigns: ['Newark'] });

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].destination).toBe('Newark');
  });

  it('returns no arrivals when the station is absent from the feed', async () => {
    const fetcher = jest.fn().mockResolvedValue(buildFeed());
    const service = new PathService({ fetcher });

    const arrivals = await service.getNextArrivals({ ...grove, providerStationId: 'UNKNOWN' });

    expect(arrivals).toHaveLength(0);
  });

  it('caches the full feed response across repeated requests', async () => {
    const fetcher = jest.fn().mockResolvedValue(buildFeed());
    const service = new PathService({ fetcher, cacheTtlMs: 60_000 });

    await service.getNextArrivals(grove);
    await service.getNextArrivals(grove);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('marks an arrival as delayed when arrivalTimeMessage indicates a delay', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      buildFeed({
        results: [
          {
            consideredStation: 'GRV',
            destinations: [
              { label: 'ToNY', messages: [buildMessage({ arrivalTimeMessage: 'DELAYED' })] },
            ],
          },
        ],
      }),
    );
    const service = new PathService({ fetcher });

    const arrivals = await service.getDelayStatus(grove);

    expect(arrivals[0].status).toBe('delayed');
  });

  it('marks an arrival as alert when the feed data is stale', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      buildFeed({
        results: [
          {
            consideredStation: 'GRV',
            destinations: [
              {
                label: 'ToNY',
                messages: [buildMessage({ lastUpdated: String(Date.now() - 10 * 60_000) })],
              },
            ],
          },
        ],
      }),
    );
    const service = new PathService({ fetcher });

    const arrivals = await service.getDelayStatus(grove);

    expect(arrivals[0].status).toBe('alert');
  });
});

describe('scrapeRidePathJson (mocking puppeteer-core + @sparticuz/chromium)', () => {
  beforeEach(() => {
    mockPageSetUserAgent.mockClear();
    mockPageGoto.mockClear();
    mockPageEvaluate.mockReset();
    mockPageClose.mockClear();
    mockNewPage.mockClear();
    mockLaunch.mockClear();
  });

  it('launches headless Chromium once, navigates to ridepath.json, and parses the response body', async () => {
    const feed = buildFeed();
    mockPageEvaluate.mockResolvedValueOnce(JSON.stringify(feed));

    const result = await scrapeRidePathJson();

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockPageGoto).toHaveBeenCalledWith(
      RIDEPATH_URL,
      expect.objectContaining({ waitUntil: 'networkidle2' }),
    );
    expect(mockPageSetUserAgent).toHaveBeenCalledWith(expect.stringContaining('Chrome'));
    expect(result).toEqual(feed);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
  });

  it('reuses the already-launched browser instance on a subsequent call (warm-invocation reuse)', async () => {
    mockPageEvaluate.mockResolvedValueOnce(JSON.stringify(buildFeed()));

    await scrapeRidePathJson();

    // The browser was already launched by the previous test (module-level
    // singleton, matching the real warm-Lambda-invocation behavior), so a
    // second call should not launch Chromium again.
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(mockNewPage).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when the page body is not valid JSON (Akamai challenge page)', async () => {
    mockPageEvaluate.mockResolvedValueOnce('<html><body>Access Denied</body></html>');

    await expect(scrapeRidePathJson()).rejects.toThrow(/Akamai/);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
  });
});
