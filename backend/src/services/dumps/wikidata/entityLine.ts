/**
 * What a line of Wikidata's JSON dump says, read without parsing it (#1434).
 * A pass over the whole dump reads about 1.5 TB of JSON: `JSON.parse` takes
 * that at about 90 MB/s, a scan for the main snaks at over 1 GB/s (measured on
 * the 2026-10-05 dump). The first pass, which decides what the subset keeps,
 * only needs which item a line is, whether it has a coordinate or is a class,
 * and which items its statements name, so it scans.
 *
 * The scan leans on how the dump writes a line, which the parsing pass and
 * the specs hold it to: one entity per line, `type` then `id` first (a
 * property's `datatype` between them), every
 * non-ASCII character escaped, and a statement's main snak written as
 * `"mainsnak":{"snaktype":"value","property":"P31","datavalue":{"value":{"entity-type":"item","numeric-id":5,...`
 * with no `hash`, which a qualifier's or a reference's snak always carries.
 * So a match is a statement's own value, never a qualifier's.
 *
 * What this reads decides the subset's scope, so a change to it raises
 * `SCOPE_VERSION` (`scopeFile.ts`), or a kept first-pass result is reused.
 */

export type EntityKind = 'item' | 'property';

export interface EntityRef {
  kind: EntityKind;
  /** The number of `Q42` or `P31`. */
  id: number;
}

// A property's line names its datatype between the two: `{"type":"property","datatype":"wikibase-item","id":"P19",...`.
const HEAD = /^\{"type":"(item|property)",(?:"datatype":"[^"]*",)?"id":"[QP](\d+)"/;
const MAIN_ITEM_VALUE =
  /"mainsnak":\{"snaktype":"value","property":"P(\d+)","datavalue":\{"value":\{"entity-type":"item","numeric-id":(\d+)/g;

/** The entity a line holds, or null for the array's brackets and anything else. */
export function entityOf(line: string): EntityRef | null {
  const head = HEAD.exec(line);
  return head ? { kind: head[1] as EntityKind, id: Number(head[2]) } : null;
}

/** Calls `visit` with every item a statement of the line names, at any rank. */
export function forEachMainItemValue(line: string, visit: (property: number, item: number) => void): void {
  MAIN_ITEM_VALUE.lastIndex = 0;
  for (let match = MAIN_ITEM_VALUE.exec(line); match; match = MAIN_ITEM_VALUE.exec(line)) {
    visit(Number(match[1]), Number(match[2]));
  }
}

/** Whether a statement of the line has a value for `property` (`P625`), at any rank. */
export function hasMainValue(line: string, property: number): boolean {
  return line.includes(`"mainsnak":{"snaktype":"value","property":"P${property}"`);
}

/** The line without the comma the dump puts after every entity but the last. */
export function entityJson(line: string): string {
  return line.endsWith(',') ? line.slice(0, -1) : line;
}
