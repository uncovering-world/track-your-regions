/**
 * Whether an official website still answers, for the curator looking at the card
 * that shows it (#2165).
 *
 * The review queue holds cards whose change is a new official website, and some
 * of those sites are gone: Villa d'Este's proposed domain does not resolve, the
 * Sacred City of Caral-Supe's page answers 404, Santa Chiara's answers 200 with a
 * domain for sale. The check says which, in three outcomes:
 *
 * - `answers`: the final page answered 2xx or 3xx;
 * - `dead`: the domain does not resolve, the connection is refused, the final page
 *   answers 404 or 410, or a hop lands on a domain-parking host;
 * - `unclear`: anything else (401, 403, 429, a timeout, a TLS failure, a 5xx, an
 *   address that is not public). It says nothing about what a person's browser
 *   would see, so it is never read as dead.
 *
 * The fetch is the backend's, on a curator's click, to a host a source named, so
 * it is held to what a request forgery would need:
 *
 * - only `http` and `https`, on the ports a website uses;
 * - every hop's name resolved and its addresses checked (`isPublicAddress`), and
 *   the connection made to the address checked (`guardedLookup`), at each of at
 *   most `MAX_REDIRECTS` redirects;
 * - `HEAD` first, and `GET` where the site answers `HEAD` with an error;
 * - the connection closed once the status and headers arrive, so no body is read,
 *   stored or parsed, whatever the address serves;
 * - no cookie, no `Referer`, nothing of the curator's session, and the header
 *   `linkCheckUserAgent` builds.
 *
 * An outcome is kept in memory for a day per address (`CACHE_TTL_MS`), so a card
 * opened again, or two cards sharing a site, do not fetch it twice.
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { linkCheckUserAgent } from '../../config/userAgent.js';
import { isHttpsUrl, isStorableHttpUrl } from '../../types/urlSafety.js';
import { isPublicAddress } from './publicAddress.js';

export const WEBSITE_OUTCOMES = ['answers', 'dead', 'unclear'] as const;
export type WebsiteOutcome = (typeof WEBSITE_OUTCOMES)[number];

/** Why, in a word the card turns into a sentence: the one `answers` has, the dead ones, then the unclear ones. */
export const WEBSITE_REASONS = [
  'answered',
  'domain-not-found', 'connection-refused', 'page-not-found', 'page-gone', 'domain-parked',
  'refused-by-site', 'unexpected-answer', 'server-error', 'timed-out', 'tls-failure',
  'not-public', 'too-many-redirects', 'not-checkable', 'failed',
] as const;
export type WebsiteReason = (typeof WEBSITE_REASONS)[number];

export interface WebsiteCheck {
  outcome: WebsiteOutcome;
  reason: WebsiteReason;
  /** The final page's status, where one answered. */
  status: number | null;
  checkedAt: string;
}

/** More than a site's usual one or two, fewer than a loop would take. */
export const MAX_REDIRECTS = 5;
/** For the whole chain, every hop included: the card waits on it. */
const DEADLINE_MS = 10_000;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Enough for a day of cards; the oldest goes first past it. */
const CACHE_LIMIT = 5_000;
/** The ports a website is served on: the scheme's own, and the two alternatives sites use. */
const PORTS = new Set(['', '80', '443', '8080', '8443']);

/**
 * Hosts that serve a page offering a domain for sale or parking it. A hop that
 * lands on one is a site that is gone, whatever status it answers: Santa
 * Chiara's `monasterodisantachiara.com` redirects to `hugedomains.com` and
 * answers 200 there (measured 2026-10-30). The others are the marketplaces and
 * parking services that publish themselves as such.
 */
const PARKING_HOSTS = ['hugedomains.com', 'sedo.com', 'sedoparking.com', 'dan.com', 'afternic.com', 'bodis.com', 'parkingcrew.net'];

function isParkingHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return PARKING_HOSTS.some(parking => host === parking || host.endsWith(`.${parking}`));
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type Lookup = (hostname: string, options: { all?: boolean }, callback: LookupCallback) => void;

interface CheckerDeps {
  /** Resolves a name to every address it has; the system resolver unless a test names another. */
  resolve?: (hostname: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
  /** Whether an address may be connected to; `isPublicAddress` unless a test names another. */
  isPublic?: (address: string) => boolean;
  deadlineMs?: number;
  now?: () => number;
  /** The ports a website address may name; `PORTS` unless a test serves on another. */
  ports?: ReadonlySet<string>;
}

class NotPublic extends Error {
  code = 'ENOTPUBLIC';
}

/**
 * A `lookup` for `http.request` that resolves the name, refuses it when any
 * address is not public, and hands the connection the addresses it checked.
 * Every address, not the first: a name answering a public and a private address
 * would otherwise reach the private one on a retry.
 */
function guardedLookup(resolve: NonNullable<CheckerDeps['resolve']>, isPublic: (address: string) => boolean): Lookup {
  return (hostname, options, callback) => {
    resolve(hostname, (error, addresses) => {
      if (error) return callback(error, []);
      if (addresses.length === 0 || addresses.some(entry => !isPublic(entry.address))) {
        return callback(new NotPublic(`${hostname} resolves to an address that is not public`), []);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const systemResolve: NonNullable<CheckerDeps['resolve']> = (hostname, callback) =>
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => callback(error, addresses ?? []));

/** One request's status and `Location`; the response is destroyed as soon as they arrive. */
function statusOf(url: URL, method: 'HEAD' | 'GET', lookup: Lookup, signal: AbortSignal): Promise<{ status: number; location: string | null }> {
  const transport = isHttpsUrl(url) ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method,
      // Nothing of the curator's request travels: no cookie, no Referer, no
      // Authorization, only what any link checker sends.
      headers: { 'User-Agent': linkCheckUserAgent(), Accept: '*/*' },
      lookup: lookup as unknown as http.RequestOptions['lookup'],
      agent: false,
      signal,
    }, response => {
      const location = response.headers.location ?? null;
      const status = response.statusCode ?? 0;
      // Closed before any byte of the body is read.
      response.destroy();
      request.destroy();
      resolve({ status, location });
    });
    request.on('error', reject);
    request.end();
  });
}

const TLS_CODE = /^(ERR_TLS|ERR_SSL|CERT_|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|EPROTO$|HOSTNAME_MISMATCH|ERR_TLS_CERT)/;

/** What a failed request says about the site. */
function fromError(error: unknown): Pick<WebsiteCheck, 'outcome' | 'reason'> {
  const code = (error as NodeJS.ErrnoException)?.code ?? (error as Error)?.name ?? '';
  if (code === 'ENOTPUBLIC') return { outcome: 'unclear', reason: 'not-public' };
  if (code === 'ENOTFOUND' || code === 'ENODATA') return { outcome: 'dead', reason: 'domain-not-found' };
  if (code === 'ECONNREFUSED') return { outcome: 'dead', reason: 'connection-refused' };
  if (code === 'AbortError' || code === 'ABORT_ERR' || code === 'ETIMEDOUT') return { outcome: 'unclear', reason: 'timed-out' };
  if (TLS_CODE.test(code)) return { outcome: 'unclear', reason: 'tls-failure' };
  return { outcome: 'unclear', reason: 'failed' };
}

/** What the final page's status says about the site. */
function fromStatus(status: number): Pick<WebsiteCheck, 'outcome' | 'reason'> {
  if (status >= 200 && status < 400) return { outcome: 'answers', reason: 'answered' };
  if (status === 404) return { outcome: 'dead', reason: 'page-not-found' };
  if (status === 410) return { outcome: 'dead', reason: 'page-gone' };
  if (status === 401 || status === 403 || status === 429) return { outcome: 'unclear', reason: 'refused-by-site' };
  if (status >= 500) return { outcome: 'unclear', reason: 'server-error' };
  return { outcome: 'unclear', reason: 'unexpected-answer' };
}

/** The address to request, or null when it is no website address the check may call. */
function checkable(value: string, ports: ReadonlySet<string>, base?: URL): URL | null {
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (!isStorableHttpUrl(url.href) || url.username || url.password || !ports.has(url.port)) return null;
  return url;
}

export function createWebsiteChecker(deps: CheckerDeps = {}): (value: string) => Promise<WebsiteCheck> {
  const isPublic = deps.isPublic ?? isPublicAddress;
  const lookup = guardedLookup(deps.resolve ?? systemResolve, isPublic);
  const now = deps.now ?? Date.now;
  const ports = deps.ports ?? PORTS;
  const cache = new Map<string, { check: WebsiteCheck; expires: number }>();
  const running = new Map<string, Promise<WebsiteCheck>>();

  async function run(value: string): Promise<WebsiteCheck> {
    const done = (part: Pick<WebsiteCheck, 'outcome' | 'reason'>, status: number | null = null): WebsiteCheck =>
      ({ ...part, status, checkedAt: new Date(now()).toISOString() });
    let url = checkable(value, ports);
    if (!url) return done({ outcome: 'unclear', reason: 'not-checkable' });
    const signal = AbortSignal.timeout(deps.deadlineMs ?? DEADLINE_MS);
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (isParkingHost(url.hostname)) return done({ outcome: 'dead', reason: 'domain-parked' });
        // A literal address is never looked up, so the rule is applied to it here.
        const literal = url.hostname.replace(/^\[|\]$/g, '');
        if (isIP(literal) !== 0 && !isPublic(literal)) return done({ outcome: 'unclear', reason: 'not-public' });
        let answer = await statusOf(url, 'HEAD', lookup, signal);
        if (answer.status >= 400) answer = await statusOf(url, 'GET', lookup, signal);
        if (answer.status < 300 || answer.status >= 400 || !answer.location) return done(fromStatus(answer.status), answer.status);
        const next = checkable(answer.location, ports, url);
        if (!next) return done({ outcome: 'unclear', reason: 'not-checkable' });
        url = next;
      }
      return done({ outcome: 'unclear', reason: 'too-many-redirects' });
    } catch (error) {
      return done(fromError(error));
    }
  }

  return async function check(value: string): Promise<WebsiteCheck> {
    const kept = cache.get(value);
    if (kept && kept.expires > now()) return kept.check;
    const inFlight = running.get(value);
    if (inFlight) return inFlight;
    const pending = run(value).then(result => {
      cache.delete(value);
      cache.set(value, { check: result, expires: now() + CACHE_TTL_MS });
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      return result;
    }).finally(() => running.delete(value));
    running.set(value, pending);
    return pending;
  };
}

/** The check the endpoint uses, with the system resolver and the public-address rule. */
export const checkWebsite = createWebsiteChecker();
