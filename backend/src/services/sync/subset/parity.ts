/**
 * The parity harness (#1458): the questions a run asked the live query
 * service and kept in `wikidata_query_cache`, asked again of the local
 * subset, with the answers compared by item id. A kind switches to the
 * subset when its questions agree, or when each difference is explained (the
 * dump's date against the cache's, an item outside the subset's scope).
 *
 * Each question shape the subset can answer has a reader: it recognises the
 * cached query text, takes what was asked out of it, and asks the subset's
 * twin. A shape with no reader yet is counted as not compared.
 */

import { pool } from '../../../db/index.js';
import { extractQid } from '../wikidataUtils.js';
import { subsetClassTree, subsetSubclasses, subsetWikipediaEditions } from './kit.js';

/** One question's answer as a set of keys: item ids, or `id=count` for a count. */
type Answer = Set<string>;

interface Shape {
  name: string;
  /** What was asked, from the cached query text, or null when the text is not this shape. */
  asked(query: string): string[] | null;
  /** The live answer, from the cached rows. */
  live(rows: Array<Record<string, { value: string }>>): Answer;
  subset(asked: string[]): Promise<Answer>;
}

const ITEMS = /wd:(Q\d+)/g;
const itemsIn = (text: string) => [...text.matchAll(ITEMS)].map(match => match[1]);
const column = (rows: Array<Record<string, { value: string }>>, name: string) =>
  new Set(rows.map(row => extractQid(row[name]?.value ?? '')).filter(Boolean));

export const SHAPES: Shape[] = [
  {
    name: 'class tree',
    asked: query => {
      const match = /\?c wdt:P279\* wd:(Q\d+)/.exec(query);
      return match ? [match[1]] : null;
    },
    live: rows => column(rows, 'c'),
    subset: async ([root]) => subsetClassTree(root),
  },
  {
    name: 'subclasses',
    asked: query => {
      const match = /VALUES \?p \{([^}]*)\}\s*\?c wdt:P279 \?p/.exec(query);
      return match ? itemsIn(match[1]) : null;
    },
    live: rows => column(rows, 'c'),
    subset: async parents => new Set(await subsetSubclasses(parents)),
  },
  {
    name: 'Wikipedia editions',
    asked: query => {
      if (!/wikibase:wikiGroup "wikipedia"/.test(query)) return null;
      const match = /VALUES \?e \{([^}]*)\}/.exec(query);
      return match ? itemsIn(match[1]) : null;
    },
    live: rows => new Set(rows.map(row => `${extractQid(row.e?.value ?? '')}=${row.editions?.value ?? '0'}`)),
    subset: async qids => new Set([...await subsetWikipediaEditions(qids)].map(([id, n]) => `${id}=${n}`)),
  },
];

export interface ShapeReport {
  shape: string;
  questions: number;
  agreeing: number;
  /** Keys the live service answered and the subset did not, and the other way round, with a few examples. */
  onlyLive: number;
  onlySubset: number;
  /** Cached questions of this shape past the limit, not compared. */
  skipped: number;
  examples: string[];
}

/**
 * Compare the newest `limit` cached questions of each shape the subset can
 * read, and count the rest. The query texts are read first and each answer
 * only when its question is compared, one at a time: a class tree's cached
 * answer runs to thousands of rows, and the cache holds every run's.
 */
export async function compareCached(limit = 200): Promise<{ reports: ShapeReport[]; notCompared: number }> {
  const cached = await pool.query<{ id: number; query_text: string }>(
    `SELECT id, query_text FROM wikidata_query_cache
      WHERE kind IN ('classes', 'edges') AND (expires_at > NOW() OR expires_at IS NULL) ORDER BY fetched_at DESC`,
  );
  const reports = new Map(SHAPES.map(shape => [shape.name, {
    shape: shape.name, questions: 0, agreeing: 0, onlyLive: 0, onlySubset: 0, skipped: 0, examples: [] as string[],
  }]));
  let notCompared = 0;
  for (const row of cached.rows) {
    const shape = SHAPES.find(candidate => candidate.asked(row.query_text) !== null);
    if (!shape) {
      notCompared += 1;
      continue;
    }
    const report = reports.get(shape.name)!;
    if (report.questions >= limit) {
      report.skipped += 1;
      continue;
    }
    const answer = await pool.query<{ result: Array<Record<string, { value: string }>> }>(
      'SELECT result FROM wikidata_query_cache WHERE id = $1', [row.id],
    );
    // Gone between the two reads: a run replaced or pruned it.
    if (!answer.rows[0]) continue;
    report.questions += 1;
    const live = shape.live(answer.rows[0].result);
    const local = await shape.subset(shape.asked(row.query_text)!);
    const onlyLive = [...live].filter(key => !local.has(key));
    const onlySubset = [...local].filter(key => !live.has(key));
    if (onlyLive.length === 0 && onlySubset.length === 0) report.agreeing += 1;
    report.onlyLive += onlyLive.length;
    report.onlySubset += onlySubset.length;
    if (report.examples.length < 10) report.examples.push(...[...onlyLive.map(k => `live only ${k}`), ...onlySubset.map(k => `subset only ${k}`)].slice(0, 3));
  }
  return { reports: [...reports.values()], notCompared };
}
