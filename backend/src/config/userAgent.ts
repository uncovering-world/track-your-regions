/**
 * Who this backend says it is, to every server it does not own.
 *
 * One place builds the header, because writing it at each call site already
 * failed: a new outbound call copied the nearest existing one, and copied its
 * contact with it. By #864 there were six spellings across fifteen call sites,
 * and the contact three of them published belonged to nothing —
 * `github.com/nikolay/track-your-regions` and `github.com/trackyourregions`
 * both answer 404, and `trackyourregions.com` has no A record and no MX, so
 * `contact@trackyourregions.com` could not receive the mail it invited.
 *
 * The shape is the one Wikimedia's User-Agent policy states —
 * `<client>/<version> (<contact information>)`, the contact given as a website
 * or an email address — and the policy is the reason the header matters more
 * here than politeness: "Scripts should use an informative User-Agent string
 * with contact information, or they may be blocked without notice." The OSM
 * Foundation's Nominatim policy asks the same and refuses a stock agent
 * outright. Wikidata, Commons and Nominatim are what the catalogue is made of,
 * so this string is a dependency of filling it, not decoration.
 */

import { readFileSync } from 'node:fs';

const CLIENT = 'TrackYourRegions';

/**
 * The contact this instance publishes when the deployment names none.
 *
 * Both halves answer today: `uncovering.world` resolves and serves, and the
 * domain carries MX records, so the mailbox receives. A deployment that is not
 * this one — a fork, or a second instance — says so through
 * `USER_AGENT_CONTACT` rather than inheriting a contact that cannot speak for
 * it; `validateEnv` refuses a value that names neither a website nor a mailbox.
 */
const DEFAULT_CONTACT = 'https://uncovering.world; info@uncovering.world';

/**
 * The version comes from `backend/package.json` rather than a literal, which is
 * how `1.0` stayed in every string while the package moved to `1.0.0`.
 *
 * `../../package.json` is that file from either tree: `src/config/` under tsx
 * and `dist/config/` under node both sit two levels below the package root.
 */
const VERSION = (
  JSON.parse(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a literal path resolved against this module's own URL
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
).version;

/**
 * What a header value may hold: printable Latin-1, which is what undici will
 * convert to a `ByteString`. A character above U+00FF is not a bad header, it
 * is no request at all — `new Headers({'User-Agent': '… — …'})` throws
 * "character at index N has a value of 8212 which is greater than 255", and an
 * em dash is exactly what a pasted contact carries. So the text is made safe
 * here as well as refused in `validateEnv`: a value that slipped through must
 * degrade to a plainer header, never take every outbound call down with it.
 */
const HEADER_SAFE_TEXT = /[^\x20-\x7e\x80-\xff]/g;

/** One line of header-safe text: whitespace collapsed, the rest of it dropped. */
function headerSafe(text: string): string {
  return text.replace(/\s+/g, ' ').replace(HEADER_SAFE_TEXT, '').trim();
}

/**
 * Whether a contact is one a stranger could act on.
 *
 * The shapes are the three Wikimedia's policy names — a website, an email
 * address, or a wiki user "using the format (<project>; User:<name>)" — each
 * required to carry the part that makes it reachable, so `@` and `https://`
 * alone do not pass. `validateEnv` asks this rather than spelling the rule a
 * second time; the header's own module is where it belongs.
 */
export function isUsableContact(value: string): boolean {
  const contact = headerSafe(value);
  if (contact !== value.trim().replace(/\s+/g, ' ')) return false;
  // Each class excludes the delimiter that follows it, and neither pattern
  // opens with an unbounded quantifier, so a long run of text that will not
  // match is refused in one pass rather than retried from every position. One
  // character of local part is all the mailbox shape asks for — enough to tell
  // `ops@fork.example` from a bare `@`.
  return /https?:\/\/[^\s/.]+\.[^\s/.]/.test(contact)
    || /[^\s@]@[^\s@.]+\.[^\s@.]/.test(contact)
    || /User:\S/.test(contact);
}

interface UserAgentOptions {
  /**
   * Machinery rather than one person's request: a source run, or the world-view
   * import's own lookups. Wikimedia asks automated agents to carry "bot" so
   * their systems can classify the traffic, and it is the traffic this names,
   * not who is watching — an admin's click on a dialog reaches both kinds, its
   * own single fetch without the marker and the import services it calls with
   * it. A curator's geocode lookup or the admin image proxy leaves it off.
   */
  bot?: boolean;
  /**
   * What this particular call is for, for a service that sees several kinds of
   * request from us — "CV border detection", "admin image proxy". It joins the
   * contact inside the parentheses, where the policy's format puts everything
   * that identifies the caller.
   */
  purpose?: string;
}

/** The `User-Agent` header for one outbound call. */
export function userAgent({ bot = false, purpose }: UserAgentOptions = {}): string {
  // Whatever the environment holds becomes one line of header-safe text. A
  // stray newline or an em dash from a paste would otherwise be a header value
  // undici refuses, and refusing it means every outbound call throws. The text
  // survives; it cannot become a second header, since nothing here splits on
  // one. A value that sanitises away to nothing falls back to the contact that
  // answers rather than publishing an empty one.
  const configured = headerSafe(process.env.USER_AGENT_CONTACT ?? '');
  const contact = configured || DEFAULT_CONTACT;
  const client = bot ? `${CLIENT}Bot` : CLIENT;
  const identity = headerSafe(purpose ? `${contact}; ${purpose}` : contact);
  return `${client}/${VERSION} (${identity})`;
}
