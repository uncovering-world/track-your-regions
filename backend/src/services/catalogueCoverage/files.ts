/**
 * The catalogue-coverage files, read and held to their format (ADR-0081).
 *
 * `db/catalogue-coverage/` holds the register of kinds of experience, the surveyed
 * regions, and per region the list of what a traveller expects there. The files are
 * the source of truth and are written by hand and by a survey, so this reader is the
 * one place that refuses a wrong line: it reads everything, collects every problem
 * with its file and line, and throws them together, since a list of a thousand
 * entries is fixed in one pass or not at all.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { findRepoRoot } from '../../db/repoRoot.js';
import { CHECK_VALUES } from '../../db/schema.generated.js';

/**
 * What a member of a kind is. A kind holds one form, and an entry is filed only under kinds
 * of its own. The lists are the schema's: a file the reader passes is one the load can insert.
 */
const FORMS = CHECK_VALUES.coverage_kinds.form;
const ENTRY_TYPES = CHECK_VALUES.coverage_expectations.type;
const STATUSES = CHECK_VALUES.coverage_kinds.status;

// eslint-disable-next-line security/detect-unsafe-regex -- each repeat of the group starts with a literal dash, so the match is linear
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase words joined by dashes');
const wikidataId = z.string().regex(/^Q[1-9]\d*$/, 'a Wikidata id, Q followed by digits');
const text = z.string().min(1);

const kindSchema = z.strictObject({
  slug,
  name: text,
  form: z.enum(FORMS),
  /** One sentence: what a traveller files under this kind. */
  definition: text,
  /** `live`: the product has it. `proposed`: it is a record and nothing else yet. */
  status: z.enum(STATUSES),
  /** The `experience_kinds` row of a live kind of place; a live kind of work has none. */
  experience_kind_id: z.number().int().positive().nullable(),
  /** The issue that owns building the kind. Priority and order live there, never here (ADR-0079). */
  issue: z.number().int().positive().nullable(),
  /** The heading that describes the kind in `docs/vision/PROPOSED-EXPERIENCE-CATEGORIES.md`. */
  vision: text.nullable(),
});

const regionSchema = z.strictObject({
  slug,
  name: text,
  country: text,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_km: z.number().positive(),
  surveyed: z.iso.date(),
});

const expectationSchema = z.strictObject({
  slug,
  name: text,
  aliases: z.array(text),
  type: z.enum(ENTRY_TYPES),
  /** Kinds of the register; none means the entry is not sorted yet. */
  kinds: z.array(slug),
  wikidata: wikidataId.nullable(),
  /** Other Wikidata items that are this same place: a building and the museum inside it. */
  same_as: z.array(wikidataId),
  /** UNESCO's own id of a World Heritage property. */
  unesco: z.string().regex(/^[1-9]\d*$/, "UNESCO's id, digits").nullable(),
  /** Where a work is shown, in words. */
  venue: text.nullable(),
  /** How many independent sources named it. Which ones is not published. */
  sources: z.number().int().min(2, 'an entry counts when two or more sources name it'),
  /** Sitelinks and coordinates as Wikidata gave them on the region's survey date. */
  sitelinks: z.number().int().min(0).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  note: z.string(),
});

export type CoverageKind = z.infer<typeof kindSchema>;
export type CoverageRegion = z.infer<typeof regionSchema>;
export type CoverageExpectation = z.infer<typeof expectationSchema>;

export interface CoverageFiles {
  kinds: CoverageKind[];
  regions: CoverageRegion[];
  /** Each region's list, by the region's slug, in file order. */
  expectations: Map<string, CoverageExpectation[]>;
}

/** Everything wrong with the files, one sentence per problem, each naming its file and line. */
export class CoverageFilesError extends Error {
  constructor(readonly problems: string[]) {
    super(`The catalogue-coverage files have ${problems.length} problem(s):\n${problems.join('\n')}`);
    this.name = 'CoverageFilesError';
  }
}

/** The checkout's own files: `db/catalogue-coverage`, on the host and in the container alike. */
export function defaultCoverageDir(): string {
  return join(findRepoRoot(), 'db', 'catalogue-coverage');
}

/** The kind an entry is filed under exactly when it carries a UNESCO id: the inscribed property itself. */
const WORLD_HERITAGE = 'world-heritage';

interface Row<T> { value: T; line: number }

/** One file's lines, each parsed and held to `schema`; a line that fails is reported and left out. */
function readLines<T>(dir: string, file: string, schema: z.ZodType<T>, problems: string[]): Row<T>[] {
  const path = join(dir, file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's directory and a name this module spells or lists from it
  if (!existsSync(path)) {
    problems.push(`${file}: the file is missing`);
    return [];
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above
  const lines = readFileSync(path, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const rows: Row<T>[] = [];
  lines.forEach((raw, index) => {
    const line = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      problems.push(`${file} line ${line}: not JSON (${error instanceof Error ? error.message : String(error)})`);
      return;
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        problems.push(`${file} line ${line}: ${field}${issue.message}`);
      }
      return;
    }
    rows.push({ value: result.data, line });
  });
  return rows;
}

/** What one record of the register says against itself. */
function checkKind(kind: CoverageKind): string[] {
  const found: string[] = [];
  if (kind.status === 'proposed' && kind.experience_kind_id !== null) {
    found.push(`${kind.slug} is proposed and names experience_kind_id ${kind.experience_kind_id}`);
  }
  if (kind.status === 'live' && kind.form === 'place' && kind.experience_kind_id === null) {
    found.push(`${kind.slug} is a live kind of place and names no experience_kind_id`);
  }
  if (kind.status === 'live' && kind.form !== 'place' && kind.experience_kind_id !== null) {
    found.push(`${kind.slug} holds a ${kind.form} and names experience_kind_id ${kind.experience_kind_id}: only a kind of place has a catalogue kind`);
  }
  return found;
}

function checkKinds(rows: Row<CoverageKind>[], problems: string[]): Map<string, CoverageKind> {
  const bySlug = new Map<string, Row<CoverageKind>>();
  const byCatalogueKind = new Map<number, Row<CoverageKind>>();
  for (const row of rows) {
    const { value: kind, line } = row;
    const at = `kinds.jsonl line ${line}`;
    // What a record says against itself is checked whatever it clashes with, so
    // one pass over the problems fixes the record.
    problems.push(...checkKind(kind).map(problem => `${at}: ${problem}`));
    const first = bySlug.get(kind.slug);
    if (first) {
      // The second record of a slug registers nothing and claims no catalogue kind.
      problems.push(`${at}: slug ${kind.slug} is already used on line ${first.line}`);
      continue;
    }
    bySlug.set(kind.slug, row);
    if (kind.experience_kind_id !== null) {
      const claimed = byCatalogueKind.get(kind.experience_kind_id);
      if (claimed) {
        problems.push(`${at}: experience_kind_id ${kind.experience_kind_id} is already claimed by ${claimed.value.slug} on line ${claimed.line}`);
      } else {
        byCatalogueKind.set(kind.experience_kind_id, row);
      }
    }
  }
  return new Map([...bySlug].map(([key, row]) => [key, row.value]));
}

/** What one entry says against the register and against itself. */
function checkEntry(entry: CoverageExpectation, kinds: Map<string, CoverageKind>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const kindSlug of entry.kinds) {
    if (seen.has(kindSlug)) {
      found.push(`${entry.slug} is filed under ${kindSlug} twice`);
      continue;
    }
    seen.add(kindSlug);
    const kind = kinds.get(kindSlug);
    if (!kind) {
      found.push(`${entry.slug} is filed under ${kindSlug}, which the register does not have`);
    } else if (kind.form !== entry.type) {
      found.push(`${entry.slug} is a ${entry.type} and ${kindSlug} holds a ${kind.form}`);
    }
  }
  if (entry.unesco !== null && !seen.has(WORLD_HERITAGE)) {
    found.push(`${entry.slug} carries a UNESCO id and is not filed under ${WORLD_HERITAGE}`);
  }
  if (entry.unesco === null && seen.has(WORLD_HERITAGE)) {
    found.push(`${entry.slug} is filed under ${WORLD_HERITAGE} and carries no UNESCO id`);
  }
  if ((entry.lat === null) !== (entry.lon === null)) {
    found.push('lat and lon are given together or not at all');
  }
  if (entry.venue !== null && entry.type !== 'work') {
    found.push(`${entry.slug} names a venue and is not a work`);
  }
  return found;
}

function checkList(file: string, rows: Row<CoverageExpectation>[], kinds: Map<string, CoverageKind>, problems: string[]): CoverageExpectation[] {
  const slugs = new Map<string, number>();
  const identities = new Map<string, Row<CoverageExpectation>>();
  const kept: CoverageExpectation[] = [];
  for (const row of rows) {
    const { value: entry, line } = row;
    const at = `${file} line ${line}`;
    // An entry is checked against the register whatever it clashes with, so one
    // pass over the problems fixes the line.
    const own = checkEntry(entry, kinds).map(problem => `${at}: ${problem}`);
    const usedOn = slugs.get(entry.slug);
    if (usedOn !== undefined) {
      // The second entry of a slug claims no identity: a copied line is one problem, not two.
      problems.push(`${at}: slug ${entry.slug} is already used on line ${usedOn}`, ...own);
      continue;
    }
    slugs.set(entry.slug, line);
    // An entry's own ids are claimed together, so its `wikidata` repeated in its `same_as` is not a clash.
    // A UNESCO id is claimed too: it names the inscribed property itself, and two entries with one
    // would count that property twice.
    const ids = [...new Set([
      ...(entry.wikidata ? [entry.wikidata] : []),
      ...entry.same_as,
      ...(entry.unesco ? [`UNESCO id ${entry.unesco}`] : []),
    ])];
    const clash = ids.map(id => ({ id, owner: identities.get(id) })).find(({ owner }) => owner !== undefined);
    if (clash?.owner) {
      problems.push(`${at}: ${clash.id} is already the identity of ${clash.owner.value.slug} on line ${clash.owner.line}`, ...own);
      continue;
    }
    for (const id of ids) identities.set(id, row);
    problems.push(...own);
    kept.push(entry);
  }
  return kept;
}

/**
 * Read `dir` (the checkout's `db/catalogue-coverage`) whole.
 *
 * @throws CoverageFilesError naming every problem, when there is one.
 */
export function readCoverageFiles(dir: string): CoverageFiles {
  const problems: string[] = [];
  const kindRows = readLines(dir, 'kinds.jsonl', kindSchema, problems);
  const kinds = checkKinds(kindRows, problems);
  const regionRows = readLines(dir, 'regions.jsonl', regionSchema, problems);

  const listsDir = join(dir, 'expectations');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's directory and a name this module spells
  const listFiles = existsSync(listsDir)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above
    ? readdirSync(listsDir).filter(name => name.endsWith('.jsonl')).sort()
    : [];

  const regions = new Map<string, CoverageRegion>();
  for (const { value: region, line } of regionRows) {
    if (regions.has(region.slug)) {
      problems.push(`regions.jsonl line ${line}: slug ${region.slug} is already used`);
      continue;
    }
    regions.set(region.slug, region);
    if (!listFiles.includes(`${region.slug}.jsonl`)) {
      problems.push(`regions.jsonl line ${line}: ${region.slug} has no expectations/${region.slug}.jsonl`);
    }
  }

  const expectations = new Map<string, CoverageExpectation[]>();
  for (const name of listFiles) {
    const regionSlug = name.slice(0, -'.jsonl'.length);
    const file = `expectations/${name}`;
    // A list is read and checked whether or not a region names it: its wrong
    // lines are problems of the same pass. Only a named region's list is returned.
    const entries = checkList(file, readLines(dir, file, expectationSchema, problems), kinds, problems);
    if (regions.has(regionSlug)) {
      expectations.set(regionSlug, entries);
    } else {
      problems.push(`${file}: no region ${regionSlug} in regions.jsonl`);
    }
  }

  if (problems.length > 0) throw new CoverageFilesError(problems);
  return { kinds: kindRows.map(row => row.value), regions: [...regions.values()], expectations };
}
