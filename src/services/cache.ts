/**
 * A minimal in-memory TTL cache used to avoid hammering the PATH and MTA
 * upstream APIs on every Alexa request. Not shared across Lambda invocations
 * unless the execution environment is reused (a warm container), which is
 * sufficient to smooth out bursts of requests within a short window.
 */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * Fetch a cached value, or compute and cache it via `factory` on a miss.
   */
  async getOrCompute(key: string, factory: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const value = await factory();
    this.set(key, value);
    return value;
  }

  clear(): void {
    this.store.clear();
  }
}
