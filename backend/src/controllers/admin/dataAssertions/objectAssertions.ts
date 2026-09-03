/**
 * What must be true of an *object* — a World Heritage site, a museum, a work —
 * as a row, beside the region and boundary rules that have files of their own.
 *
 * The registry spreads this list; the type and the row helpers come from
 * `assertion.ts`, so this file and the registry do not import each other. The
 * tests live beside the rules, and `catalogueAssertions.test.ts` keeps only
 * what it asserts about the set as a whole.
 *
 * These rules ask the product's own question through the fragments the reads
 * compose (`heldDecisions.ts`), which is why they sit in the controller layer
 * with the registry rather than beside the sync services that write the rows.
 */

import { heldFieldAnsweredSql } from '../../experience/heldDecisions.js';
import { parseDangerListing } from '../../../services/sync/dangerListing.js';

import { count, text } from './assertion.js';
import type { CatalogueAssertion } from './assertion.js';

/**
 * One fact, stored twice, asked whether the two copies still agree.
 *
 * A World Heritage site in danger is written into the row as the `in_danger`
 * tag and as the `metadata.inDanger` flag the badge keys on. They came from
 * different halves of the source and disagreed on every row for four years: the
 * tag was right on 58 sites, the flag was false on all 1272, and the badge three
 * surfaces draw off the flag appeared for nobody (#600). Every sync run reported
 * success throughout, because a run compares what it fetched with what it
 * stored and both halves were stored exactly as the importer meant them.
 *
 * Asked of the two stored columns and not of UNESCO's vocabulary, which is what
 * makes it a rule about this catalogue rather than a second copy of the
 * importer's reading. The import writes both from one predicate now, so a row
 * here means either that predicate came apart again or something wrote one half
 * on its own.
 *
 * Both directions, because the two halves fail differently. Tagged and not
 * flagged is the shape 035 repaired -- a site listed in danger showing nothing.
 * Flagged and not tagged is a badge on a site nothing lists, which is the worse
 * of the two on the ground: it tells a traveller a place is in peril on no
 * evidence at all.
 *
 * Except while the flag itself is held. Under a gated category the run writes
 * tags past the gate -- labels nothing renders, derived from facts the row
 * stores by name (#570) -- and holds the flag with the rest of the row for a
 * curator, so a site the Committee has just listed carries the tag ahead of
 * the flag until the card is published, and a site just delisted the other
 * way round. That is the two halves apart by design, not the import coming
 * apart, and it is invisible to readers, since the badge follows the flag.
 *
 * The exclusion is the held flag, not the held row. `pending_change_sync_log_id`
 * is set by *any* held field, and on this database every one of the 1272
 * UNESCO rows carries it -- the criteria and a picture credit are held on all
 * of them -- so leaving out every row with a pointer would switch this check
 * off for the whole category it was written for. Asking the pointed-at
 * changeset whether it holds `metadata.inDanger` leaves out the 58 rows whose
 * flag is actually waiting on a curator and keeps the guard over the rest.
 * The flag is a major key, reported under its own name and never inside the
 * `metadata` catch-all (`changeSet.ts`), which is why the catch-all is not in
 * the test: naming it there would exclude every row holding a criteria string.
 * Since ADR-0039 a run emits no catch-all at all, so that exclusion binds only
 * the cards filed before it — which stand until a run re-proposes.
 *
 * And it is the flag still *waiting*, not one that was answered. A curator who
 * refuses the proposed flag (#722) has decided the tag and the badge will go on
 * disagreeing, and no card will ever come round to fix it — which is a
 * disagreement this check is for rather than one to keep excusing.
 */
const dangerFlagAgainstItsTag: CatalogueAssertion = {
  id: 'danger-flag-disagrees-with-its-tag',
  area: 'objects',
  title: 'A site whose danger tag and whose In Danger badge disagree',
  kind: 'invariant',
  meaning:
    'One fact about the site is stored twice and the two copies say different things, so the '
    + 'badge a traveller sees does not follow from what the catalogue holds. Tagged with no flag '
    + 'is a danger-listed site showing nothing — the shape migration 035 repaired, and a sign the '
    + 'import has come apart again if it returns. Flagged with no tag is the opposite and the '
    + 'worse of the two: a site badged as in peril with nothing in the catalogue saying it is.',
  // Both sides coalesced, and the tag side is not the decorative half of that.
  // `tags` is nullable and reachable as null — `createManualExperience` writes
  // NULL for an object a curator made without any — and `NULL ? 'in_danger'` is
  // NULL, which makes `NULL <> FALSE` neither true nor false, so the row is
  // dropped from the result. That silently loses exactly the direction this rule
  // calls the worse one: a hand-made object carrying the flag with nothing
  // tagging it. Verified against the live catalogue: with one such row inserted
  // in a transaction, the uncoalesced form finds nothing and this one finds it.
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               COALESCE(e.tags ? 'in_danger', FALSE) AS tagged,
               COALESCE(e.metadata->'inDanger' = 'true'::jsonb, FALSE) AS flagged,
               e.metadata->>'dangerList' AS listing
          FROM experiences e
         WHERE COALESCE(e.tags ? 'in_danger', FALSE)
               <> COALESCE(e.metadata->'inDanger' = 'true'::jsonb, FALSE)
           -- Not while a curator holds the flag itself: the tag moved ahead of
           -- it by design (#570), and the badge follows the flag. The pointed-at
           -- changeset is asked, not the pointer: any held field sets the
           -- pointer, and on this database every UNESCO row has one.
           AND NOT EXISTS (
             SELECT 1
               FROM experience_sync_changes ch
              CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) f
              WHERE ch.experience_id = e.id
                AND ch.sync_log_id = e.pending_change_sync_log_id
                AND (f->>'held')::boolean
                AND NOT ${heldFieldAnsweredSql('e.id')}
                AND f->>'field' = 'metadata.inDanger')
         ORDER BY e.name`,
  describe: row => {
    const since = parseDangerListing(row.listing)?.since;
    const dated = since ? ` since ${since}` : '';
    const state = row.tagged === true
      ? `tagged as in danger${dated}, with no badge on it`
      : 'badged as in danger with nothing in the catalogue listing it';
    return `${text(row, 'experience_name')}: ${state} `
      + `(experience ${count(row, 'experience_id')})`;
  },
};

/**
 * A work naming several makers in an order nobody has confirmed.
 *
 * A count to watch rather than a zero to hold, and ADR-0040 is why. The
 * catalogue stores every creator the source names, which is the fix; the *order*
 * it stores them in is a query planner's. SPARQL exposes no statement order at
 * all, and the banded pool query answers in reverse of the source's own —
 * measured on all eight multi-creator works sampled, and the whole of why museum
 * run 64 moved *Morning in a Pine Forest* from Ivan Shishkin, who painted the
 * forest, to Konstantin Savitsky, who painted the bears.
 *
 * So the rows here are not wrong, they are unvouched-for: two names read as a
 * collaboration whichever way round they sit, and a row of six says "6 artists"
 * rather than naming a leader, until somebody decides. This is what says how
 * many such decisions are outstanding.
 *
 * **One row per work**, not per pair of makers: a work with six of them is one
 * decision, and `maker_count` is there to say how big a decision. Two makers are
 * deliberately included even though nothing on screen depends on their order —
 * the question the panel answers is "whose attribution has a person looked at",
 * and a curator working through these wants the pair that needs swapping as much
 * as the six that need arranging.
 *
 * The remedy is a curator's, through the work edit endpoint, which claims
 * `artists` and so takes the row out of this count for good — the same claim
 * that stops the next run reordering it.
 *
 * It reads zero on a gated catalogue that has never published one of these, and
 * that is not the same as nothing to do: under ADR-0037 a run may not rewrite a
 * visible work's attribution, so the second maker arrives as a held proposal and
 * the row holds one name until somebody publishes it. Museum run 79 filed 22 of
 * them and moved this count not at all. What is waiting *there* is the queue's
 * own question and is counted on the gate's panel; this one begins where that
 * one ends.
 */
const workMakersUnconfirmed: CatalogueAssertion = {
  id: 'work-makers-unconfirmed',
  area: 'objects',
  title: 'A work names several makers in an order nobody has confirmed',
  kind: 'watch',
  meaning:
    'Expected while the catalogue is young, and accepted by ADR-0040: the source says who made a '
    + 'work and not in what order, so the stored order is the query\'s rather than anyone\'s. '
    + 'Nothing on a screen claims one of them leads until a curator says so. Watch the number come '
    + 'down as attributions are read; a jump means an import found new collaborations.',
  // The claim is the whole of "somebody has looked at this", and it is the same
  // key the upsert honours and the edit endpoint writes, so this cannot drift
  // from what a claim actually protects.
  sql: `SELECT t.id AS treasure_id,
               t.name AS work_name,
               array_length(t.artists, 1) AS maker_count,
               t.artists[1] AS first_maker
          FROM treasures t
         WHERE array_length(t.artists, 1) > 1
           AND NOT (t.curated_fields ? 'artists')
           -- A work nobody has passed is not yet a work anybody is being misled
           -- by: it is invisible, and the first thing a curator does with it is
           -- decide whether it belongs at all. Its makers *are* stored in full —
           -- the hold protects a visible row, and an arrival has nothing to
           -- protect — so without this the count would include works no screen
           -- has ever drawn.
           AND t.curation_state <> 'pending'
         ORDER BY array_length(t.artists, 1) DESC, t.name`,
  describe: row => {
    const makers = count(row, 'maker_count');
    return `${text(row, 'work_name')}: ${makers} makers, `
      + `stored with ${text(row, 'first_maker')} first and nobody having said so`;
  },
};

/**
 * The object rules, in the order a person reads them: the fact stored twice,
 * then the count of works whose makers nobody has arranged.
 */
export const objectAssertions: CatalogueAssertion[] = [
  dangerFlagAgainstItsTag,
  workMakersUnconfirmed,
];
