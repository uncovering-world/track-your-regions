/**
 * The one grammar for the app's addresses (#644, ADR-0034).
 *
 *   /                                       map, default world view
 *   /wv/5                                   map, world view 5
 *   /wv/5/r/6737-europe                     map, region 6737 selected
 *   /wv/5/r/6737-europe/e/1234-stonehenge   map, card 1234 open in the explore panel
 *   /discover[/wv/5[/r/7120-france[/e/9]]][?cat=1]
 *
 * What names a resource — the world view, the region, the open card — is a
 * path segment, because it must survive being pasted into another browser.
 * View state a visitor set deliberately is a query parameter; today that is
 * Discover's category alone. Ids decide and slugs decorate: a segment is digits
 * followed by `-` or its end, and whatever follows that `-` is ignored — so a
 * renamed region keeps every link that was ever shared, and `useAppAddress`
 * rewrites the slug in place once the name is known. Deliberately stricter than
 * a bare `parseInt`, which would read `6737europe` as 6737 and accept a segment
 * nothing here ever wrote; see `readId`.
 *
 * Parsing and building live here together, with a round-trip test, so a
 * parameter cannot be added in one direction only.
 */

export type AppMode = 'map' | 'discover';

export interface AppAddress {
  mode: AppMode;
  /** `null` is the default world view, which writes no segment. */
  worldViewId: number | null;
  regionId: number | null;
  /** Only meaningful under a region; dropped by `buildAppUrl` without one. */
  experienceId: number | null;
  /** Discover's open category list; ignored on the map. */
  categoryId: number | null;
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

  const categoryId = mode === 'discover' && regionId !== null ? readId(params.get('cat')) : null;

  return { mode, worldViewId, regionId, experienceId, categoryId };
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
  const query = address.mode === 'discover' && regionId !== null && address.categoryId !== null
    ? `?cat=${address.categoryId}`
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
