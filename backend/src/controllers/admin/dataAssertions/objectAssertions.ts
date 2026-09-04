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
import { admissionPinnedSql, iconicPinnedSql } from '../../../services/sync/admission.js';
import { parseDangerListing } from '../../../services/sync/dangerListing.js';
import { KILL_CLASSES, VETO_CLASSES, WORSHIP_CLASSES } from '../../../services/sync/publicArt/classes.js';

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
 * A row its category turned away, still badged as a must-see.
 *
 * A museum carries `is_iconic` because it holds a work above the fame line, and
 * every museum in this catalogue was admitted for exactly that (ADR-0023), so
 * the flag has been a synonym of belonging: the run sets it on admission and
 * clears it with a refusal, whether the rule named the row or the sweep reached
 * it (`admission.ts`, `CLEAR_ICONIC`). Nothing reads a museum's own flag yet --
 * the badge the list draws is a *work's* -- but the Iconic filter (#589) and an
 * export (#591) will read it on its own, with no admission predicate beside it,
 * and the flag as stored is what they would hand a reader. So it is the stored
 * value that is asked here, not a reader composite: whether one column moved
 * without the other.
 *
 * How a row got here is the case #760 found. Eight museums created by run 48,
 * before the art test, were refused by runs 52 and 53 on the day the admission
 * writes landed, with the flag surviving -- and then *confirmed* by a curator,
 * whose pin on `admission` is what takes the row out of every later run's
 * reach, so the badge was frozen on. The confirmation clears the flag since
 * #760 and migration 042 cleared the eight; the run's own badge write moved
 * behind the restore step since the same issue (`markIconic`), where before it
 * badged a row mid-run whatever its admission -- a confirmed refusal a later
 * run selected again included, and any row a cancelled run had not yet
 * re-admitted. A row appearing from here means a refusal path wrote
 * `admission` without the clear, or a writer of the flag reached a row already
 * refused.
 *
 * The one row left alone is the one the writers leave alone: a flag a curator
 * pinned. No curation surface sets `is_iconic` today -- the run does, and it
 * honours the same pin -- so this is an exclusion against the day one does
 * rather than a case the catalogue holds, and it is the writers' own guard,
 * imported rather than spelled again.
 */
const refusedRowWearingIconic: CatalogueAssertion = {
  id: 'refused-row-wearing-iconic',
  area: 'objects',
  title: 'A row its category turned away, still badged as a must-see',
  kind: 'invariant',
  meaning:
    'The row is refused — hidden from readers by its category\'s own rule — and still carries '
    + 'the Iconic flag, which a read of the flag on its own (the Iconic filter, an export) would '
    + 'hand a reader as a must-see the catalogue has turned away. The run\'s refusal writes and a '
    + 'curator\'s confirmation both clear the flag, so a row here was refused by a path that did '
    + 'not, or had the flag set afterwards. Rows refused before those writes cleared the flag '
    + 'are what db/migrations/042-refused-row-keeps-no-iconic-badge.sql clears.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               c.name AS category_name
          FROM experiences e
          JOIN experience_categories c ON c.id = e.category_id
         WHERE e.admission = 'refused'
           AND e.is_iconic
           -- A flag a curator pinned outranks the rule here exactly as it does
           -- for the writers: the pin is the one thing that keeps the badge on
           -- a refused row on purpose.
           AND NOT ${iconicPinnedSql('e')}
         ORDER BY e.name`,
  describe: row =>
    `${text(row, 'experience_name')}: turned away from ${text(row, 'category_name')} `
    + `and still badged as a must-see (experience ${count(row, 'experience_id')})`,
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
 * A SQL array literal of class ids, for a rule whose lists live in code.
 *
 * Every id comes from a constant the public-art rule owns, and the shape is
 * checked here anyway: an assertion's SQL is sent without parameters, and a
 * list that one day held a label instead of an id must fail loudly rather
 * than be spliced into a query.
 */
function qidArray(qids: string[]): string {
  for (const qid of qids) {
    if (!/^Q\d+$/.test(qid)) throw new Error(`not a Wikidata id: ${qid}`);
  }
  const quoted = qids.map((q) => "'" + q + "'").join(', ');
  return 'ARRAY[' + quoted + ']';
}

const REFUSED_OUTRIGHT = qidArray([...Object.keys(WORSHIP_CLASSES), ...Object.keys(KILL_CLASSES)]);
const REFUSED_UNLESS_ARTWORK = qidArray(Object.keys(VETO_CLASSES));

/**
 * A public-art row admitted with a class the rule refuses.
 *
 * The public-art rule (`publicArtTest.ts`) reads what Wikidata types an entity
 * and turns down a place of worship, a camp, a stadium, an archaeological
 * site, a tomb, an organisation, a settlement; and a building, a cemetery or
 * a place unless an artwork class answers it. It runs on every candidate every
 * run, and it stores what it read on the row (`metadata.wikidataClasses`).
 * This asks the stored rows the same question, for the rows the rule never
 * reached: the 205 created before it existed (eleven Spanish cathedrals among
 * them, typed `Catholic cathedral, monument`), or any a later path admits
 * without running it. It composes the rule's own lists on purpose — the
 * exception the data-assertions doc allows the other way round does not apply,
 * since a wrong list is not what this can see; a row the list never met is.
 *
 * Two things the rule reads that a constant cannot: the museum tree and the
 * worship tree, walked from Wikidata each run. The worship floor is pinned
 * (`WORSHIP_CLASSES`) and read here; a museum class the veto would catch is
 * not, so a museum typed only by a class outside these lists is the rule's to
 * find, not this check's. Whether an artwork class answered a building's veto
 * is not approximated at all: the rule stores its own answer on the row
 * (`metadata.wikidataArtwork`), which is what a check that cannot hold the
 * closures reads — a holy well built into a building is in the fountain
 * closure, and no constant here could say so. A row written before that key
 * existed reads as no answer, which is the conservative reading.
 *
 * The one row left alone is the one the writers leave alone: an admission a
 * curator pinned. An override says the rule was wrong about this row, and
 * naming it every run would be the rule arguing back.
 */
const publicArtRowTypedABuilding: CatalogueAssertion = {
  id: 'public-art-row-typed-a-building',
  area: 'objects',
  title: 'A public-art row admitted with a class the rule refuses',
  kind: 'invariant',
  meaning:
    'The row is admitted to Public Art & Monuments and carries a Wikidata class the category\'s '
    + 'rule refuses — a place of worship, a camp, a stadium, an archaeological site, a tomb, an '
    + 'organisation, a settlement, or a building or cemetery with no artwork class to answer it. '
    + 'The rule refuses such a row on every run it reaches, so a row here was admitted before '
    + 'the rule existed or by a path that did not run it: a live run of the source re-evaluates '
    + 'it, and a curator can confirm or override the refusal from the review page. A row a '
    + 'curator has already overridden is not reported.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               (SELECT string_agg(c, ', ' ORDER BY c)
                  FROM jsonb_array_elements_text(e.metadata->'wikidataClasses') c
                 WHERE c = ANY(${REFUSED_OUTRIGHT}) OR c = ANY(${REFUSED_UNLESS_ARTWORK})) AS classes
          FROM experiences e
         WHERE e.category_id = 3
           AND e.admission = 'admitted'
           AND e.is_manual = FALSE
           AND NOT ${admissionPinnedSql('e')}
           -- A row the run never wrote classes onto is a row the rule never
           -- reached, and the question has no answer yet rather than a clean
           -- one: it is counted by its absence from every run, not here.
           AND jsonb_typeof(e.metadata->'wikidataClasses') = 'array'
           AND (
             e.metadata->'wikidataClasses' ?| ${REFUSED_OUTRIGHT}
             OR (
               e.metadata->'wikidataClasses' ?| ${REFUSED_UNLESS_ARTWORK}
               -- The rule's own answer to whether an artwork class lifted the
               -- veto; a row written before the key existed has none, and is
               -- read as if none did.
               AND NOT COALESCE((e.metadata->>'wikidataArtwork')::boolean, FALSE)
             )
           )
         ORDER BY e.name`,
  describe: row => {
    // The lists carry the labels; the row carries the ids. Said in words, as
    // the rule's own reason would be.
    const label = (qid: string) =>
      WORSHIP_CLASSES[qid] ?? KILL_CLASSES[qid] ?? VETO_CLASSES[qid] ?? qid;
    const classes = text(row, 'classes').split(', ').filter(Boolean).map(label).join(', ');
    return `${text(row, 'experience_name')}: admitted to Public Art & Monuments, typed `
      + `${classes} (experience ${count(row, 'experience_id')})`;
  },
};

/**
 * The object rules, in the order a person reads them: the fact stored twice,
 * the badge a refusal should have taken, the count of works whose makers
 * nobody has arranged, then the public-art row the rule would refuse.
 */
export const objectAssertions: CatalogueAssertion[] = [
  dangerFlagAgainstItsTag,
  refusedRowWearingIconic,
  workMakersUnconfirmed,
  publicArtRowTypedABuilding,
];
