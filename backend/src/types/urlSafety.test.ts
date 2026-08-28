/**
 * What a curator may store in a url field.
 *
 * The question is asked of the URL parser rather than of the raw string,
 * because the parser is what a browser uses later: it drops ASCII tab, LF and
 * CR from anywhere in the input, and leading whitespace from the front, before
 * it decides what the scheme is. A denylist matched against the value as sent
 * therefore reads a different value than the browser does — which is how
 * `" javascript:…"` reached `experiences.image_url` (#693), and how
 * `"java\tscript:…"` reached it past the trimmed spelling next door as well.
 *
 * The assertions sit on the schemas, not on a controller. `validate()` is what
 * every route runs and what replaces `req.body`, so a test that hands a
 * controller a hand-made body never touches the rule at all.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  editExperienceBodySchema,
  createManualExperienceBodySchema,
  wvImportBodySchema,
  wvImportSelectMapImageSchema,
  wvImportVisionMatchSchema,
  wvImportAddChildSchema,
  wvImportRenameRegionSchema,
} from './index.js';
import { isStorableHttpUrl, isStorableImageUrl } from './urlSafety.js';

/** Spellings of a script-bearing scheme that a URL parser resolves all the same. */
const SCRIPT_SCHEMES = [
  'javascript:alert(1)',
  ' javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'jav\rascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '\tdata:text/html,x',
  'vbscript:msgbox(1)',
  'blob:https://evil.example/1234',
];

/** Paths that look local but name an authority of their own. */
const FOREIGN_AUTHORITY_PATHS = ['//evil.example/x.png', '/\\evil.example/x.png', '/\t/evil.example/x.png'];

const editAccepts = (patch: Record<string, unknown>): boolean =>
  editExperienceBodySchema.safeParse(patch).success;

const MANUAL_BASE = {
  name: 'A place',
  longitude: 10,
  latitude: 20,
  regionId: 1,
  categoryId: 1,
};

describe('imageUrl a curator stores', () => {
  it('refuses every spelling of a script-bearing scheme', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(editAccepts({ imageUrl: value }), value).toBe(false);
    }
  });

  it('refuses a path that names an authority other than ours', () => {
    for (const value of FOREIGN_AUTHORITY_PATHS) {
      expect(editAccepts({ imageUrl: value }), value).toBe(false);
    }
  });

  it('accepts the absolute http(s) url every stored picture actually is', () => {
    expect(editAccepts({ imageUrl: 'https://upload.wikimedia.org/x.jpg' })).toBe(true);
    expect(editAccepts({ imageUrl: 'http://whc.unesco.org/document/1' })).toBe(true);
  });

  it('accepts a path to a picture we host ourselves', () => {
    expect(editAccepts({ imageUrl: '/images/experiences/12.jpg' })).toBe(true);
  });

  it('stores the url without the whitespace it arrived in', () => {
    const parsed = editExperienceBodySchema.parse({ imageUrl: '  https://upload.wikimedia.org/x.jpg  ' });
    expect(parsed.imageUrl).toBe('https://upload.wikimedia.org/x.jpg');
  });

  it('stores the spelling the parser read, not the one that arrived', () => {
    // Judged by the parser and stored as typed, these two would be accepted here
    // and then refused by `isRenderableImageUrl`, whose http(s) test is a
    // lowercase `startsWith` — a picture saved and silently never drawn.
    const upper = editExperienceBodySchema.parse({ imageUrl: 'HTTPS://upload.wikimedia.org/x.jpg' });
    expect(upper.imageUrl).toBe('https://upload.wikimedia.org/x.jpg');

    const tabbed = editExperienceBodySchema.parse({ imageUrl: 'https://upload.wikimedia.org/x\t.jpg' });
    expect(tabbed.imageUrl).toBe('https://upload.wikimedia.org/x.jpg');
  });

  it('leaves a path on our own origin as it is', () => {
    const parsed = editExperienceBodySchema.parse({ imageUrl: '/images/experiences/12.jpg' });
    expect(parsed.imageUrl).toBe('/images/experiences/12.jpg');
  });

  it('measures the width against what is stored, not against what arrived', () => {
    // Percent-encoding can only make a url longer, so a value that fits the
    // column as typed can overflow it once normalised — and Postgres would
    // answer that with a 22001 the caller sees as a 500.
    const long = `https://upload.wikimedia.org/${'é'.repeat(600)}.jpg`;
    expect(long.length).toBeLessThanOrEqual(1000);
    expect(new URL(long).href.length).toBeGreaterThan(1000);
    expect(editAccepts({ imageUrl: long })).toBe(false);
  });

  it('accepts an empty value, which is how the API clears a picture', () => {
    // The API's way, and only the API's: emptying the field in `CurationDialog`
    // sends `{ imageUrl: undefined }`, which `JSON.stringify` drops, so the
    // request arrives `{}` and is answered "No fields to update". A shape a
    // rule tightened here must not start refusing all the same.
    expect(editAccepts({ imageUrl: '' })).toBe(true);
  });
});

describe('websiteUrl and wikipediaUrl a curator stores', () => {
  it('refuses every spelling of a script-bearing scheme', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(editAccepts({ websiteUrl: value }), value).toBe(false);
      expect(editAccepts({ wikipediaUrl: value }), value).toBe(false);
    }
  });

  it('refuses a relative path, which names no site to link to', () => {
    expect(editAccepts({ websiteUrl: '/images/experiences/12.jpg' })).toBe(false);
    expect(editAccepts({ wikipediaUrl: '/wiki/Machu_Picchu' })).toBe(false);
  });

  it('accepts an absolute http(s) url', () => {
    expect(editAccepts({ websiteUrl: 'https://whc.unesco.org/en/list/274' })).toBe(true);
    expect(editAccepts({ wikipediaUrl: 'https://en.wikipedia.org/wiki/Machu_Picchu' })).toBe(true);
  });
});

describe('a manually created experience is held to the same rule', () => {
  it('refuses a scheme hidden behind a leading space', () => {
    const result = createManualExperienceBodySchema.safeParse({
      ...MANUAL_BASE,
      imageUrl: ' javascript:alert(1)',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the absolute https url a curator would paste', () => {
    const result = createManualExperienceBodySchema.safeParse({
      ...MANUAL_BASE,
      imageUrl: 'https://upload.wikimedia.org/x.jpg',
      websiteUrl: 'https://example.org/',
    });
    expect(result.success).toBe(true);
  });
});

describe('the rule the curation controller shares with the schema', () => {
  it('answers for a link the same way the schema does', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(isStorableHttpUrl(value), value).toBe(false);
    }
    expect(isStorableHttpUrl('https://example.org/')).toBe(true);
    expect(isStorableHttpUrl('/wiki/Machu_Picchu')).toBe(false);
  });

  it('lets a picture be a path on our own origin, and a link not', () => {
    expect(isStorableImageUrl('/images/experiences/12.jpg')).toBe(true);
    expect(isStorableHttpUrl('/images/experiences/12.jpg')).toBe(false);
    for (const value of FOREIGN_AUTHORITY_PATHS) {
      expect(isStorableImageUrl(value), value).toBe(false);
    }
  });
});

/**
 * A region's imported map is the other stored picture (#694). It arrives three
 * ways -- a node of an import tree, a pick among that node's candidates, and
 * the url a vision match is asked to look at -- and each of them used to be
 * `z.string().url()`, which is `new URL()` in a try/catch and not a protocol
 * allowlist: it accepts `javascript:` and `data:` as readily as `https:`.
 * Unlike an experience's picture, nothing legitimate here is a local path: the
 * only writer builds a Commons `Special:FilePath` url for every map it finds.
 */
describe("a region's imported map is held to the same rule", () => {
  const COMMONS_MAP = 'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_regions_map.png';

  const tree = (node: Record<string, unknown>) =>
    wvImportBodySchema.safeParse({ name: 'A world view', tree: { name: 'Root', ...node } });

  it('refuses every spelling of a script-bearing scheme on a node', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(tree({ regionMapUrl: value }).success, value).toBe(false);
    }
  });

  it('refuses the scheme wherever it sits in the tree, not only at the root', () => {
    const deep = tree({
      children: [{ name: 'Algeria', children: [{ name: 'Saharan Atlas', regionMapUrl: 'javascript:alert(1)' }] }],
    });
    expect(deep.success).toBe(false);
  });

  it('refuses a candidate that carries the scheme, since the picker draws every candidate', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(tree({ mapImageCandidates: [COMMONS_MAP, value] }).success, value).toBe(false);
    }
  });

  it('refuses a path, which no map hosted anywhere can be', () => {
    expect(tree({ regionMapUrl: '/images/maps/algeria.png' }).success).toBe(false);
    expect(tree({ mapImageCandidates: ['/images/maps/algeria.png'] }).success).toBe(false);
    for (const value of FOREIGN_AUTHORITY_PATHS) {
      expect(tree({ regionMapUrl: value }).success, value).toBe(false);
    }
  });

  it('accepts the Commons url every stored map actually is, and stores it as the parser read it', () => {
    const parsed = wvImportBodySchema.parse({
      name: 'A world view',
      tree: { name: 'Root', regionMapUrl: ` ${COMMONS_MAP} `, mapImageCandidates: [COMMONS_MAP, 'HTTPS://commons.wikimedia.org/wiki/Special:FilePath/Algeria_map.svg'] },
    });
    expect(parsed.tree.regionMapUrl).toBe(COMMONS_MAP);
    expect(parsed.tree.mapImageCandidates).toEqual([
      COMMONS_MAP,
      'https://commons.wikimedia.org/wiki/Special:FilePath/Algeria_map.svg',
    ]);
  });

  it('accepts a node that names no map at all', () => {
    expect(tree({}).success).toBe(true);
  });

  it('refuses the scheme on a pick among the candidates', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(wvImportSelectMapImageSchema.safeParse({ regionId: 1, imageUrl: value }).success, value).toBe(false);
    }
    expect(wvImportSelectMapImageSchema.safeParse({ regionId: 1, imageUrl: COMMONS_MAP }).success).toBe(true);
    expect(wvImportSelectMapImageSchema.safeParse({ regionId: 1, imageUrl: null }).success).toBe(true);
  });

  it('leaves a pick spelled as the candidate row it names', () => {
    // The controller keeps a pick only where it equals a stored candidate, and
    // a candidate stored before the rule may carry a non-ASCII file name that
    // the parser would percent-encode. A pick is a row's own spelling, so it
    // is judged and not rewritten.
    const raw = 'https://commons.wikimedia.org/wiki/Special:FilePath/Île-De-France-Map.png';
    expect(new URL(raw).href).not.toBe(raw);
    const parsed = wvImportSelectMapImageSchema.parse({ regionId: 1, imageUrl: raw });
    expect(parsed.imageUrl).toBe(raw);
  });

  it('refuses the scheme on the url a vision match is asked to look at', () => {
    const body = (imageUrl: string) => ({ divisionIds: [1], regionId: 1, imageUrl });
    for (const value of SCRIPT_SCHEMES) {
      expect(wvImportVisionMatchSchema.safeParse(body(value)).success, value).toBe(false);
    }
    expect(wvImportVisionMatchSchema.safeParse(body(COMMONS_MAP)).success).toBe(true);
  });
});

/**
 * A region's source page is the third url an import tree carries, and the only
 * one that reaches an `<a href>` (#703). It arrives three ways -- a node of an
 * import tree, a child added during review, and a rename that enriches a
 * region with the page an AI review found -- and each of them used to be
 * `z.string().url()`, the same check #694 replaced for the two picture fields
 * two lines above it in the same schema. What makes it a different class from
 * the map: `javascript:` in an `img src` has not executed since Netscape 4,
 * but in an `href` it runs on click, in the admin's session, on every browser.
 */
describe("a region's source page is held to the link rule", () => {
  const WIKIVOYAGE_PAGE = 'https://en.wikivoyage.org/wiki/Saharan_Atlas';

  const tree = (node: Record<string, unknown>) =>
    wvImportBodySchema.safeParse({ name: 'A world view', tree: { name: 'Root', ...node } });
  const addChild = (sourceUrl: unknown) =>
    wvImportAddChildSchema.safeParse({ parentRegionId: 1, name: 'Saharan Atlas', sourceUrl });
  const rename = (sourceUrl: unknown) =>
    wvImportRenameRegionSchema.safeParse({ regionId: 1, name: 'Saharan Atlas', sourceUrl });

  it('refuses every spelling of a script-bearing scheme, by every route the page arrives', () => {
    for (const value of SCRIPT_SCHEMES) {
      expect(tree({ sourceUrl: value }).success, value).toBe(false);
      expect(addChild(value).success, value).toBe(false);
      expect(rename(value).success, value).toBe(false);
    }
  });

  it('refuses the scheme wherever it sits in the tree, not only at the root', () => {
    const deep = tree({
      children: [{ name: 'Algeria', children: [{ name: 'Saharan Atlas', sourceUrl: 'javascript:alert(document.cookie)' }] }],
    });
    expect(deep.success).toBe(false);
  });

  it('refuses a path, which names no page to open', () => {
    expect(tree({ sourceUrl: '/wiki/Saharan_Atlas' }).success).toBe(false);
    for (const value of FOREIGN_AUTHORITY_PATHS) {
      expect(tree({ sourceUrl: value }).success, value).toBe(false);
    }
  });

  it('accepts the Wikivoyage url every stored page actually is, and stores it as the parser read it', () => {
    const parsed = wvImportBodySchema.parse({
      name: 'A world view',
      tree: { name: 'Root', sourceUrl: ` ${WIKIVOYAGE_PAGE} ` },
    });
    expect(parsed.tree.sourceUrl).toBe(WIKIVOYAGE_PAGE);
    const renamed = wvImportRenameRegionSchema.parse({
      regionId: 1,
      name: 'Saharan Atlas',
      sourceUrl: 'HTTPS://en.wikivoyage.org/wiki/Saharan_Atlas',
    });
    expect(renamed.sourceUrl).toBe(WIKIVOYAGE_PAGE);
    expect(addChild(WIKIVOYAGE_PAGE).success).toBe(true);
  });

  it('accepts a node, a child and a rename that name no page', () => {
    expect(tree({}).success).toBe(true);
    expect(addChild(undefined).success).toBe(true);
    expect(rename(undefined).success).toBe(true);
  });

  it('still refuses an empty value, which no reader of source_url means anything by', () => {
    // `safeUrlSchema` reads '' as "clear the field", which fits a curator's
    // form: the curation controller turns it into NULL. Nothing does here --
    // the rename handler writes the value it is given, and every reader of the
    // column (`importer.ts`, `pointMatcher.ts`, the sync-to-instances lookup)
    // tests it for truthiness -- so a page is either named or not sent, and
    // '' stays refused, the way `z.string().url()` refused it.
    expect(tree({ sourceUrl: '' }).success).toBe(false);
    expect(addChild('').success).toBe(false);
    expect(rename('').success).toBe(false);
  });
});

/**
 * The defect this file exists for was not a wrong rule but a second copy of it:
 * `safeUrl` and `isUnsafeUrl` were the same denylist two files apart, and only
 * one of them trimmed. A third copy would put the divergence straight back, so
 * the assertion is made over the source rather than over behaviour — no other
 * module may decide which scheme a stored url names.
 */
describe('the rule is declared once', () => {
  const backendSrc = join(dirname(fileURLToPath(import.meta.url)), '..');

  /** Every module under a directory, for the guards that hold a rule across a package. */
  function modulesUnder(dir: string): string[] {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the one caller passes a path built from this module's own URL and literals
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map(name => join(dir, name));
  }

  /** Every module that is not the one allowed to name a protocol, and what it says. */
  const otherModules = (): Array<{ file: string; text: string }> =>
    modulesUnder(backendSrc)
      .filter(file => !file.endsWith(join('types', 'urlSafety.ts')))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      .map(file => ({ file, text: readFileSync(file, 'utf8') }));

  it('names a script-bearing scheme in no module but urlSafety.ts', () => {
    // A scheme name inside a literal — a regex, anchored or not, a quoted
    // string, a `startsWith` — rather than anywhere at all: prose in backticks
    // names these schemes to explain why they are not the rule, and must stay
    // able to. `data` and `blob` are left out of the names on purpose; they are
    // ordinary TypeScript identifiers (`(data: Foo)`, `(blob: Blob)`), while no
    // denylist of URL schemes omits `javascript:`.
    const denylist = /[/'"|(^](javascript|vbscript)\s*[:|]/i;
    const offenders = otherModules().filter(({ text }) => denylist.test(text)).map(({ file }) => file);

    expect(offenders, 'a denylist of schemes belongs nowhere: the rule is an allowlist, in urlSafety.ts').toEqual([]);
  });

  it('names an http(s) protocol in no module but urlSafety.ts', () => {
    // `'https:'` and `'http:'` as whole literals — a protocol being compared.
    // `'https://…'` does not match: the quote does not follow the colon.
    const offenders = otherModules().filter(({ text }) => /["']https?:["']/.test(text)).map(({ file }) => file);

    expect(offenders, 'which protocols may be stored is decided in urlSafety.ts and read from there').toEqual([]);
  });

  /**
   * The read side of the same rule lives in `frontend/src/utils/imageUrl.ts`,
   * and the seven dialogs of #694 were not wrong about it; they never asked
   * it. A stored picture reaching a `src` through a template literal of its
   * own is the shape every one of them had, so it is refused at the source
   * rather than found again in review. Asserted from here because only this
   * test tree can read files: the frontend's compiles without Node's types.
   *
   * What is looked at is the `src` expression -- a JSX `src={…}` or an
   * imperative `.src = …`, which is how a debug window draws -- and, where
   * that is a bare name, the one binding the file gives it: `const mapSrc = …;
   * src={mapSrc}` is the shape the fix itself uses everywhere, and a later
   * edit narrowing that binding to the raw value would otherwise pass. Two
   * levels of indirection still would; the guard pins the shapes that have
   * actually occurred.
   */
  it('lets no component put a stored picture into a src of its own', () => {
    const frontendSrc = join(backendSrc, '..', '..', 'frontend', 'src');
    /**
     * A stored picture: a region's map, by the name every prop carries it
     * under, or an experience's or a work's picture as the column it comes
     * from. The camelCase `imageUrl` is left out on purpose: under that name
     * the tree holds prepared values as often as stored ones -- the overlay's
     * FileReader data url, the hover store's ready thumbnail -- and a pattern
     * that flagged those would be answered with exemptions, not with the rule.
     */
    const storedPicture = /\b(regionMapUrl|region_map_url)\b|\.image_url\b/;
    /** The doors: an expression that names a stored picture must call one of them, or the card helper built on both. */
    const throughTheRule = /\b(toThumbnailUrl|extractImageUrl|cardImageUrl)\s*\(/;
    /** `${url}?width=300`: a picture sized by hand rather than by toThumbnailUrl. */
    const sizedByHand = /`[^`]*\$\{[^}]*\}[^`]*\?width=/;
    const drawsRaw = (expression: string): boolean =>
      sizedByHand.test(expression) || (storedPicture.test(expression) && !throughTheRule.test(expression));

    const offenders: string[] = [];
    for (const name of readdirSync(frontendSrc, { recursive: true, encoding: 'utf8' })) {
      if (!name.endsWith('.tsx') || name.endsWith('.test.tsx')) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      const text = readFileSync(join(frontendSrc, name), 'utf8');
      // A JSX expression may hold one level of braces of its own: `${url}` is
      // exactly the shape being looked for, and would otherwise end the match.
      // eslint-disable-next-line security/detect-unsafe-regex -- the two alternatives inside the star are disjoint on their first character (`{` against not-`{`), so no input matches two ways and there is no catastrophic backtracking
      const jsxSrc = [...text.matchAll(/\bsrc=\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(m => ({ site: `src={${m[1].trim()}}`, expression: m[1].trim() }));
      // `img.src = …;` -- the same sink, reached without JSX. The value starts
      // at its first non-blank character, so the blanks before it belong to
      // one token only and the match is linear.
      const assignedSrc = [...text.matchAll(/\.src\s*=\s*(\S[^;]*);/g)].map(m => ({ site: `.src = ${m[1].trim()}`, expression: m[1].trim() }));
      for (const { site, expression } of [...jsxSrc, ...assignedSrc]) {
        if (drawsRaw(expression)) offenders.push(`${name}: ${site}`);
        if (!/^[A-Za-z_$][\w$]*$/.test(expression)) continue;
        // A bare name: what the file binds it to is what reaches the src.
        // eslint-disable-next-line security/detect-non-literal-regexp -- the name is an identifier matched by the anchored test above, so it carries no regex syntax
        const binding = new RegExp(`\\b(?:const|let|var)\\s+${expression}\\s*=\\s*([^;]*);`).exec(text);
        if (binding && drawsRaw(binding[1])) offenders.push(`${name}: ${expression} = ${binding[1].trim()}`);
      }
    }

    expect(offenders, 'a stored picture is drawn through toThumbnailUrl or extractImageUrl, never raw').toEqual([]);
  });

  /**
   * The link side of the same rule is `safeHref` (frontend/src/utils/safeHref.ts),
   * and the five surfaces of #703 never asked it: a region's source page went
   * into an `<a href>` -- and once into `window.open`, where a `javascript:`
   * url runs just the same -- as the string the row carried. What is looked at
   * is every module that carries a stored link at all, by the names the
   * links travel under -- a region's `sourceUrl`, a credit's `licenseUrl`
   * and `detailsUrl` -- a hook as much as a component, since `window.open`
   * is imperative and lives as naturally in one -- and in such a module every
   * dynamic `href={…}`, every `window.open(…)` and every `.href = …`
   * assignment, whatever it names: the
   * value reaches a link through a prop as often as directly
   * (`<SourcePageLink url={node.sourceUrl} />`, then `href={url}`), so an
   * href that names the stored link is not the shape to pin. What reaches the
   * sink must be a `safeHref(…)` call and nothing else -- `safeHref(x) || x`
   * hands the refused value straight back -- or the file's own spelling. A
   * bare name is followed to every binding the file gives it -- a long module
   * holds several components, and a name that is safe in one may be raw in
   * the next -- and a name the file binds to nothing is whatever the caller
   * passed.
   */
  /** The door: what reaches the sink is a `safeHref(…)` call, whole, with one level of parentheses of its own. */
  // eslint-disable-next-line security/detect-unsafe-regex -- the two alternatives inside the star are disjoint on their first character (`(` against not-`(`), so the match is linear
  const throughTheRule = /^safeHref\s*\((?:[^()]|\([^()]*\))*\)$/;
  /** A url the file spells itself -- a string literal, or a template that opens on a scheme of its own. */
  const ownSpelling = /^(['"]|`https?:\/\/)/;
  const linksRaw = (expression: string): boolean => !ownSpelling.test(expression) && !throughTheRule.test(expression);

  /** Every dynamic href, every `window.open` and every `.href = …` in a file, as the expression that reaches it. */
  const linkSites = (text: string): Array<{ site: string; expression: string }> => [
    // A JSX expression may hold one level of braces of its own.
    // eslint-disable-next-line security/detect-unsafe-regex -- the two alternatives inside the star are disjoint on their first character (`{` against not-`{`), so no input matches two ways and there is no catastrophic backtracking
    ...[...text.matchAll(/\bhref=\{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(m => ({ site: `href={${m[1].trim()}}`, expression: m[1].trim() })),
    // The first argument of `window.open`, up to the top-level comma that
    // ends it; one level of parentheses of its own, for `safeHref(x)`.
    // eslint-disable-next-line security/detect-unsafe-regex -- the two alternatives are disjoint on their first character (`(` against not-`(`), so the match is linear
    ...[...text.matchAll(/\bwindow\.open\(\s*((?:[^(),]|\([^()]*\))+)/g)].map(m => ({ site: `window.open(${m[1].trim()}`, expression: m[1].trim() })),
    // `location.href = …` -- the same navigation, reached without JSX and
    // without `window.open`; a `javascript:` value assigned there runs too.
    // The value starts at its first non-blank character, so the match is linear.
    ...[...text.matchAll(/\.href\s*=\s*(\S[^;]*);/g)].map(m => ({ site: `.href = ${m[1].trim()}`, expression: m[1].trim() })),
  ];

  /**
   * Everything the file binds a bare name to -- all of it, since a second
   * component in the same module may bind the same name to the raw value --
   * or nothing, for an expression or a name it never binds. Every binding is
   * read with one fixed pattern and the name compared afterwards, rather than
   * spliced into a pattern of its own; the value starts at its first
   * non-blank character, so the blanks before it belong to one token only and
   * the match is linear.
   */
  const bindingsOf = (text: string, expression: string): string[] => {
    if (!/^[A-Za-z_$][\w$]*$/.test(expression)) return [];
    const bindings: string[] = [];
    for (const m of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(\S[^;]*);/g)) {
      if (m[1] === expression) bindings.push(m[2]);
    }
    return bindings;
  };

  /** The sinks in a module that a stored link could reach raw. */
  const rawLinkSites = (text: string): string[] =>
    linkSites(text)
      .filter(({ expression }) => {
        const bindings = bindingsOf(text, expression);
        return linksRaw(expression) && (bindings.length === 0 || bindings.some(linksRaw));
      })
      .map(({ site }) => site);

  it('tells a link offered through the rule from one that is not', () => {
    // Through the rule: the call itself, or a name bound to it.
    expect(rawLinkSites('<a href={safeHref(node.sourceUrl)} />')).toEqual([]);
    expect(rawLinkSites('const href = safeHref(node.sourceUrl);\n<a href={href} />')).toEqual([]);
    expect(rawLinkSites("const href = safeHref(node.sourceUrl);\nwindow.open(href, '_blank', 'noopener')")).toEqual([]);
    expect(rawLinkSites("window.open(safeHref(node.sourceUrl), '_blank')")).toEqual([]);
    // The file's own spelling: a literal, or a template that opens on a scheme.
    expect(rawLinkSites('<a href="https://example.org/" />')).toEqual([]);
    expect(rawLinkSites('<a href={`https://www.wikidata.org/wiki/${node.wikidataId}`} />')).toEqual([]);
    // Raw: the stored value, a name bound to it, a name bound to nothing.
    expect(rawLinkSites('<a href={node.sourceUrl} />')).toEqual(['href={node.sourceUrl}']);
    expect(rawLinkSites('const url = node.sourceUrl;\n<a href={url} />')).toEqual(['href={url}']);
    expect(rawLinkSites('<a href={url} />')).toEqual(['href={url}']);
    expect(rawLinkSites("window.open(node.sourceUrl, '_blank')")).toEqual(['window.open(node.sourceUrl']);
    expect(rawLinkSites('window.location.href = node.sourceUrl;')).toEqual(['.href = node.sourceUrl']);
    expect(rawLinkSites('const href = safeHref(node.sourceUrl);\nwindow.location.href = href;')).toEqual([]);
    // Raw: a name safe in one component of the module and raw in the next.
    expect(rawLinkSites('const href = safeHref(node.sourceUrl);\n<a href={href} />\nconst href = action.sourceUrl;\n<a href={href} />')).toEqual(['href={href}', 'href={href}']);
    // Raw all the same: the rule asked and its answer thrown away.
    expect(rawLinkSites('<a href={safeHref(node.sourceUrl) || node.sourceUrl} />')).toEqual(['href={safeHref(node.sourceUrl) || node.sourceUrl}']);
    expect(rawLinkSites('const href = safeHref(node.sourceUrl) ?? node.sourceUrl;\n<a href={href} />')).toEqual(['href={href}']);
    expect(rawLinkSites("window.open(safeHref(node.sourceUrl) || node.sourceUrl, '_blank')")).toEqual(['window.open(safeHref(node.sourceUrl) || node.sourceUrl']);
  });

  it('lets no module that carries a stored link put an href of its own on screen', () => {
    const frontendSrc = join(backendSrc, '..', '..', 'frontend', 'src');
    /** A stored link: a region's source page, and a picture credit's licence and details pages, by the names every prop and every row carry them under. */
    const storedLink = /\b(?:sourceUrl|source_url|licenseUrl|detailsUrl)\b/;

    const offenders: string[] = [];
    for (const name of readdirSync(frontendSrc, { recursive: true, encoding: 'utf8' })) {
      if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated from a literal root
      const text = readFileSync(join(frontendSrc, name), 'utf8');
      if (!storedLink.test(text)) continue;
      offenders.push(...rawLinkSites(text).map(site => `${name}: ${site}`));
    }

    expect(offenders, 'a stored link is offered through safeHref, never raw').toEqual([]);
  });
});
