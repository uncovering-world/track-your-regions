/**
 * What must be true of the place identifier registry (ADR-0143 decision 2,
 * #1892): an identifier names one live place, and the registry says what the
 * columns that carry identifiers say.
 *
 * The registry is derived, by `place_identifiers_expected()` in the schema,
 * from a membership's external id and items, a component point's item and a
 * part's reference, and kept current by triggers on those tables. These rules
 * read the schema's own functions, so a check cannot mean "identifies"
 * differently from the registry it checks.
 */

import { count, text } from './assertion.js';
import type { CatalogueAssertion } from './assertion.js';

/**
 * Two live places that each claim one identifier.
 *
 * A value is identifying on a place only where no other live place's claim
 * says it is that place too; where two do, both hold it as only referring, so
 * a run's lookup follows it to neither. Such a value is a duplicate, such as
 * the Tower of Belem as a part of the Jeronimos site and as a tower, or a
 * part whose reference is its site's own. The registry reports it and never
 * merges it; the Wikidata rows are what the join after a run and after a
 * component-items answer makes one place (`joinPlacesClaimingOneItem`,
 * `controllers/experience/equalItemMerges.ts`), so the two ask one question,
 * and what is listed is a pair the join refused, one a curator took apart,
 * which the join never touches again, or a World Heritage reference — each
 * waiting for a person.
 */
const identifiersOnSeveralPlaces: CatalogueAssertion = {
  id: 'identifiers-on-several-places',
  area: 'objects',
  title: 'An identifier that two places claim',
  kind: 'invariant',
  meaning:
    'Two places each say they are the same Wikidata item or World Heritage reference, so one thing '
    + 'is most likely shown twice: two pins on one spot, two cards that each tell half of it. Until '
    + 'it is settled, a run reading that identifier finds neither place. Two places claiming one Wikidata '
    + 'item are joined by the catalogue after a run and after a component-items answer, so a Wikidata row '
    + 'here is a pair that join refused, such as two places in one kind, or one a curator took apart, which '
    + 'the join never touches again. Merging the two settles it; so does taking the identifier off the place '
    + 'it does not name.',
  sql: `SELECT pi.scheme, pi.value,
               array_agg(pi.experience_id ORDER BY pi.experience_id) AS place_ids,
               array_agg(e.name ORDER BY pi.experience_id) AS names
          FROM place_identifiers pi
          JOIN experiences e ON e.id = pi.experience_id
         WHERE pi.claims_identity AND NOT pi.identifies
         GROUP BY pi.scheme, pi.value
        HAVING count(*) > 1
         ORDER BY (array_agg(e.name ORDER BY pi.experience_id))[1], pi.value`,
  describe: row => {
    // Names come from outside; each is read as `text` reads a column.
    const list = (key: string) => (Array.isArray(row[key])
      ? (row[key] as unknown[]).map(one => text({ one }, 'one')) : []);
    const scheme = text(row, 'scheme') === 'whc' ? 'World Heritage reference' : 'Wikidata item';
    return `${list('names').join(' / ')} (${scheme} ${text(row, 'value')}): places ${list('place_ids').join(', ')}`;
  },
};

/**
 * A registry row that its columns no longer derive, or a value they derive
 * that the registry lacks.
 *
 * Nothing writes the registry but its refresh, which the triggers on the
 * carrying tables call; a write that skipped them (a trigger disabled for a
 * bulk load, a session replaying as a replica) leaves it out of step, and a
 * run's lookup would then follow a stale row. The expected rows are the
 * refresh's own (`place_identifiers_expected()`), over every value a column
 * carries (`place_identifier_values()`) and every value the registry holds.
 */
const placeIdentifiersOutOfStep: CatalogueAssertion = {
  id: 'place-identifiers-out-of-step',
  area: 'objects',
  title: 'A place identifier the registry holds differently from its columns',
  kind: 'invariant',
  meaning:
    'The registry of place identifiers is derived from the places\' memberships, points and parts, and '
    + 'this row disagrees with them: a write skipped the triggers that keep it current. A run looking a '
    + 'place up by this identifier would follow the stale row. Refreshing the value '
    + '(SELECT refresh_place_identifiers(scheme, ARRAY[value])) brings it back in step.',
  sql: `WITH vals AS (
          SELECT v.scheme, array_agg(DISTINCT v.value) AS values
            FROM (SELECT scheme, value FROM place_identifier_values()
                  UNION SELECT scheme, value FROM place_identifiers) v
           GROUP BY v.scheme
        ), expected AS (
          SELECT vals.scheme, x.* FROM vals
           CROSS JOIN LATERAL place_identifiers_expected(vals.scheme, vals.values) x
        )
        SELECT COALESCE(x.scheme, pi.scheme) AS scheme, COALESCE(x.value, pi.value) AS value,
               COALESCE(x.experience_id, pi.experience_id) AS place_id,
               x.identifies AS expected_identifies, pi.identifies AS held_identifies
          FROM expected x
          FULL JOIN place_identifiers pi
            ON pi.scheme = x.scheme AND pi.value = x.value AND pi.experience_id = x.experience_id
         WHERE x.experience_id IS NULL OR pi.experience_id IS NULL
            OR (x.identifies, x.claims_identity, x.basis) IS DISTINCT FROM (pi.identifies, pi.claims_identity, pi.basis)
         ORDER BY 1, 2, 3`,
  describe: row => {
    const held = row.held_identifies;
    const expected = row.expected_identifies;
    const state = (v: unknown) => {
      if (v === null || v === undefined) return 'absent';
      return v ? 'identifying' : 'referring';
    };
    return `${text(row, 'scheme')} ${text(row, 'value')} on place ${text(row, 'place_id')}: `
      + `held ${state(held)}, its columns make it ${state(expected)}`;
  },
};

/**
 * A registered item Wikidata has since redirected to another.
 *
 * The kept redirects (`workbench.wikidata_redirects`, the `wikidata-redirects`
 * keeper) widen every lookup, so a run reading the target still finds the
 * place, and the next run of a Wikidata source moves its membership's key to
 * the target. What stays registered under the old item is a World Heritage
 * site's items or a component point's item, which no run rewrites, and this
 * lists them for a curator. Empty until the keeper has built, since the table
 * is then empty.
 */
const identifiersRedirected: CatalogueAssertion = {
  id: 'identifiers-redirected',
  area: 'objects',
  title: 'A registered Wikidata item that Wikidata redirected to another',
  kind: 'invariant',
  meaning:
    'Wikidata merged this item into another since the place was registered under it. A run looking the '
    + 'place up follows the redirect, so nothing is lost, and a Wikidata source\'s next run moves its '
    + 'membership to the target by itself; a site\'s or a component\'s item is moved by a curator. Empty '
    + 'until the item redirects are built from the dump (Public Dumps).',
  sql: `SELECT pi.experience_id, e.name, pi.value, r.target
          FROM place_identifiers pi
          JOIN workbench.wikidata_redirects r ON r.source = pi.value
          JOIN experiences e ON e.id = pi.experience_id
         WHERE pi.scheme = 'wikidata'
         ORDER BY e.name, pi.value`,
  describe: row => `${text(row, 'name')} (#${count(row, 'experience_id')}): ${text(row, 'value')} redirects to ${text(row, 'target')}`,
};

/** The registry's rules: the duplicates it reports, its own drift, then the items Wikidata moved. */
export const identifierAssertions: CatalogueAssertion[] = [
  identifiersOnSeveralPlaces,
  placeIdentifiersOutOfStep,
  identifiersRedirected,
];
