/**
 * What a stored link may become on screen, decided in one place.
 *
 * The values that reach an `href` from the database are somebody else's: a
 * licence url from a Commons file's metadata, a region's source page from an
 * admin's import tree. The server holds each to an absolute http(s) url on
 * the way in (`backend/src/types/urlSafety.ts`), and this asks again where
 * the value meets the DOM — the rows already stored predate the write-path
 * rule, and a `javascript:` href runs on click, in the reader's session.
 * React neutralises that one scheme in an `href` of its own accord; it does
 * not in `window.open`, and it says nothing about `data:` or `blob:`. The
 * decision is the app's, not borrowed from the framework.
 *
 * Lived in `ImageCreditLine` until the source page needed the same answer
 * (#703).
 */

/**
 * A URL only if a reader may safely be sent to it.
 *
 * The parser is asked rather than the string: it drops ASCII tab, LF and CR
 * from anywhere in the value, and leading whitespace from the front, before
 * it decides what the scheme is, so `" javascript:…"` and `"java<tab>script:…"`
 * are `javascript:` urls that a pattern over the raw value does not see. A
 * value that fails becomes `null` — the caller shows plain text, or nothing.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    // No base URL. With one, a *relative* value from somebody else's metadata
    // would resolve against our own origin and the link would point back at
    // this site — a credit pointing at us credits nobody, and a source page on
    // our own origin names no source. An absolute URL with a scheme is
    // unaffected by a base either way, so dropping it costs nothing and closes
    // that case.
    const parsed = new URL(value);
    // `http` as well as `https`: these are licence URLs from wiki metadata, some
    // of them old, and a licence is a fact about the picture rather than a link
    // the catalogue vouches for. The schemes that execute are what matter here,
    // and neither of these is one.
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
