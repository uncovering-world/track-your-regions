/**
 * The catalogue-coverage files, read and held to their format (ADR-0081).
 *
 * `db/catalogue-coverage/` holds the register of kinds of experience, the surveyed
 * regions, per region the list of what a traveller expects there, the ledger of
 * the gaps between the lists and the catalogue that a person has judged (ADR-0116),
 * and per live kind the calibration list of the tops a traveller expects of it, with
 * the register of the reference lists that name them (#1864). The files are
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
  /**
   * True when a member exists only inside a place: a work shown there, the climb of its dome.
   * A traveller finds it on the place's card and never browses a region by it.
   */
  in_venue: z.boolean(),
});

const regionSchema = z.strictObject({
  slug,
  name: text,
  country: text,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radius_km: z.number().positive(),
  surveyed: z.iso.date(),
  // A control region (#2232): surveyed so that an admission rule can be verified on a list no
  // tuning has read. Absent for an ordinary region. The reader carries the mark for what reads
  // the files (the review's harness); the loader and the report ignore it, since the catalogue's
  // own coverage figures are not tuning.
  role: z.enum(['control']).optional(),
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
  /** The place a work is shown in, or an activity or an event is held at, in words. */
  venue: text.nullable(),
  /** How many independent sources named it. Which ones is not published. */
  sources: z.number().int().min(2, 'an entry counts when two or more sources name it'),
  /** Sitelinks and coordinates as Wikidata gave them on the region's survey date. */
  sitelinks: z.number().int().min(0).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  note: z.string(),
});

/**
 * Why a gap stands, or why a row stays (ADR-0116). Closed, so the report can count by it; a cause
 * that fits none of these is a reason to extend the vocabulary in a pull request, never a
 * free-text cause.
 */
export const CAUSES = CHECK_VALUES.coverage_judgements.cause;
export type Cause = (typeof CAUSES)[number];

/** The causes that name their owner: a defect is fixed somewhere, a door is built somewhere. */
export const OWNED_CAUSES: ReadonlySet<Cause> = new Set<Cause>(['rule-defect', 'door-missing']);

/**
 * What a catalogue row may be judged (#1601). An offered row has no door, kind, part or other
 * kind to wait on: it is worth a visit, not a must, or a rule's defect. The schema's
 * `coverage_judgements_row_causes` states the same set.
 */
export const ROW_CAUSES: ReadonlySet<Cause> = new Set<Cause>(['worth-a-visit', 'not-a-must', 'rule-defect']);

/** The one cause only a row takes: an entry a kind lacks is a gap, never a thing worth a visit. */
const ROW_ONLY_CAUSE: Cause = 'worth-a-visit';

const judgementSchema = z.strictObject({
  region: slug,
  /** The entry of the region's list a live kind does not offer; null when the subject is a catalogue row. */
  entry: slug.nullable(),
  /**
   * The live kind whose gap is judged: the entry is filed under it and it does not offer the entry.
   * An entry filed under two live kinds has a gap, and a line, per kind. Null on a catalogue row.
   */
  kind: slug.nullable(),
  /**
   * A catalogue row the region offers within its reach and no entry names (#1601), by its Wikidata
   * id; null when the subject is an entry. A row is judged once per region, whatever kinds offer it.
   */
  row: wikidataId.nullable(),
  cause: z.enum(CAUSES),
  /** The issue that owns the cause, where one does. A defect and a door name theirs. */
  issue: z.number().int().positive().nullable(),
  /** The date the judgement was made, which is the date of the catalogue it was made against. */
  judged: z.iso.date(),
  /** Why, in a sentence a later reader can check. */
  note: text,
});

/** A reference list a calibration entry is named by: a federation's members, a heritage list, the surveys. */
const calibrationSourceSchema = z.strictObject({
  slug,
  name: text,
  /** Where the list is read, or null for one assembled here, such as the coverage surveys. */
  url: z.url().nullable(),
  /** The date the list was read, which is the date of the membership it states. */
  read: z.iso.date(),
  note: z.string(),
});

/**
 * One top a traveller expects of a kind (#1864). Identified by its Wikidata item, never
 * by name; `sources` names which reference lists call it a top, so the report can say
 * how many of each list's members the kind offers.
 */
const calibrationEntrySchema = z.strictObject({
  slug,
  name: text,
  wikidata: wikidataId,
  sources: z.array(slug).min(1, 'an entry names the reference list that calls it a top'),
  /** Sitelinks as Wikidata gave them when the list was compiled, so an absent top under the kind's editions line is told from one its classes do not reach. */
  sitelinks: z.number().int().min(0).nullable(),
  note: z.string(),
});

export type CoverageKind = z.infer<typeof kindSchema>;
export type CoverageRegion = z.infer<typeof regionSchema>;
export type CoverageExpectation = z.infer<typeof expectationSchema>;
export type CoverageJudgement = z.infer<typeof judgementSchema>;
export type CalibrationSource = z.infer<typeof calibrationSourceSchema>;
export type CalibrationEntry = z.infer<typeof calibrationEntrySchema>;

export interface CoverageFiles {
  kinds: CoverageKind[];
  regions: CoverageRegion[];
  /** Each region's list, by the region's slug, in file order. */
  expectations: Map<string, CoverageExpectation[]>;
  /** The judgement ledger, in file order; empty when there is no `judgements.jsonl`. */
  judgements: CoverageJudgement[];
  /** The reference lists the calibration entries are named by; empty when there is no `calibration-sources.jsonl`. */
  calibrationSources: CalibrationSource[];
  /** Each live kind's calibration list, by the kind's slug, in file order; a kind with no list is absent. */
  calibration: Map<string, CalibrationEntry[]>;
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

/**
 * One file's lines, each parsed and held to `schema`; a line that fails is reported and left out.
 * A missing file is a problem, unless the file is one the directory may do without (`optional`).
 */
function readLines<T>(dir: string, file: string, schema: z.ZodType<T>, problems: string[], optional = false): Row<T>[] {
  const path = join(dir, file);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's directory and a name this module spells or lists from it
  if (!existsSync(path)) {
    if (!optional) problems.push(`${file}: the file is missing`);
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
    } else if (kind.in_venue && entry.venue === null) {
      found.push(`${entry.slug} is filed under ${kindSlug}, which exists only inside a place, and names no venue`);
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
  // A place is where it is. Anything else may be shown or held at one.
  if (entry.venue !== null && entry.type === 'place') {
    found.push(`${entry.slug} is a place and names a venue`);
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

/** What a judgement on an entry says against the lists: the entry exists, and the kind is live and holds it. */
function checkJudgedEntry(judgement: CoverageJudgement, kinds: Map<string, CoverageKind>, entries: CoverageExpectation[]): string[] {
  const entry = entries.find(candidate => candidate.slug === judgement.entry);
  if (!entry) return [`${judgement.region} has no entry ${judgement.entry}`];
  if (judgement.kind === null) return [`${judgement.entry} names no kind: a gap is an entry and the live kind that does not offer it`];
  const kind = kinds.get(judgement.kind);
  if (!kind) return [`${judgement.entry} is judged under ${judgement.kind}, which the register does not have`];
  if (kind.status !== 'live') return [`${judgement.entry} is judged under ${judgement.kind}, which is only proposed: a gap is a live kind's`];
  if (!entry.kinds.includes(judgement.kind)) return [`${judgement.entry} is not filed under ${judgement.kind}`];
  return [];
}

/**
 * What one judgement says against the lists and against itself: it names one subject, an entry
 * of a list a region has with the live kind that lacks it, or a catalogue row on its own; and a
 * cause that has an owner names it.
 */
function checkJudgement(
  judgement: CoverageJudgement,
  kinds: Map<string, CoverageKind>,
  regions: Map<string, CoverageRegion>,
  expectations: Map<string, CoverageExpectation[]>,
): string[] {
  const found: string[] = [];
  if ((judgement.entry === null) === (judgement.row === null)) {
    found.push('a judgement names an entry or a catalogue row, one of the two');
  }
  if (judgement.row !== null && judgement.kind !== null) {
    found.push(`${judgement.row} is a catalogue row and names a kind: a row is judged on its own, not under a kind`);
  }
  if (judgement.row !== null && !ROW_CAUSES.has(judgement.cause)) {
    found.push(`${judgement.row} is a catalogue row judged ${judgement.cause}: an offered row waits on no door, kind, part or other kind; it is worth a visit, not a must, or a rule's defect`);
  }
  if (judgement.entry !== null && judgement.cause === ROW_ONLY_CAUSE) {
    found.push(`${judgement.entry} is an entry judged ${ROW_ONLY_CAUSE}: a gap a kind has is never worth a visit`);
  }
  if (OWNED_CAUSES.has(judgement.cause) && judgement.issue === null) {
    found.push(`${judgement.cause} names the issue that owns it`);
  }
  if (!regions.has(judgement.region)) {
    found.push(`no region ${judgement.region} in regions.jsonl`);
  } else if (judgement.entry !== null) {
    found.push(...checkJudgedEntry(judgement, kinds, expectations.get(judgement.region) ?? []));
  }
  return found;
}

/** Each judgement held to `checkJudgement`, and no gap judged twice. */
function checkJudgements(
  rows: Row<CoverageJudgement>[],
  kinds: Map<string, CoverageKind>,
  regions: Map<string, CoverageRegion>,
  expectations: Map<string, CoverageExpectation[]>,
  problems: string[],
): CoverageJudgement[] {
  const subjects = new Map<string, number>();
  const kept: CoverageJudgement[] = [];
  for (const { value: judgement, line } of rows) {
    const at = `judgements.jsonl line ${line}`;
    // A judgement is checked whatever it clashes with, so one pass over the problems fixes the line.
    const own = checkJudgement(judgement, kinds, regions, expectations);
    const subject = judgement.entry === null ? judgement.row ?? '' : `${judgement.entry} under ${judgement.kind}`;
    const key = `${judgement.region}\n${subject}`;
    const usedOn = subjects.get(key);
    if (usedOn !== undefined) {
      problems.push(`${at}: ${subject} of ${judgement.region} is already judged on line ${usedOn}`, ...own.map(problem => `${at}: ${problem}`));
      continue;
    }
    subjects.set(key, line);
    problems.push(...own.map(problem => `${at}: ${problem}`));
    kept.push(judgement);
  }
  return kept;
}

/** The reference lists, each slug once. */
function checkCalibrationSources(rows: Row<CalibrationSource>[], problems: string[]): Map<string, CalibrationSource> {
  const sources = new Map<string, Row<CalibrationSource>>();
  for (const row of rows) {
    const first = sources.get(row.value.slug);
    if (first) {
      problems.push(`calibration-sources.jsonl line ${row.line}: slug ${row.value.slug} is already used on line ${first.line}`);
      continue;
    }
    sources.set(row.value.slug, row);
  }
  return new Map([...sources].map(([key, row]) => [key, row.value]));
}

/**
 * One kind's calibration list (#1864): the file is named by a live kind of place or of
 * work (#1988: a work's fame line admits the venue that shows it), each entry is one item
 * once, and each entry names reference lists the register has.
 */
function checkCalibrationList(
  file: string, kindSlug: string, rows: Row<CalibrationEntry>[],
  kinds: Map<string, CoverageKind>, sources: Map<string, CalibrationSource>, problems: string[],
): CalibrationEntry[] {
  const kind = kinds.get(kindSlug);
  if (!kind) {
    problems.push(`${file}: no kind ${kindSlug} in kinds.jsonl`);
  } else if (kind.status !== 'live') {
    problems.push(`${file}: ${kindSlug} is only proposed: a fame line is a live kind's to calibrate`);
  } else if (kind.form !== 'place' && kind.form !== 'work') {
    problems.push(`${file}: ${kindSlug} is a kind of ${kind.form}: a calibration list names places or works, by their Wikidata items`);
  }
  const slugs = new Map<string, number>();
  const items = new Map<string, Row<CalibrationEntry>>();
  const kept: CalibrationEntry[] = [];
  for (const row of rows) {
    const { value: entry, line } = row;
    const at = `${file} line ${line}`;
    const own: string[] = [];
    const seen = new Set<string>();
    for (const source of entry.sources) {
      if (seen.has(source)) own.push(`${at}: ${entry.slug} names ${source} twice`);
      else if (!sources.has(source)) own.push(`${at}: ${entry.slug} names ${source}, which calibration-sources.jsonl does not have`);
      seen.add(source);
    }
    const usedOn = slugs.get(entry.slug);
    if (usedOn !== undefined) {
      // The second entry of a slug claims no item: a copied line is one problem, not two.
      problems.push(`${at}: slug ${entry.slug} is already used on line ${usedOn}`, ...own);
      continue;
    }
    slugs.set(entry.slug, line);
    const owner = items.get(entry.wikidata);
    if (owner) {
      problems.push(`${at}: ${entry.wikidata} is already the item of ${owner.value.slug} on line ${owner.line}`, ...own);
      continue;
    }
    items.set(entry.wikidata, row);
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

  // The ledger is read after the lists, since a judgement names an entry of one; a directory
  // with no ledger yet has judged nothing.
  const judgements = checkJudgements(readLines(dir, 'judgements.jsonl', judgementSchema, problems, true), kinds, regions, expectations, problems);

  // The calibration lists (#1864): the register of reference lists first, since an entry
  // names one; a directory with no lists has calibrated nothing, and may do without the register.
  const calibrationDir = join(dir, 'calibration');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's directory and a name this module spells
  const calibrationFiles = existsSync(calibrationDir)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above
    ? readdirSync(calibrationDir).filter(name => name.endsWith('.jsonl')).sort()
    : [];
  const sourceRows = readLines(dir, 'calibration-sources.jsonl', calibrationSourceSchema, problems, calibrationFiles.length === 0);
  const calibrationSources = checkCalibrationSources(sourceRows, problems);
  const calibration = new Map<string, CalibrationEntry[]>();
  for (const name of calibrationFiles) {
    const kindSlug = name.slice(0, -'.jsonl'.length);
    const file = `calibration/${name}`;
    calibration.set(kindSlug, checkCalibrationList(file, kindSlug, readLines(dir, file, calibrationEntrySchema, problems), kinds, calibrationSources, problems));
  }

  if (problems.length > 0) throw new CoverageFilesError(problems);
  return {
    kinds: kindRows.map(row => row.value),
    regions: [...regions.values()],
    expectations,
    judgements,
    calibrationSources: sourceRows.map(row => row.value),
    calibration,
  };
}
