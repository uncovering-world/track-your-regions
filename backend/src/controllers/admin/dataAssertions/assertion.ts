/**
 * How a violating row's values are read into the sentence the panel shows.
 *
 * `varchar` and `text` come back as strings and a null name is an empty one —
 * and every one of these names came from outside. UNESCO's export and
 * Wikidata's labels are what an object and a place are called here, and
 * Wikidata is a wiki: anybody may edit a label. The panel renders these
 * sentences as React children, so markup in a name is inert there; what is not
 * inert is where a sentence goes *next*. It is built here, travels as JSON, and
 * ends up in server logs, in a copied line pasted into a terminal, and in
 * whatever a future surface does with it — and a name carrying a newline splits
 * one claim into two, while an escape sequence takes over whatever is printing
 * it. So control characters become spaces before the value is ever
 * concatenated: the repository's rule about rendering external data, applied at
 * the point where the text is made rather than at each place it is shown.
 *
 * Shared by every file of assertions, so there is one place that knows how a
 * row is read -- and one place that says what an assertion is, so a file of
 * rules and the registry that lists them need not import each other.
 */

/** A row of a violation, as `pg` hands it back. */
export type AssertionRow = Record<string, unknown>;

export interface CatalogueAssertion {
  /**
   * Stable across runs and across a rename of the sentence beside it, so two
   * reports of the same database can be compared by something other than
   * prose.
   */
  id: string;
  /**
   * What the assertion is about, so a growing list stays readable.
   *
   * A report of five lines needs no headings and a report of forty does, and
   * the second is where this is going: every new kind of data brings rules of
   * its own. Grouping by subject also puts the assertions that would fail
   * *together* -- a bad placement run breaks several at once -- next to each
   * other, where a person can see them as one event rather than five.
   */
  area: 'places' | 'regions' | 'pictures';
  /** What must be true, in the words of the thing rather than of a rule. */
  title: string;
  /**
   * Zero rows, or a number to watch?
   *
   * `invariant` -- nothing may match, and rows nobody has accepted a number for
   * are what the panel asks a person to answer. A matching invariant standing
   * at its accepted number asks nothing: that is debt this catalogue is
   * knowingly carrying, and only a count above it is news.
   * `watch` -- matching rows are expected to exist and the *count* is what
   * carries the meaning, so it is never something to answer for and cannot be
   * accepted. Rows reach that state two unrelated ways: legitimate by a
   * decision (ADR-0022 -- a point a source dropped keeps the tick a traveller
   * earned), or legitimate by geography (a scattered territory's box centre is
   * open water, and the frame is right). What they share is that there is
   * nothing to answer for, and that a number moving is the news.
   */
  kind: 'invariant' | 'watch';
  /** What a matching row means, and who has to do what about it. */
  meaning: string;
  sql: string;
  /** One matching row, said the way a person would say it. */
  describe: (row: AssertionRow) => string;
}

export const text = (row: AssertionRow, key: string): string =>
  String(row[key] ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

/** `int4` comes back as a number, `count(*)` as a string. Both survive this. */
export const count = (row: AssertionRow, key: string): number => Number(row[key] ?? 0);
