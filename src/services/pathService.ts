import type { Browser } from 'puppeteer-core' with { 'resolution-mode': 'import' };
import { TtlCache } from './cache';
import type { ResolvedStation, TrainArrival, TransitService } from './types';

const RIDEPATH_URL = 'https://www.panynj.gov/bin/portauthority/ridepath.json';

// A realistic desktop Chrome UA. The official PATH endpoint sits behind an
// Akamai bot-check that returns an empty 200 response to plain HTTP clients
// (curl, node-fetch, etc.) — it only serves the real JSON to a browser-like
// client that renders the page. See scrapeRidePathJson() below.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAVIGATION_TIMEOUT_MS = 15_000;
const CACHE_KEY = 'ridepath.json';
const DEFAULT_CACHE_TTL_MS = 30_000;

// @sparticuz/chromium no longer ships a `defaultViewport` (removed upstream);
// a standard desktop viewport works fine for a JSON-only endpoint like this.
const DEFAULT_VIEWPORT = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  isLandscape: true,
};

/** Single upcoming train entry in the official PATH ridepath.json feed. */
interface RidePathMessage {
  target: string;
  secondsToArrival: string;
  arrivalTimeMessage: string;
  lineColor: string;
  headSign: string;
  lastUpdated: string;
}

interface RidePathDestination {
  label: 'ToNY' | 'ToNJ' | string;
  messages: RidePathMessage[];
}

interface RidePathResult {
  consideredStation: string;
  destinations: RidePathDestination[];
}

export interface RidePathResponse {
  results: RidePathResult[];
}

/**
 * A function that fetches and parses the ridepath.json feed. The default
 * implementation (`scrapeRidePathJson`) launches headless Chromium; tests
 * can inject a stub here to avoid the browser entirely.
 */
export type RidePathFetcher = () => Promise<RidePathResponse>;

// puppeteer-core and @sparticuz/chromium both publish as ESM-only packages
// (no CommonJS entry point), while the rest of this project compiles to
// CommonJS. A static `import` of either package would downlevel to a
// `require()` call and crash at runtime with ERR_REQUIRE_ESM, so we load
// them lazily via a genuine dynamic `import()` (preserved as-is by
// TypeScript's Node16/NodeNext module modes) and cache the resolved module.
type PuppeteerModule = typeof import('puppeteer-core', { with: { 'resolution-mode': 'import' } });
type ChromiumModule = typeof import('@sparticuz/chromium', {
  with: { 'resolution-mode': 'import' },
});

let puppeteerModulePromise: Promise<PuppeteerModule> | null = null;
let chromiumModulePromise: Promise<ChromiumModule> | null = null;

async function loadPuppeteer(): Promise<PuppeteerModule> {
  if (!puppeteerModulePromise) {
    puppeteerModulePromise = import('puppeteer-core');
  }
  return puppeteerModulePromise;
}

async function loadChromium(): Promise<ChromiumModule> {
  if (!chromiumModulePromise) {
    chromiumModulePromise = import('@sparticuz/chromium');
  }
  return chromiumModulePromise;
}

// Reused across warm Lambda invocations — launching headless Chromium per
// request would add several seconds of cold-start-like latency to every
// call, so we keep a single browser instance alive in the module scope for
// as long as the execution environment stays warm.
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await loadPuppeteer()).default;
  const chromium = (await loadChromium()).default;

  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    defaultViewport: DEFAULT_VIEWPORT,
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
  browser.once('disconnected', () => {
    browserPromise = null;
  });
  return browser as Browser;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

/**
 * Navigates a headless Chromium instance to the official PATH ridepath.json
 * endpoint and extracts the raw JSON body. This is necessary because the
 * endpoint is protected by an Akamai bot-check that silently returns an
 * empty 200 response to non-browser HTTP clients (verified: plain curl /
 * node-fetch requests get nothing back, while a real Chrome instance
 * navigating to the URL and waiting for the network to settle successfully
 * retrieves the JSON). Port Authority could change this behavior at any
 * time without notice.
 */
export async function scrapeRidePathJson(): Promise<RidePathResponse> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.goto(RIDEPATH_URL, {
      waitUntil: 'networkidle2',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const text = await page.evaluate(() => document.body.innerText);
    try {
      return JSON.parse(text) as RidePathResponse;
    } catch {
      throw new Error(
        'Failed to parse the PATH ridepath.json response as JSON — the page likely returned an ' +
          'Akamai bot-check challenge instead of the expected feed.',
      );
    }
  } finally {
    await page.close();
  }
}

/**
 * Adapter for the PATH train system, backed by the official
 * ridepath.json feed (https://www.panynj.gov/bin/portauthority/ridepath.json),
 * scraped via headless Chromium to bypass Akamai's bot protection.
 */
export class PathService implements TransitService {
  readonly provider = 'PATH' as const;

  private readonly fetcher: RidePathFetcher;
  private readonly cache: TtlCache<RidePathResponse>;

  constructor(options: { fetcher?: RidePathFetcher; cacheTtlMs?: number } = {}) {
    this.fetcher = options.fetcher ?? scrapeRidePathJson;
    this.cache = new TtlCache(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  }

  async getNextArrivals(station: ResolvedStation): Promise<TrainArrival[]> {
    const messages = await this.getStationMessages(station);
    return messages
      .map((m) => this.toTrainArrival(station, m))
      .sort((a, b) => a.minutesAway - b.minutesAway);
  }

  async getDelayStatus(station: ResolvedStation): Promise<TrainArrival[]> {
    // The official feed has no distinct alerts/delay endpoint either; we
    // derive a best-effort status per-arrival the same way as arrivals.
    return this.getNextArrivals(station);
  }

  private async getStationMessages(station: ResolvedStation): Promise<RidePathMessage[]> {
    const response = await this.cache.getOrCompute(CACHE_KEY, () => this.fetcher());
    const result = response.results.find((r) => r.consideredStation === station.providerStationId);
    if (!result) {
      return [];
    }

    const allMessages = result.destinations.flatMap((d) => d.messages);
    if (!station.lineHeadSigns || station.lineHeadSigns.length === 0) {
      return allMessages;
    }

    const wanted = new Set(station.lineHeadSigns.map((h) => h.toLowerCase()));
    return allMessages.filter((m) => wanted.has(m.headSign.toLowerCase()));
  }

  private toTrainArrival(station: ResolvedStation, message: RidePathMessage): TrainArrival {
    const seconds = Number(message.secondsToArrival);
    const minutesAway = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds / 60)) : 0;
    const lastUpdatedMs = Number(message.lastUpdated);
    const staleMs = Number.isFinite(lastUpdatedMs) ? Date.now() - lastUpdatedMs : 0;
    const status = this.deriveStatus(message, staleMs);

    return {
      provider: 'PATH',
      stationName: station.displayName,
      lineName: station.lineDisplayName ?? message.headSign,
      destination: message.headSign,
      minutesAway,
      status,
      statusDetail:
        status === 'alert' ? 'Real-time data may be stale; check PATH alerts.' : undefined,
    };
  }

  private deriveStatus(message: RidePathMessage, staleMs: number): TrainArrival['status'] {
    if (message.arrivalTimeMessage?.toUpperCase().includes('DELAY')) {
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
