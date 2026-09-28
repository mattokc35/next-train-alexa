import nodeFetch from 'node-fetch';

/**
 * Minimal response shape both adapters rely on. Deliberately narrow (rather
 * than the full `node-fetch`/DOM `Response` type) so tests can supply plain
 * mock objects without fighting ambient `fetch` typings.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  buffer(): Promise<Buffer>;
}

export type HttpFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

/** Default HTTP client backed by `node-fetch`. */
export const defaultFetch: HttpFetch = (url, init) =>
  nodeFetch(url, init) as unknown as Promise<HttpResponse>;
