/**
 * The one grammar for the app's addresses (#644, ADR-0034).
 *
 *   /                                       map, default world view
 *   /wv/5                                   map, world view 5
 *   /wv/5/r/6737-europe                     map, region 6737 selected
 *   /wv/5/r/6737-europe/e/1234-stonehenge   map, card 1234 open in the explore panel
 *   /discover[/wv/5[/r/7120-france[/e/9]]][?kind=1]
 *
 * What names a resource — the world view, the region, the open card — is a
 * path segment, because it must survive being pasted into another browser.
 * View state a visitor set deliberately is a query parameter; today that is
 * Discover's kind alone. Ids decide and slugs decorate: a segment is digits
 * followed by `-` or its end, and whatever follows that `-` is ignored — so a
 * renamed region keeps every link that was ever shared, and `useAppAddress`
 * rewrites the slug in place once the name is known. Deliberately stricter than
 * a bare `parseInt`, which would read `6737europe` as 6737 and accept a segment
 * nothing here ever wrote; see `readId`.
 *
 * Parsing and building live here together, with a round-trip test, so a
 * parameter cannot be added in one direction only.
 *
 * `parseReviewUrl`/`buildReviewUrl`, further down, are a sibling grammar for
 * `/review` — a page that is not a place (`review` is in `NOT_A_PLACE`, so
 * `parseAppUrl` answers null for it) but whose list state is still an address,
 * per ADR-0051 decision 5.
 */

export type AppMode = 'map' | 'discover';

export interface AppAddress {
  mode: AppMode;
  /** `null` is the default world view, which writes no segment. */
  worldViewId: number | null;
  regionId: number | null;
  /** Only meaningful under a region; dropped by `buildAppUrl` without one. */
  experienceId: number | null;
  /** Discover's open kind list; ignored on the map. */
  kindId: number | null;
}

/** Route prefixes that are pages of their own, not places on the map. */
const NOT_A_PLACE = ['account', 'admin', 'review', 'auth', 'verify-email'];

const SLUG_MAX = 60;

/**
 * A positive integer, or null. Segments and parameters are untrusted text:
 * `parseInt('12abc')` would read 12, and a leading slug like `europe-6737` must
 * not read as anything at all.
 */
function readId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = /^(\d+)(?:-|$)/.exec(raw);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Lowercase ASCII from a name, or '' where there is none to be had. */
export function slugify(name: string): string {
  const slug = trimDashes(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  );
  return slug.length <= SLUG_MAX ? slug : trimDashes(slug.slice(0, SLUG_MAX));
}

/** A loop rather than `/^-+|-+$/`, which the lint reads as super-linear. */
function trimDashes(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '-') start += 1;
  while (end > start && text[end - 1] === '-') end -= 1;
  return text.slice(start, end);
}

/**
 * Reads an address, or `null` for a page that is not a place. A segment that
 * does not parse ends the reading there — everything after it is absent, never
 * guessed — and the caller's canonical rewrite tidies the address bar.
 */
export function parseAppUrl(pathname: string, search: string): AppAddress | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length > 0 && NOT_A_PLACE.includes(segments[0])) return null;

  const params = new URLSearchParams(search);
  let i = 0;
  const mode: AppMode = segments[0] === 'discover' ? 'discover' : 'map';
  if (mode === 'discover') i += 1;

  let worldViewId: number | null = null;
  let regionId: number | null = null;
  let experienceId: number | null = null;

  if (segments[i] === 'wv') {
    worldViewId = readId(segments[i + 1]);
    i += 2;
  } else {
    // The form every link carried before the path did (#644): honoured on the
    // way in, and rewritten by `legacyRedirect` on the way out.
    worldViewId = readId(params.get('wv'));
  }

  if (worldViewId !== null && segments[i] === 'r') {
    regionId = readId(segments[i + 1]);
    i += 2;
    if (regionId !== null && segments[i] === 'e') {
      experienceId = readId(segments[i + 1]);
    }
  }

  // `cat` is the parameter's spelling until #819; a link shared before it still opens the list.
  const kindId = mode === 'discover' && regionId !== null
    ? readId(params.get('kind') ?? params.get('cat'))
    : null;

  return { mode, worldViewId, regionId, experienceId, kindId };
}

/**
 * Writes an address. Names are optional decoration: given, they hang a slug on
 * the id; withheld or slugging to nothing, the id stands alone.
 */
export function buildAppUrl(
  address: AppAddress,
  names?: { region?: string | null; experience?: string | null },
): string {
  const parts: string[] = [];
  if (address.mode === 'discover') parts.push('discover');

  let regionId: number | null = null;
  if (address.worldViewId !== null) {
    parts.push('wv', String(address.worldViewId));
    if (address.regionId !== null) {
      regionId = address.regionId;
      parts.push('r', withSlug(address.regionId, names?.region));
      if (address.experienceId !== null) {
        parts.push('e', withSlug(address.experienceId, names?.experience));
      }
    }
  }

  const path = `/${parts.join('/')}`;
  const query = address.mode === 'discover' && regionId !== null && address.kindId !== null
    ? `?kind=${address.kindId}`
    : '';
  return `${path}${query}`;
}

function withSlug(id: number, name: string | null | undefined): string {
  const slug = name ? slugify(name) : '';
  return slug ? `${id}-${slug}` : String(id);
}

/**
 * The slugs an address carries, '' where a segment has none. What `go` reads
 * so that a write naming only the card does not strip the region's slug.
 */
export function slugsOf(pathname: string): { region: string; experience: string } {
  const segments = pathname.split('/').filter(Boolean);
  const after = (key: string): string => {
    const at = segments.indexOf(key);
    const segment = at === -1 ? undefined : segments[at + 1];
    if (!segment || readId(segment) === null) return '';
    const dash = segment.indexOf('-');
    return dash === -1 ? '' : segment.slice(dash + 1);
  };
  return { region: after('r'), experience: after('e') };
}

/**
 * Where a legacy `?wv=` address should be sent, or `null` where the address is
 * already canonical or is not a place at all.
 */
export function legacyRedirect(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has('wv')) return null;
  const address = parseAppUrl(pathname, search);
  if (!address) return null;
  return buildAppUrl(address);
}

/**
 * The review page's list state (ADR-0051 decision 5): order, search, the
 * filter set and the selected row are `/review`'s address, as query
 * parameters — `review` is in `NOT_A_PLACE`, so `parseAppUrl` answers null for
 * it, and this pair is a sibling to `parseAppUrl`/`buildAppUrl` rather than an
 * extension of them: no path segments, only query parameters, in the words
 * `GET /api/experiences/review/queue` already reads (`q`, `sort`, `source`,
 * `kind`, `region`, `run`, `aside`, plus `row` for the selected card, which the
 * API does not need but a deep link and a set-aside both do).
 */
export interface ReviewAddress {
  /** '' when absent. Trimmed and capped at 100 characters — the API's own `q` limit, enforced on both the read and the write. */
  q: string;
  /** Default 'date'; written only when 'question'. */
  sort: 'date' | 'question';
  /** ?source=1,3 */
  sourceIds: number[];
  /** ?kind=arrival,refused — the API's own words, in the order given. */
  kinds: string[];
  /** ?region=6737 | none */
  regionId: number | 'none' | null;
  /** ?run=98 */
  runId: number | null;
  /** ?aside=show */
  showAside: boolean;
  /** ?row=waiting:11586 — `${kind}:${id}`, the QueueRow key. */
  row: string | null;
}

export const EMPTY_REVIEW: ReviewAddress = {
  q: '',
  sort: 'date',
  sourceIds: [],
  kinds: [],
  regionId: null,
  runId: null,
  showAside: false,
  row: null,
};

/**
 * Whether anything narrows the list — the five parameters *Clear all* clears.
 *
 * Not `sort` and not `aside`: an order shows the same questions in another
 * arrangement, and showing the set-aside rows adds rather than narrows. Two
 * surfaces ask this — the toolbar, to offer *Clear all*, and the page, to tell
 * "nothing matches" from "nothing waiting" — and a second copy of the list of
 * parameters is what would drift when a sixth filter arrives.
 */
export function isFilteredReview(a: ReviewAddress): boolean {
  return a.q !== '' || a.sourceIds.length > 0 || a.kinds.length > 0
    || a.regionId !== null || a.runId !== null;
}

const REVIEW_Q_MAX = 100;

/**
 * The search text as the address holds it: trimmed, and capped at the API's own limit.
 *
 * Exported because the toolbar has to ask the same question the parse answers. Its box
 * reports what was typed and then follows the address back; comparing the two against
 * *half* of this rule — the trim alone — rewrites the box mid-typing, eating the trailing
 * space of `Cologne ` or the tail of a pasted 101-character search, and moving the caret
 * to the end of a controlled input as it goes. One rule in one place, so the trim and the
 * cap cannot drift apart.
 */
export function normaliseReviewQ(raw: string): string {
  return raw.trim().slice(0, REVIEW_Q_MAX);
}

/** The API's own words for a question's kind, plus the three sub-kinds `waiting` groups. */
const REVIEW_KIND_WORDS = new Set(['conflict', 'withdrawn', 'refused', 'missing', 'arrival', 'held', 'contents']);

/**
 * The five list kinds a `row` can name — `waiting` is the grouped gated row.
 *
 * The *list's* words, not the API's, which differ in one: `row` carries a `QueueRow` key
 * (`queueRows.ts`), and the row a `?kind=conflict` filter leaves is keyed `conflicts:88`.
 * They are different parameters naming different things — a question kind to filter by, and
 * a row on the page — and matching the API's word here would produce a `row` the page can
 * never find.
 */
const REVIEW_ROW = /^(conflicts|waiting|withdrawn|refused|missing):(\d+)$/;

/** A comma-separated parameter's entries, or `[]` when the parameter is absent. */
function csv(raw: string | null): string[] {
  return raw ? raw.split(',') : [];
}

function readRow(raw: string | null): string | null {
  if (!raw) return null;
  const match = REVIEW_ROW.exec(raw);
  if (!match) return null;
  const id = Number(match[2]);
  return Number.isSafeInteger(id) && id > 0 ? raw : null;
}

/**
 * Reads the review page's address. Lenient throughout: an unreadable value
 * reads as absent rather than rejecting the rest of the query.
 */
export function parseReviewUrl(search: string): ReviewAddress {
  const params = new URLSearchParams(search);

  const rawRegion = params.get('region');

  return {
    q: normaliseReviewQ(params.get('q') ?? ''),
    sort: params.get('sort') === 'question' ? 'question' : 'date',
    sourceIds: csv(params.get('source')).map(readId).filter((id): id is number => id !== null),
    kinds: csv(params.get('kind')).filter(k => REVIEW_KIND_WORDS.has(k)),
    regionId: rawRegion === 'none' ? 'none' : readId(rawRegion),
    runId: readId(params.get('run')),
    showAside: params.get('aside') === 'show',
    row: readRow(params.get('row')),
  };
}

/** Writes the review page's address. `/review` or `/review?…`, keys in a fixed order. */
export function buildReviewUrl(a: ReviewAddress): string {
  const parts: string[] = [];
  if (a.sort === 'question') parts.push('sort=question');
  // The build applies the same rule as the parse (`normaliseReviewQ`): a
  // cosmetic difference — a trailing space, a paste over the 100-character
  // cap — builds the same address the parse would produce anyway, so `go`'s
  // no-op guard swallows it instead of pushing a dead history entry.
  const q = normaliseReviewQ(a.q);
  if (q !== '') parts.push(new URLSearchParams({ q }).toString());
  if (a.sourceIds.length > 0) parts.push(`source=${a.sourceIds.join(',')}`);
  if (a.kinds.length > 0) parts.push(`kind=${a.kinds.join(',')}`);
  if (a.regionId !== null) parts.push(`region=${a.regionId}`);
  if (a.runId !== null) parts.push(`run=${a.runId}`);
  if (a.showAside) parts.push('aside=show');
  if (a.row !== null) parts.push(`row=${a.row}`);
  return parts.length > 0 ? `/review?${parts.join('&')}` : '/review';
}
