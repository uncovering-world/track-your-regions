/**
 * The pipeline's door to a dump host (ADR-0101 decision 4), within the host's
 * rules: `dumps.wikimedia.org` rate-limits, caps a client at 3 connections and
 * enforces the Wikimedia User-Agent policy; `planet.openstreetmap.org` asks for
 * HTTPS and keeps agents off its listings (ADR-0134). Every request carries the project's
 * bot `userAgent()`, and at most `HOST_CONNECTIONS` are open to one host from
 * this process at a time (eight to the planet's, `CONNECTIONS_OF`); a read opens one, and a download into the local copy
 * up to all of them (`rangedDownload.ts`). A request is never retried here: a
 * failed one fails the read. A build cut by the network is started again a
 * bounded number of times by the build itself, after growing pauses, and
 * resumes from what its local copies hold (`hostFailure` says which failures
 * are the host's, `RETRY_PAUSES_MS` in `buildRun.ts` how often, #2419); a
 * host's refusal is never retried.
 */

import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { userAgent } from '../../config/userAgent.js';
import { NotOnHost } from './catalog.js';
import { downloadRanges, RangeEndedEarly } from './rangedDownload.js';
import { assertRobotsAllow } from '../robots/robotsSignals.js';

/** A host answered a request with an error status: `status` tells a refusal (4xx) from a host in trouble (5xx). */
export class HostAnswered extends Error {
  constructor(readonly url: string, readonly status: number, detail = '') {
    super(`${url} answered ${status}${detail}`);
  }
}

/** The codes a connection that never opened carries: the host's name did not resolve, or nothing answered. */
const UNREACHABLE = new Set(['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
/** The codes a connection cut once open carries: closed or reset by the other side, or silent too long. */
const CLOSED = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
/** A host's answers that say it is in trouble for now, not that it refuses the request. */
const HOST_TROUBLE = new Set([502, 503, 504]);

/** What a network failure was: the host could not be reached, it cut a connection, or it said it is in trouble. */
export type NetworkFailure = 'unreachable' | 'closed' | 'host-trouble';

/**
 * Whether `error` is the network's, not the file's or the request's: a name
 * that did not resolve, a connection refused, closed or reset, a range the
 * host ended early, or a 502–504. Each is worth asking again later; a 4xx, a
 * damaged file or a cancel never is. undici reports a closed socket as a
 * `TypeError: terminated` whose cause carries the code, so the causes are read
 * too.
 */
export function networkFailure(error: unknown): NetworkFailure | null {
  for (let at: unknown = error, depth = 0; at && depth < 5; at = (at as { cause?: unknown }).cause, depth += 1) {
    const failure = failureOf(at);
    if (failure !== undefined) return failure;
  }
  return null;
}

/**
 * The failure of a request to a dump host, where `error` is one: a request the
 * network failed (`RequestFailed`), a range the host ended early, or a 502 to
 * 504. Only these are a build's to try again (#2419); a database connection a
 * build's own writes lost carries the same codes and is not the host's.
 */
export function hostFailure(error: unknown): NetworkFailure | null {
  for (let at: unknown = error, depth = 0; at && depth < 5; at = (at as { cause?: unknown }).cause, depth += 1) {
    if (at instanceof RequestFailed || at instanceof HostAnswered || at instanceof RangeEndedEarly) return failureOf(at) ?? null;
  }
  return null;
}

/** What one error in a chain of causes says: a failure, none (a refusal), or nothing yet (undefined: read its cause). */
function failureOf(at: object): NetworkFailure | null | undefined {
  if (at instanceof HostAnswered) return HOST_TROUBLE.has(at.status) ? 'host-trouble' : null;
  if (at instanceof RequestFailed) return at.failure;
  const code = String((at as NodeJS.ErrnoException).code ?? '');
  if (UNREACHABLE.has(code)) return 'unreachable';
  if (CLOSED.has(code) || at instanceof RangeEndedEarly) return 'closed';
  if (at instanceof TypeError && /^(terminated|fetch failed)$/.test(at.message) && !(at as { cause?: unknown }).cause) return 'closed';
  return undefined;
}

/**
 * A request the network failed before the host answered (#2419): its host in
 * words, the failure kept as the cause, which `networkFailure` reads.
 */
export class RequestFailed extends Error {
  constructor(readonly url: string, readonly failure: NetworkFailure, cause: unknown) {
    const host = new URL(url).host;
    super(failure === 'unreachable' ? `${host} could not be reached` : `The connection to ${host} was closed before it answered`, { cause });
  }
}

/** The connections a host is held to: Wikimedia's three, unless the host says otherwise. */
const HOST_CONNECTIONS = 3;
/**
 * Hosts that allow more. The OpenStreetMap planet is served from the OSM
 * Foundation's S3 bucket, whose bandwidth the OSM wiki calls unlimited; three
 * connections fetched the first planet at about 14 MB/s (2026-10-22).
 */
const CONNECTIONS_OF: Readonly<Record<string, number>> = { 'planet.openstreetmap.org': 8 };
const connectionsOf = (host: string) => CONNECTIONS_OF[host] ?? HOST_CONNECTIONS;
const USER_AGENT = userAgent({ bot: true, purpose: 'public dump builds' });
const open = new Map<string, number>();
const waiting = new Map<string, Array<() => void>>();

/** Wait for a slot of `host`; a cancel stops the wait instead of leaving it queued behind a long read. */
function slot(host: string, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      waiting.set(host, (waiting.get(host) ?? []).filter(next => next !== wake));
      reject(signal?.reason);
    };
    function wake() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    waiting.set(host, [...(waiting.get(host) ?? []), wake]);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Hold one of the host's connections until `release` is called. */
async function connection(url: string, signal?: AbortSignal): Promise<() => void> {
  const host = new URL(url).host;
  while ((open.get(host) ?? 0) >= connectionsOf(host)) {
    signal?.throwIfAborted();
    await slot(host, signal);
  }
  open.set(host, (open.get(host) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    open.set(host, (open.get(host) ?? 1) - 1);
    const next = waiting.get(host)?.shift();
    next?.();
  };
}

/**
 * One request to a dump host, asked of the host's `robots.txt` first. A
 * redirect is followed without a second check: the hosts redirect to the file
 * they hand out (the planet's S3 bucket), never to another publisher.
 * `timeoutMs`, where given, bounds the request once it holds a connection, the
 * body's read included, and never the wait for one: a check queued behind a
 * build's hours-long download has not been answered late, it has not asked
 * yet (#2353).
 */
async function request(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<{ response: Response; release: () => void }> {
  await assertRobotsAllow(url);
  const release = await connection(url, init.signal ?? undefined);
  try {
    const signals = [init.signal, timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs)]
      .filter((signal): signal is AbortSignal => !!signal);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const response = await fetch(url, { ...init, signal, headers: { ...init.headers, 'User-Agent': USER_AGENT }, redirect: 'follow' });
    return { response, release };
  } catch (error) {
    release();
    const failure = init.signal?.aborted ? null : networkFailure(error);
    throw failure ? new RequestFailed(url, failure, error) : error;
  }
}

/** A host's page as text: a listing, a checksum file, a status file; `timeoutMs` as `request` takes it. */
export async function fetchText(url: string, signal?: AbortSignal, timeoutMs?: number): Promise<string> {
  const { response, release } = await request(url, { signal }, timeoutMs);
  try {
    if (response.status === 404) throw new NotOnHost(`${url} answered 404`);
    if (!response.ok) throw new HostAnswered(url, response.status);
    return await response.text().catch((error: unknown) => {
      const failure = signal?.aborted ? null : networkFailure(error);
      throw failure ? new RequestFailed(url, failure, error) : error;
    });
  } finally {
    release();
  }
}

/** The size the host answers for a file, or null where it has none; `timeoutMs` as `request` takes it. */
export async function sizeOf(url: string, signal?: AbortSignal, timeoutMs?: number): Promise<number | null> {
  const { response, release } = await request(url, { method: 'HEAD', signal }, timeoutMs);
  release();
  if (!response.ok) return null;
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : null;
}

/** The `Range` header for the bytes from `from` on, up to `to` inclusive where one is given. */
function rangeHeader(from: number, to?: number): Record<string, string> {
  if (to !== undefined) return { Range: `bytes=${from}-${to}` };
  return from > 0 ? { Range: `bytes=${from}-` } : {};
}

/**
 * The file's bytes from `from` on (up to `to` inclusive, where given), as a
 * Node stream. The host's connection is held until the stream ends or is
 * destroyed.
 */
export async function openStream(url: string, signal: AbortSignal, from = 0, to?: number): Promise<Readable> {
  const { response, release } = await request(url, { signal, headers: rangeHeader(from, to) });
  // A copy already at full size asks for a range past the end, which a host
  // answers with 416 where it named no size to compare with: the copy is whole
  // as far as the host can say, and the checksum decides.
  if (from > 0 && response.status === 416) {
    release();
    return Readable.from([]);
  }
  if (!(response.ok || response.status === 206) || !response.body) {
    release();
    throw new HostAnswered(url, response.status);
  }
  if ((from > 0 || to !== undefined) && response.status !== 206) {
    release();
    throw new Error(`${url} does not resume a download (answered ${response.status} to a range)`);
  }
  const stream = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  stream.once('close', release);
  return stream;
}

/**
 * Bring a local copy to the host's full size, resuming from what is already
 * on disk: a cut download picks up where it stopped instead of starting a
 * 100 GB file again. Where the host names the size, the rest is fetched over
 * every connection the host allows (`downloadRanges`); where it does not, in
 * order over one. Answers the copy's size.
 */
export async function downloadTo(url: string, path: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<number> {
  const have = await stat(path).then(s => s.size).catch(() => 0);
  const expected = await sizeOf(url, signal);
  if (expected !== null && have === expected) return have;
  if (expected !== null && have > expected) throw new Error(`${path} is larger than the host's file; delete it and build again`);
  if (expected !== null) {
    return downloadRanges({
      url, path, expected, have, signal, onBytes, connections: connectionsOf(new URL(url).host),
      openRange: (rangeSignal, from, to) => openStream(url, rangeSignal, from, to),
    });
  }
  const source = await openStream(url, signal, have);
  source.on('data', (chunk: Buffer) => onBytes(chunk.length));
  await pipeline(source, createWriteStream(path, { flags: have > 0 ? 'a' : 'w' }), { signal });
  return (await stat(path)).size;
}
