/**
 * What an experience's lifecycle means to the people looking at it.
 *
 * The two axes are set by curators (ADR-0020, narrowed by ADR-0021) and read
 * here. They are not symmetric, because the reasons behind them are not:
 *
 * - `former` — the source stopped listing it, but it is still standing. You can
 *   still go there, so it stays in every list and on the map; the card says so
 *   with a chip and nothing else changes.
 * - `lost` — it no longer exists. Offering it as somewhere to go would be a
 *   lie, so it leaves lists, map, search and counts. It does *not* leave a
 *   visit: someone who saw Palmyra before 2015 saw it, and a record of that
 *   cannot depend on the thing still standing.
 *
 * An object carrying only `missing_since` — flagged by a run, not yet judged —
 * looks completely ordinary here. That is the point of leaving both verdicts to
 * a curator: a source outage must not change what anyone sees.
 */

/**
 * Hides `lost` objects. `alias` is the `experiences` alias in the query.
 *
 * Written as a fragment rather than a boolean because it has to go into a
 * dozen queries that already build their WHERE by concatenation, and the one
 * that forgets it is the one that offers a demolished building as a
 * destination. Returned bare, without a leading `AND`: some callers push it
 * into a conditions array and some append it to a WHERE, and a fragment that
 * suits one reads wrong in the other.
 */
export function hideLostSql(alias = 'e'): string {
  return `${alias}.existence <> 'lost'`;
}

/**
 * Columns a card needs to label what it is showing.
 *
 * `existence` travels even where `lost` rows are filtered out: the same select
 * feeds visit history, where they are not. `missing_since` travels for a
 * different reason — a curator correcting a verdict has to send the row as they
 * saw it, flag included, and inferring it from the verdict would be an
 * assumption where the truth is one column away.
 */
export function lifecycleSelectSql(alias = 'e'): string {
  return `${alias}.source_membership, ${alias}.existence, ${alias}.missing_since`;
}

/**
 * Should this request see objects that no longer exist?
 *
 * Only when it asks — `?includeLost=true` — and the ask is meaningful in
 * exactly two places: a visit history, and a list a user has deliberately
 * unfiltered. Everywhere else the parameter is simply absent, which is the
 * safe default rather than a policy each caller has to remember.
 */
export function includeLost(query: Record<string, unknown>): boolean {
  return query.includeLost === 'true' || query.includeLost === true;
}
