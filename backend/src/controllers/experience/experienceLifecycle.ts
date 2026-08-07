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
 *
 * One of an experience's *locations* is filtered on `missing_since` even so —
 * `offeredLocationSql` below says why the two are not the same question.
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
 * Hides a row this category's own rule turned down (ADR-0024). `alias` is the
 * `experiences` alias in the query.
 *
 * A separate fragment from `hideLostSql` rather than one combined predicate,
 * because the two hide for unrelated reasons and are asked for separately: the
 * "show what is gone" affordance wants lost rows back, the curation queue wants
 * refused ones, and neither wants the other.
 *
 * It applies where `missing_since` deliberately does not, and the difference is
 * the difference between silence and a sentence. A run that stops seeing an
 * object may simply not have looked everywhere, so the note above leaves that
 * to a curator. A refusal is our own rule naming the object and turning it
 * down; re-running it gives the same answer, and a candidate that fails the
 * same rule is never created at all. A row that predates the rule has to end up
 * where a new one would, or the catalogue becomes the union of every rule the
 * importer has ever had — which is how a collection nobody calls the "Egyptian
 * Museum of Berlin" survived into a list of top art museums.
 *
 * Visits are untouched, as under ADR-0022. Someone who stood in the British
 * Museum stood in it, and that record cannot depend on which of our categories
 * currently claims the building.
 */
export function hideRefusedSql(alias = 'e'): string {
  return `${alias}.admission <> 'refused'`;
}

/**
 * Hides a point the source has stopped offering. `alias` is the
 * `experience_locations` alias.
 *
 * A location's `missing_since` is read here where an experience's is not, and
 * the reason is what the alternative used to be: a withdrawn point was
 * *deleted*, so it left every list and every map the moment a run stopped
 * seeing it. The row survives now — deleting it took the visit record with it
 * through the cascade — and this fragment keeps what a reader sees exactly as
 * it was. Nothing here is a verdict on the place; that question is still a
 * curator's, and the row is waiting for it.
 *
 * The line is not "visits are exempt", which would be the obvious reading and
 * is wrong. It runs between two kinds of statement:
 *
 * - **what a reader asked for, exactly as they asked** — recording a visit,
 *   and removing one — is unfiltered. The first because they are acting on
 *   what they were just shown; the second because a record on an invisible
 *   point could otherwise never be cleared. The lookup that resolves which
 *   experience a visit belonged to goes with them.
 * - **what the system decides on their behalf** carries the filter: every read
 *   that puts a point on screen, the per-user visited status included, and
 *   equally the count that infers from what remains whether the
 *   experience-level record should go. Both unmark handlers therefore hold an
 *   unfiltered DELETE and a filtered count, which is not an inconsistency but
 *   this line drawn through one handler.
 *
 * The per-user visited status is the case that shows why: a corrected
 * coordinate is a withdrawal plus an insert, so leaving withdrawn rows in
 * would put the same place on screen twice and disagree with every other count
 * of it.
 *
 * Region placement applies the same predicate as a literal
 * (`regionAssignmentService.ts`) rather than calling this. It is in the service
 * layer, and importing a controller module there would be the first such import
 * in the codebase — a worse trade than one repeated predicate, which is why the
 * duplication is deliberate and noted at both sites.
 */
export function offeredLocationSql(alias = 'el'): string {
  return `${alias}.missing_since IS NULL`;
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
