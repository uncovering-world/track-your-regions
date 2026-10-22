/**
 * The pipeline's door to a dump host (ADR-0101 decision 4), within the host's
 * rules: `dumps.wikimedia.org` rate-limits, caps a client at 3 connections and
 * enforces the Wikimedia User-Agent policy; `planet.openstreetmap.org` asks for
 * HTTPS and keeps agents off its listings (ADR-0134). Every request carries the project's
 * bot `userAgent()`, and at most `HOST_CONNECTIONS` are open to one host from
 * this process at a time; a read opens one, and a download into the local copy
 * up to all of them (`rangedDownload.ts`). Nothing retries in a loop:
 * a failed request fails the build, and the admin starts it again.
 */

import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { userAgent } from '../../config/userAgent.js';
import { NotOnHost } from './catalog.js';
import { downloadRanges } from './rangedDownload.js';

const HOST_CONNECTIONS = 3;
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
  while ((open.get(host) ?? 0) >= HOST_CONNECTIONS) {
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

async function request(url: string, init: RequestInit = {}): Promise<{ response: Response; release: () => void }> {
  const release = await connection(url, init.signal ?? undefined);
  try {
    const response = await fetch(url, { ...init, headers: { ...init.headers, 'User-Agent': USER_AGENT }, redirect: 'follow' });
    return { response, release };
  } catch (error) {
    release();
    throw error;
  }
}

/** A host's page as text: a listing, a checksum file, a status file. */
export async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const { response, release } = await request(url, { signal });
  try {
    if (response.status === 404) throw new NotOnHost(`${url} answered 404`);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return await response.text();
  } finally {
    release();
  }
}

/** The size the host answers for a file, or null where it has none. */
export async function sizeOf(url: string, signal?: AbortSignal): Promise<number | null> {
  const { response, release } = await request(url, { method: 'HEAD', signal });
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
    throw new Error(`${url} answered ${response.status}`);
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
      url, path, expected, have, signal, onBytes, connections: HOST_CONNECTIONS,
      openRange: (rangeSignal, from, to) => openStream(url, rangeSignal, from, to),
    });
  }
  const source = await openStream(url, signal, have);
  source.on('data', (chunk: Buffer) => onBytes(chunk.length));
  await pipeline(source, createWriteStream(path, { flags: have > 0 ? 'a' : 'w' }), { signal });
  return (await stat(path)).size;
}
