/**
 * What a host's `robots.txt` says to the catalogue's own programs (ADR-0148
 * decision 2, #2005).
 *
 * A program calling an endpoint its operator documents for scripts is judged
 * on that operator's rules, and the `User-agent: *` group does not decide the
 * call. Two things in the file still bind it:
 * - a group naming the program's own product token (`BOT_PRODUCT_TOKEN`,
 *   what `userAgent({ bot: true })` sends), applied to the path called as
 *   RFC 9309 § 2.2 applies a group;
 * - a usage signal that covers the use the caller makes: Cloudflare's
 *   `Content-Signal` (`ai-input=no`) or the IETF AIPREF drafts'
 *   `Content-Usage` (`ai-use=n`, the most specific line for the path
 *   deciding). It binds only a read made to be handed to a
 *   model, such as an article's lead read for Jev's visit question
 *   (`modelInput`). A signal is about using content, not about reaching it,
 *   so a catalogue read of the same host goes on: the run stores facts (a
 *   name, a number, a coordinate), and a curator's suggestion that offers
 *   Jev two sources' names passes it facts, not the host's text. Every
 *   program here trains nothing, so a refusal of training (`ai-train=no`,
 *   `train-ai=n`) is recorded and refuses nothing.
 *
 * The file is read once per host per run: a run's start forgets what was read
 * (`refreshRobotsForRun`), a read is kept for `CACHE_MS` beyond that, and
 * calls that arrive together share one read. One that cannot be read (a
 * timeout, a server error) does not stop a call to a documented API, since
 * the call is not a crawl; it is asked again after `UNREAD_CACHE_MS`.
 *
 * Every bot client asks `assertRobotsAllow` before it sends a call. The unit
 * lanes set `ROBOTS_CHECK=off`, so a client's spec reads no host's file; a
 * caller that hands the check its own `fetchImpl`, as this module's spec
 * does, is checked all the same.
 */

import { BOT_PRODUCT_TOKEN, userAgent } from '../../config/userAgent.js';

const CACHE_MS = 60 * 60 * 1000;
const UNREAD_CACHE_MS = 5 * 60 * 1000;
const ROBOTS_TIMEOUT_MS = 10000;
const LOG_PREFIX = '[robots]';

interface Rule { allow: boolean; path: string }
/** A usage signal line, with the path it is scoped to where it names one (AIPREF's `Content-Usage: /path …`). */
interface Signal { line: string; field: string; values: string; path: string | null }
/** `closed` once a rule line or a signal follows the agents, an empty `Disallow` included. */
interface Group { agents: string[]; rules: Rule[]; signals: Signal[]; closed: boolean }

/** A host's `robots.txt` as the catalogue's programs read it. */
export interface RobotsFile {
  /** The rules of the group naming `BOT_PRODUCT_TOKEN`, or null where no group names it. */
  ownRules: Rule[] | null;
  /**
   * The usage signals that speak to the catalogue: those outside any group,
   * and those of the group naming `BOT_PRODUCT_TOKEN`, or of the `*` group
   * where none names it (RFC 9309 § 2.2.1).
   */
  signals: Signal[];
}

/** Why a call to a host stops before it is sent. */
export class RobotsRefusal extends Error {
  constructor(readonly host: string, readonly reason: string) {
    super(`${host} refuses this call: ${reason}`);
    this.name = 'RobotsRefusal';
  }
}

/** One line of the file as its field and value, with its comment dropped; null where it has no field. */
function fieldOf(raw: string): { key: string; field: string; value: string } | null {
  const hash = raw.indexOf('#');
  const line = (hash < 0 ? raw : raw.slice(0, hash)).trim();
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const field = line.slice(0, colon).trim();
  return { key: field.toLowerCase(), field, value: line.slice(colon + 1).trim() };
}

/**
 * A path as RFC 9309 § 2.2.2 compares it: a non-ASCII character
 * percent-encoded, an encoded unreserved character decoded, and the rest of
 * the encodings in upper case. Both a rule and the path called are read so.
 */
export function normalizePath(path: string): string {
  return [...path]
    .map(char => (char.codePointAt(0) ?? 0) > 0x7e || char === ' ' ? encodeURIComponent(char) : char)
    .join('')
    .replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => {
      const char = String.fromCharCode(parseInt(hex, 16));
      return /^[A-Za-z0-9._~-]$/.test(char) ? char : `%${hex.toUpperCase()}`;
    });
}

/**
 * The path called, read for matching against a rule. A `*` or `$` in it is
 * a character rather than a wildcard, so it is encoded the way a rule names
 * that character literally (`%2A`, `%24`, RFC 9309 § 2.2.3).
 */
function requestPath(path: string): string {
  return normalizePath(path).replaceAll('*', '%2A').replaceAll('$', '%24');
}

/** A usage signal line, its path read off where it opens with one. */
function signalOf(field: string, value: string): Signal {
  const [first = '', ...rest] = value.split(/\s+/);
  const scoped = field.toLowerCase() === 'content-usage' && first.startsWith('/');
  return {
    line: `${field}: ${value}`, field: field.toLowerCase(),
    values: scoped ? rest.join(' ') : value, path: scoped ? normalizePath(first) : null,
  };
}

/**
 * The group a user-agent line belongs to. One after the current group's rules
 * opens the next group; one before them joins this group, whatever other lines
 * stand between (RFC 9309 § 2.1).
 */
function groupFor(current: Group | null, groups: Group[]): Group {
  if (current && !current.closed) return current;
  const next: Group = { agents: [], rules: [], signals: [], closed: false };
  groups.push(next);
  return next;
}

/**
 * Files one rule or signal line under `current`, or under `unscoped` where no
 * group has opened. Either closes the group's agents, an empty `Disallow`
 * included, though it allows everything and so adds no rule.
 */
function fileLine(line: { key: string; field: string; value: string }, current: Group | null, unscoped: Signal[]): void {
  if (line.key === 'content-signal' || line.key === 'content-usage') {
    if (current) current.closed = true;
    (current ? current.signals : unscoped).push(signalOf(line.field, line.value));
  } else if ((line.key === 'allow' || line.key === 'disallow') && current) {
    current.closed = true;
    if (line.value !== '') current.rules.push({ allow: line.key === 'allow', path: normalizePath(line.value) });
  }
}

/** A `robots.txt` read into the group that addresses the catalogue and the usage signals that speak to it. */
export function parseRobots(text: string): RobotsFile {
  const groups: Group[] = [];
  const unscoped: Signal[] = [];
  let current: Group | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = fieldOf(raw);
    if (!line) continue;
    if (line.key === 'user-agent') {
      current = groupFor(current, groups);
      current.agents.push(line.value.toLowerCase());
    } else {
      fileLine(line, current, unscoped);
    }
  }
  const token = BOT_PRODUCT_TOKEN.toLowerCase();
  const own = groups.filter(group => group.agents.includes(token));
  const addressed = own.length > 0 ? own : groups.filter(group => group.agents.includes('*'));
  return {
    ownRules: own.length > 0 ? own.flatMap(group => group.rules) : null,
    signals: [...unscoped, ...addressed.flatMap(group => group.signals)],
  };
}

/**
 * Whether a rule's path pattern matches `path`, with `*` and a closing `$` as
 * RFC 9309 § 2.2.3 reads them. Matched piece by piece rather than as a
 * regular expression, since the pattern is the host's text.
 */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split('*');
  if (!path.startsWith(pieces[0])) return false;
  let at = pieces[0].length;
  for (let i = 1; i < pieces.length; i++) {
    // The last piece of an anchored pattern has to end the path.
    const found = anchored && i === pieces.length - 1 ? path.lastIndexOf(pieces[i]) : path.indexOf(pieces[i], at);
    if (found < at) return false;
    at = found + pieces[i].length;
  }
  return !anchored || at === path.length;
}

/**
 * Whether `rules` allow `path`: the longest matching rule decides, and an
 * allow wins a tie (RFC 9309 § 2.2.2). No matching rule allows.
 */
export function rulesAllow(rules: Rule[], path: string): boolean {
  const normalized = requestPath(path);
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.path, normalized)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/**
 * The usage signal among `signals` that refuses passing what is read at `path`
 * to a model, or null. A `Content-Signal` refusal speaks for the whole group.
 * `Content-Usage` lines apply as Allow and Disallow rules do: of the lines
 * that match the path and state `ai-use`, the most specific decides, and a
 * permission wins a tie.
 */
export function refusesModelInput(signals: Signal[], path: string): string | null {
  const target = requestPath(path);
  const pairsOf = (signal: Signal) => signal.values.split(/[,;]/).map(pair => pair.replaceAll(' ', '').toLowerCase());
  const refusal = signals.find(signal => signal.field === 'content-signal' && pairsOf(signal).includes('ai-input=no'));
  if (refusal) return refusal.line;
  let decides: { signal: Signal; length: number; refuses: boolean } | null = null;
  for (const signal of signals) {
    if (signal.field !== 'content-usage' || (signal.path && !matches(signal.path, target))) continue;
    const use = pairsOf(signal).find(pair => pair.startsWith('ai-use='));
    if (!use) continue;
    const length = signal.path?.length ?? 0;
    const refuses = use === 'ai-use=n';
    if (!decides || length > decides.length || (length === decides.length && !refuses)) decides = { signal, length, refuses };
  }
  return decides?.refuses ? decides.signal.line : null;
}

interface CachedFile { file: Promise<RobotsFile | null>; at: number; keepMs: number }
const cache = new Map<string, CachedFile>();

/**
 * Forgets every file read, so a run asks each host again before its first
 * call: a rule a host added since the last run binds this one.
 */
export function refreshRobotsForRun(): void {
  cache.clear();
}

async function fetchRobots(origin: string, fetchImpl: typeof fetch): Promise<RobotsFile | null> {
  try {
    const response = await fetchImpl(`${origin}/robots.txt`, {
      headers: { 'User-Agent': userAgent({ bot: true }) },
      signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
      redirect: 'follow',
    });
    // A 4xx is no file (RFC 9309 § 2.3.1.3): nothing addresses the catalogue.
    if (response.status >= 400 && response.status < 500) return { ownRules: null, signals: [] };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const file = parseRobots(await response.text());
    if (file.signals.length > 0) console.log(`${LOG_PREFIX} ${origin} signals: ${file.signals.map(signal => signal.line).join(' | ')}`);
    return file;
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${origin}/robots.txt could not be read, the call goes on: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** The host's file, read once and shared by the calls that arrive while it is read. */
function readRobots(origin: string, fetchImpl: typeof fetch): Promise<RobotsFile | null> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.at < cached.keepMs) return cached.file;
  const entry: CachedFile = { file: Promise.resolve(null), at: Date.now(), keepMs: CACHE_MS };
  // An unread file is asked again soon, so one bad minute of the host's does not stand for an hour.
  entry.file = fetchRobots(origin, fetchImpl).then(file => {
    if (!file) entry.keepMs = UNREAD_CACHE_MS;
    return file;
  });
  cache.set(origin, entry);
  return entry.file;
}

/**
 * Throws `RobotsRefusal` where the host's `robots.txt` refuses this call to
 * the catalogue's own token, or, for a caller that passes what it reads to a
 * model, where a usage signal refuses that.
 */
export async function assertRobotsAllow(
  url: string,
  { modelInput = false, fetchImpl }: { modelInput?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  if (!fetchImpl && process.env.ROBOTS_CHECK === 'off') return;
  const target = new URL(url);
  const file = await readRobots(target.origin, fetchImpl ?? fetch);
  if (!file) return;
  const path = `${target.pathname}${target.search}`;
  if (file.ownRules && !rulesAllow(file.ownRules, path)) {
    throw new RobotsRefusal(target.host, `its robots.txt disallows ${path} to ${BOT_PRODUCT_TOKEN}`);
  }
  const refusal = modelInput ? refusesModelInput(file.signals, path) : null;
  if (refusal) throw new RobotsRefusal(target.host, `its robots.txt says "${refusal}", and what this call reads reaches a model`);
}
