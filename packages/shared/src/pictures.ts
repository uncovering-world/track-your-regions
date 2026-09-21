/**
 * Where a picture may come from, and what counts as one — the rule the storing
 * side and the drawing side apply alike.
 *
 * A licence question before it is a technical one (ADR-0043). Wikimedia
 * Commons files are published to be reused with the author named, which is
 * what `ImageCreditLine` does; a photograph on somebody else's server carries
 * whatever terms that server carries, and the World Heritage Centre's are
 * explicit that its pictures "may not be copied or retransmitted by any means"
 * and that a site may "only link to, not replicate" them. So the rule cannot be
 * "any http(s) url": the product has to be able to say, of every picture it
 * draws, why it is allowed to draw it.
 *
 * Declared once because a host or a file type added on one side alone is a
 * picture that is stored and never drawn, or drawn and never storable — which
 * used to be held off by `urlSafety.test.ts` reading the frontend's copy as
 * text (#789). The storing side builds `isCommonsPictureUrl` and
 * `isDisplayablePictureUrl` on these; the drawing side builds `toThumbnailUrl`
 * and `extractImageUrl`. What differs between the two is what each side does
 * with a url, never which url is a picture.
 */

/** The hosts a picture on a card may come from. */
export const PICTURE_HOSTS = [
  'commons.wikimedia.org',
  'upload.wikimedia.org',
] as const;

/**
 * The file types a picture may be, read from the name the host serves it under.
 *
 * The evidence that a stored url is a picture at all, and what this repository
 * can check without asking somebody else's server on every write. Commons hosts
 * PDFs, videos and scanned books under the same `Special:FilePath` shape, and a
 * run that stored one of those would put an empty frame on a card exactly the
 * way `whc.unesco.org/document/<id>` did (#557).
 */
export const PICTURE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.tif', '.tiff', '.avif'] as const;

/** Is this host one of the picture hosts, or a subdomain of one? */
export function isPictureHost(hostname: string): boolean {
  return PICTURE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/**
 * Does this path end in a picture file's name?
 *
 * Decoded first, since Commons percent-encodes the name and `.jpg` may arrive
 * as `%2Ejpg`; a path that does not decode names no file this rule admits.
 */
export function namesAPictureFile(pathname: string): boolean {
  let name: string;
  try {
    name = decodeURIComponent(pathname).toLowerCase();
  } catch {
    return false;
  }
  return PICTURE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Is this file actually one of Commons', on the host that serves every wiki's
 * uploads?
 *
 * `upload.wikimedia.org` serves the files of every Wikimedia project from one
 * host, and only the ones under `/wikipedia/commons/` are Commons files. The
 * others are a language edition's own uploads, and the English Wikipedia's
 * include fair-use files — a poster, an album cover — that no licence lets this
 * product show. The host alone does not say which; the path does.
 */
export function isCommonsPath(hostname: string, pathname: string): boolean {
  return !isUploadHost(hostname) || pathname.includes('/wikipedia/commons/');
}

/** The one host that serves every wiki's uploads, or a subdomain of it. */
export function isUploadHost(hostname: string): boolean {
  return hostname === 'upload.wikimedia.org' || hostname.endsWith('.upload.wikimedia.org');
}

/**
 * Is this the page *about* a file rather than the file?
 *
 * `commons.wikimedia.org/wiki/File:Louvre.jpg` ends the way a picture ends and
 * answers HTML — the description page, with the licence and the uploader on it.
 * The file itself is served under `Special:FilePath/` (or from `upload.`), and
 * only those are pictures to store or draw. A path that does not decode is read
 * as a page: nothing this rule admits is spelled that way.
 */
export function isDescriptionPage(pathname: string): boolean {
  try {
    return /^\/wiki\/File:/i.test(decodeURIComponent(pathname));
  } catch {
    return true;
  }
}
