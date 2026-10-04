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
import {
  MEMBERSHIPS, admissionPinnedSql, iconicPinnedSql, membershipAdmittedSql,
} from '../../../db/membership.js';
import { parseDangerListing } from '../../../services/sync/dangerListing.js';
import {
  KILL_CLASSES, LOST_CLASSES, VETO_CLASSES, WORSHIP_CLASSES,
} from '../../../services/sync/publicArt/classes.js';
import { REMAINS_ON_SHOW } from '../../../services/sync/museum/worksCollector.js';
import { tidyLabelSql } from '../../../services/sync/labelFold.js';

import { count, text } from './assertion.js';
import type { CatalogueAssertion } from './assertion.js';
import { publishedContentSql } from '../../../db/readerPredicates.js';

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
 * Except while the flag itself is held. Under a gated source the run writes
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
 * off for the whole source it was written for. Asking the pointed-at
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
           -- pointer, and on this database every UNESCO row has one. The
           -- pointer is the membership's (#822), so the changeset is found
           -- through it.
           AND NOT EXISTS (
             SELECT 1
               FROM experience_sync_changes ch
              CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) f
               JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id
                                    AND m.pending_change_sync_log_id = ch.sync_log_id
              WHERE ch.experience_id = e.id
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
 * A row its source turned away, still badged as a must-see.
 *
 * A museum carries `is_iconic` because it holds a work above the fame line: the
 * run sets it where that is true of the row and clears it with a refusal,
 * whether the rule named the row or the sweep reached it (`admission.ts`,
 * `CLEAR_ICONIC`). For the works-first museums it has been a synonym of
 * belonging, every one of them having been admitted for exactly that
 * (ADR-0023); an archaeology museum enters for what it *is* as well, and one
 * admitted that way is in the kind without the badge (ADR-0045 decision 5). The
 * invariant is the same either way -- a refused row wears no badge -- and this
 * is why it is that, and not "an admitted row wears one". Nothing reads a
 * museum's own flag yet --
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
  title: 'A row its source turned away, still badged as a must-see',
  kind: 'invariant',
  meaning:
    'The row is refused — hidden from readers by its source\'s own rule — and still carries '
    + 'the Iconic flag, which a read of the flag on its own (the Iconic filter, an export) would '
    + 'hand a reader as a must-see the catalogue has turned away. The run\'s refusal writes and a '
    + 'curator\'s confirmation both clear the flag, so a row here was refused by a path that did '
    + 'not, or had the flag set afterwards. Rows refused before those writes cleared the flag '
    + 'are what db/migrations/042-refused-row-keeps-no-iconic-badge.sql clears.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               c.name AS source_name
          FROM ${MEMBERSHIPS} m
          JOIN experiences e ON e.id = m.experience_id
          JOIN experience_sources c ON c.id = m.source_id
         WHERE m.admission = 'refused'
           AND m.is_iconic
           -- A flag a curator pinned outranks the rule here exactly as it does
           -- for the writers: the pin is the one thing that keeps the badge on
           -- a refused membership on purpose.
           AND NOT ${iconicPinnedSql('m')}
         ORDER BY e.name`,
  describe: row =>
    `${text(row, 'experience_name')}: turned away from ${text(row, 'source_name')} `
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
           AND ${publishedContentSql('t')}
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
// A lost or destroyed work is refused unless it is the one work the rule
// names as remains on show (`REMAINS_ON_SHOW`, read by `publicArtVerdict`).
const REFUSED_AS_LOST = qidArray(Object.keys(LOST_CLASSES));
const REMAINS_SHOWN = qidArray(Object.keys(REMAINS_ON_SHOW));
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
 * Three things the rule reads that a constant cannot: the museum tree, the
 * worship tree and the lost tree, walked from Wikidata each run. The worship
 * and lost floors are pinned (`WORSHIP_CLASSES`, `LOST_CLASSES`) and read
 * here, the lost one with the rule's one exception by name
 * (`REMAINS_ON_SHOW`); a museum class the veto would catch is
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
    'The row is admitted to Public Art & Monuments and carries a Wikidata class the source\'s '
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
                 WHERE c = ANY(${REFUSED_OUTRIGHT}) OR c = ANY(${REFUSED_UNLESS_ARTWORK})
                    OR (c = ANY(${REFUSED_AS_LOST}) AND NOT e.external_id = ANY(${REMAINS_SHOWN}))) AS classes
          FROM experiences e
          -- The public-art source's own membership (#822): the classes were
          -- written by its run and the admission is that source's rule.
          JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.source_id = 3
         WHERE m.admission = 'admitted'
           AND e.is_manual = FALSE
           AND NOT ${admissionPinnedSql('m')}
           -- A row the run never wrote classes onto is a row the rule never
           -- reached, and the question has no answer yet rather than a clean
           -- one: it is counted by its absence from every run, not here.
           AND jsonb_typeof(e.metadata->'wikidataClasses') = 'array'
           AND (
             e.metadata->'wikidataClasses' ?| ${REFUSED_OUTRIGHT}
             OR (
               e.metadata->'wikidataClasses' ?| ${REFUSED_AS_LOST}
               AND NOT e.external_id = ANY(${REMAINS_SHOWN})
             )
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
      WORSHIP_CLASSES[qid] ?? KILL_CLASSES[qid] ?? LOST_CLASSES[qid] ?? VETO_CLASSES[qid] ?? qid;
    const classes = text(row, 'classes').split(', ').filter(Boolean).map(label).join(', ');
    return `${text(row, 'experience_name')}: admitted to Public Art & Monuments, typed `
      + `${classes} (experience ${count(row, 'experience_id')})`;
  },
};

/**
 * A place no kind holds.
 *
 * Since #822 every reader-facing read asks the four questions of a place
 * through its memberships (`db/membership.ts`), so a row of `experiences`
 * with no row here is hidden from every list, map, count and search — not
 * refused, not unread, simply never offered — and nothing on any screen says
 * why. Migration 046 refuses to commit with such a row, and the three writers
 * that create a place (the sync upsert, a curator's create, the e2e fixture)
 * write the membership in the same transaction; a row here means a writer
 * arrived that does not. Its source's run finds no membership to reach it by
 * and fails on that item on every run until one is written (ADR-0084).
 */
const placeWithoutMembership: CatalogueAssertion = {
  id: 'place-without-membership',
  area: 'objects',
  title: 'A place that belongs to no kind',
  kind: 'invariant',
  meaning:
    'The row has no membership in any kind, so no list, map, count or search offers it and no '
    + 'queue asks about it: it is not refused and not unread, it is simply never asked. Every '
    + 'writer that creates a place writes its membership with it; a row here came in by a path '
    + 'that did not, and wants one written by hand for the kind its source fills. Until then its '
    + 'source\'s run fails on it on every run, finding no membership to reach it by.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               c.name AS source_name
          FROM experiences e
          JOIN experience_sources c ON c.id = e.source_id
         WHERE NOT EXISTS (
           SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id
         )
         ORDER BY e.name`,
  describe: row =>
    `${text(row, 'experience_name')}: keyed on ${text(row, 'source_name')} and a member of no `
    + `kind (experience ${count(row, 'experience_id')})`,
};

/**
 * A place none of whose memberships carries the source and id it was brought
 * under.
 *
 * A run finds its places through its memberships — `(source_id,
 * external_id)` on the membership (ADR-0084) — and the place's own pair says
 * which source first brought the row and under what id. Until a merge (#755)
 * folds a second source's membership onto a place, the two name the same
 * membership, and every reader-facing row still reads its kind through that
 * equality (`rowKindJoinSql`, #819). A place where none matches has lost the
 * membership its first source would find it by: that source's next run does
 * not find it, tries to create the place, and fails on that item on every
 * run, since the place's own pair is still unique among places. Where no
 * membership of it names the place's own source at all, every list also
 * shows it with a null kind, which no group, pin colour or chip can draw;
 * one that names the source under another id still gives it that kind.
 */
const membershipSourceDisagreesWithRow: CatalogueAssertion = {
  id: 'membership-source-disagrees-with-row',
  area: 'objects',
  title: 'A place none of whose memberships carries the source and id it was brought under',
  kind: 'invariant',
  meaning:
    'The place says which source first brought it and under what id, and no membership of it '
    + 'carries that pair. A run finds its places by the pair on the membership, so that source\'s '
    + 'next run does not find this one, tries to create it, and fails on it on every run, since the '
    + 'place\'s own pair is still taken. Where no membership names the place\'s source at all, every '
    + 'list, search, visit and review card, which read the row\'s kind off that source\'s membership '
    + '(#819), also show the row with no kind. Either the membership was written for the wrong source or id, or '
    + 'the row was re-keyed by hand; whichever it is, the two have to be made to agree.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               e.external_id,
               row_source.name AS row_source_name
          FROM experiences e
          JOIN experience_sources row_source ON row_source.id = e.source_id
         WHERE EXISTS (SELECT 1 FROM ${MEMBERSHIPS} m WHERE m.experience_id = e.id)
           AND NOT EXISTS (
             SELECT 1 FROM ${MEMBERSHIPS} m
              WHERE m.experience_id = e.id
                AND m.source_id = e.source_id
                AND m.external_id = e.external_id
           )
         ORDER BY e.name`,
  describe: row =>
    `${text(row, 'experience_name')}: brought by ${text(row, 'row_source_name')} as `
    + `${text(row, 'external_id')}, and no membership of it carries that pair `
    + `(experience ${count(row, 'experience_id')})`,
};

/**
 * A place whose own listing flags are not what its memberships say.
 *
 * Whether a source still lists a place is each membership's (ADR-0084); the
 * place's `missing_since` and `source_membership` are their derivation —
 * missing once every membership is, at the latest of their flags, `former`
 * once every membership is — written by one trigger,
 * `derive_place_listing()`, and by nothing else. The review queue's missing
 * card and every `former` chip read the place's copy, so a place where the two
 * disagree is asked about, or labelled, by a flag no source raised. A row here
 * means a write reached the place's columns past the trigger, or a database is
 * missing the trigger.
 */
const placeListingDisagreesWithMemberships: CatalogueAssertion = {
  id: 'place-listing-disagrees-with-memberships',
  area: 'objects',
  title: 'A place whose missing or former flag is not what its memberships say',
  kind: 'invariant',
  meaning:
    'The place\'s own flags say whether its sources still list it, and they are derived from its '
    + 'memberships: missing once every source has stopped listing it, former once every membership '
    + 'is. Here the two disagree, so the review queue asks about, or a card labels, a state no '
    + 'source is in. Something wrote the place\'s flags past the trigger that derives them, or the '
    + 'database is missing that trigger; re-applying the schema restores it.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               e.missing_since IS NOT NULL AS place_missing,
               e.source_membership AS place_listing,
               d.missing IS NOT NULL AS memberships_missing,
               d.listing AS memberships_listing
          FROM experiences e
          JOIN (SELECT m.experience_id,
                       CASE WHEN bool_and(m.missing_since IS NOT NULL) THEN max(m.missing_since) END AS missing,
                       CASE WHEN bool_and(m.source_membership = 'former') THEN 'former' ELSE 'present' END AS listing
                  FROM ${MEMBERSHIPS} m
                 GROUP BY m.experience_id) d ON d.experience_id = e.id
         WHERE e.missing_since IS DISTINCT FROM d.missing
            OR e.source_membership IS DISTINCT FROM d.listing
         ORDER BY e.name`,
  describe: row =>
    `${text(row, 'experience_name')}: the place reads `
    + `${row.place_missing ? 'missing' : 'listed'}, ${text(row, 'place_listing')}; its memberships say `
    + `${row.memberships_missing ? 'missing' : 'listed'}, ${text(row, 'memberships_listing')} `
    + `(experience ${count(row, 'experience_id')})`,
};

/**
 * A work link placed by a membership of another place.
 *
 * Which memberships place a link is `experience_treasure_placements` (ADR-0084):
 * a run adds its own on every link it offers at a place and takes it away when
 * it stops, and the link is marked missing once none is left. A placement
 * naming a membership of another place is one no run of that place will ever
 * take away — the link stays on show after every source of its own place has
 * dropped the work — and the card's per-kind lists of works (#1245) would file
 * the work under a kind the place is not in.
 */
const placementOfAnotherPlace: CatalogueAssertion = {
  id: 'link-placed-by-another-places-membership',
  area: 'objects',
  title: 'A work link placed by a membership of another place',
  kind: 'invariant',
  meaning:
    'A work is linked to a place, and the membership recorded as placing it there belongs to a different '
    + 'place. No run of this place can take that placement away, so the work stays on show after every '
    + 'source of the place has stopped placing it. A merge that moved the link without its placement, or a '
    + 'placement written by hand, leaves this; the placement belongs to a membership of the link\'s own place.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               t.name AS work_name,
               other.id AS other_experience_id
          FROM experience_treasure_placements p
          JOIN experience_treasures et ON et.id = p.link_id
          JOIN experiences e ON e.id = et.experience_id
          JOIN treasures t ON t.id = et.treasure_id
          JOIN ${MEMBERSHIPS} m ON m.id = p.membership_id
          JOIN experiences other ON other.id = m.experience_id
         WHERE m.experience_id <> et.experience_id
         ORDER BY e.name, t.name`,
  describe: row =>
    `${text(row, 'work_name')} at ${text(row, 'experience_name')} (experience `
    + `${count(row, 'experience_id')}) is placed by a membership of experience ${count(row, 'other_experience_id')}`,
};

/** `column <> tidy(column)`: the stored value is not what the writers would store. */
const untidy = (column: string) => `${column} IS NOT NULL AND ${column} <> ${tidyLabelSql(column)}`;

/**
 * A name stored with whitespace nobody typed.
 *
 * Every source is a label service and a label service passes runs of spaces
 * through: Wikidata's label for *St. John  on Patmos* carries two, the World
 * Heritage Centre's component names carried eighteen runs, 98 Arabic local
 * names one each, and Getbol's English name a no-break space (#835). HTML
 * collapses all of it, so a reader types what the screen shows and a filter
 * that compares the raw string finds nothing — and no screen can show why.
 *
 * The rule is `tidyLabel`, applied by every writer of a name — the three
 * importers' writers before their diff, the four curator schemas before their
 * bounds — and migration 047 brought what was stored to it. This is the rule
 * asked of the rows, in its SQL spelling (`tidyLabelSql`), so a writer that
 * a future source reaches around, or a hand-run UPDATE, is named here rather
 * than found by a reader whose search returns nothing. Asked of every column a
 * person types into a filter: a place's name, each language of its local
 * names, a monument's makers, a point's name, a work's title and its makers.
 *
 * Not composed from the writers' own code on purpose — the second rule in
 * `docs/tech/data-assertions.md` § Adding an assertion: an assertion that
 * exists to catch a writer being wrong must not agree with it by construction.
 * What it composes is the rule's SQL spelling, pinned to `tidyLabel` itself and
 * to the migration by `labelFold.test.ts` and `objectAssertions.test.ts`.
 */
const nameCarriesWhitespaceNobodyTyped: CatalogueAssertion = {
  id: 'name-carries-whitespace-nobody-typed',
  area: 'objects',
  title: 'A name stored with whitespace a person would not type',
  kind: 'invariant',
  meaning:
    'The stored name carries whitespace at its edges, a run of it inside, or a Unicode space: '
    + 'the screen collapses it, so a reader typing what they see into a filter finds nothing, '
    + 'and nothing says why. Every writer tidies a name before storing it, so a row here came '
    + 'in by a path that did not — a new source, or a hand-run update. The remedy is a run of '
    + 'the source, which tidies before it writes, or a hand-run tidy: the correction dialogs '
    + 'compare by this same rule, so they will not send a name that differs only by whitespace.',
  sql: `SELECT kind, id, name, field
          FROM (
            SELECT 'place' AS kind, e.id, e.name, 'name' AS field
              FROM experiences e
             WHERE ${untidy('e.name')}
            UNION ALL
            SELECT 'place', e.id, e.name, 'name_local.' || kv.key
              FROM experiences e, jsonb_each(e.name_local) kv
             WHERE jsonb_typeof(kv.value) = 'string'
               AND ${untidy("(kv.value #>> '{}')")}
            UNION ALL
            SELECT 'place', e.id, e.name, 'metadata.creators'
              FROM experiences e
             WHERE jsonb_typeof(e.metadata->'creators') = 'array'
               AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.metadata->'creators') c
                            WHERE jsonb_typeof(c.value) = 'string'
                              AND ${untidy("(c.value #>> '{}')")})
            UNION ALL
            SELECT 'point', el.id, el.name, 'name'
              FROM experience_locations el
             WHERE ${untidy('el.name')}
            UNION ALL
            SELECT 'work', t.id, t.name, 'name'
              FROM treasures t
             WHERE ${untidy('t.name')}
            UNION ALL
            SELECT 'work', t.id, t.name, 'artists'
              FROM treasures t
             WHERE EXISTS (SELECT 1 FROM unnest(t.artists) a
                            WHERE ${untidy('a')})
          ) untidy_names
         ORDER BY kind, name, field`,
  describe: row =>
    `${text(row, 'kind')} ${count(row, 'id')}, ${JSON.stringify(text(row, 'name'))}: `
    + `${text(row, 'field')} is not stored as a person would type it`,
};

/**
 * The same ground, twice: an archaeology site and the World Heritage row of the
 * same place.
 *
 * **A watch, never a fail.** Two kinds holding one place is what the catalogue
 * does today — the Louvre is an art museum and an archaeology museum, the
 * Statue of Liberty a monument and a World Heritage point — and ADR-0058
 * decision 6 says so plainly: nothing is refused for being in another kind, and
 * the honesty owed to a traveller is that each list holds what its name says.
 * 273 of the 1,130 world-tier site candidates already carry a World Heritage id
 * (measured 2026-09-13), so Chichen Itza, Troy, Machu Picchu, Petra and Delphi
 * are each two pins on purpose until #755 merges them into one place with two
 * memberships.
 *
 * What the number is for is that merge. It says how much work #755 has in front
 * of it, and it says when a run has produced more of it than expected — a site
 * door that started admitting the *point* of every serial World Heritage site
 * would show up here as a jump before it showed up anywhere else.
 *
 * A hundred metres, which is the distance the places rules already use for
 * "the same spot" and is wide enough for two sources' idea of where an
 * excavation's centre is. The kind is asked of the membership (#819) rather
 * than of the row's source, because the Archaeology kind gains a second source
 * the day its regional tier lands.
 *
 * **Two distance tests, and the first one is what makes this finish.** A
 * `::geography` cast hides the column from `idx_experiences_location`, so the
 * planner had nothing to do but read every World Heritage row for every site:
 * measured on the dev database on 2026-09-14 against the 83 archaeology museums
 * (the kind holds no site rows yet), the geography test alone ran a sequential
 * scan over 1,272 rows per candidate and took 861 ms, while the same query with
 * the degree prefilter took 40 ms on the index and answered with the same three
 * rows. 0.01° is about 1.1 km of latitude and is wider than a hundred metres in
 * every direction up to 84° — the catalogue's northernmost row sits at 71.2° —
 * so it only ever lets through more than the exact test below, which decides.
 */
const archaeologySiteTwinOfWorldHeritage: CatalogueAssertion = {
  id: 'archaeology-site-twin-of-a-world-heritage-row',
  area: 'objects',
  title: 'An archaeology site standing on the same ground as a World Heritage row',
  kind: 'watch',
  meaning:
    'Expected, and the number is the news. A place two kinds hold is two rows and two pins '
    + 'today (ADR-0058 decision 6), and 273 of the sites this kind admits carry a World '
    + 'Heritage id of their own — Troy, Petra, Chichen Itza. This counts how many pairs are '
    + 'waiting for the merge that makes them one place with two memberships (#755). Watch it '
    + 'track the catalogue; a jump means a run started admitting rows it did not before.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               w.id AS world_heritage_id,
               w.name AS world_heritage_name,
               round(ST_Distance(e.location::geography, w.location::geography)::numeric)::int AS metres
          FROM experiences e
          -- Admitted on both sides, because the meaning says "the sites this
          -- kind admits": a site a curator turned down keeps its row and its
          -- membership at 'refused', and would otherwise go on counting as a
          -- pair — and so would a World Heritage row the source withdrew.
          JOIN ${MEMBERSHIPS} m ON m.experience_id = e.id AND m.kind_id = 5
                               AND ${membershipAdmittedSql('m')}
          JOIN experiences w ON w.source_id = 1
                            AND w.id <> e.id
          JOIN ${MEMBERSHIPS} wm ON wm.experience_id = w.id AND wm.kind_id = 1
                                AND ${membershipAdmittedSql('wm')}
                            -- The index-served prefilter first, in degrees, and
                            -- then the metre test that decides.
                            AND ST_DWithin(e.location, w.location, 0.01)
                            AND ST_DWithin(e.location::geography, w.location::geography, 100)
         WHERE m.type = 'site'
         ORDER BY metres, e.name`,
  describe: row =>
    `${text(row, 'experience_name')} sits ${count(row, 'metres')} m from the World Heritage row `
    + `"${text(row, 'world_heritage_name')}"`,
};

/**
 * The object rules, in the order a person reads them: the fact stored twice,
 * the badge a refusal should have taken, the count of works whose makers
 * nobody has arranged, the public-art row the rule would refuse, the
 * archaeology site standing where a World Heritage row already stands, the two
 * facts every reader rests on since the place and its membership came apart,
 * then the name a filter cannot find.
 */
export const objectAssertions: CatalogueAssertion[] = [
  dangerFlagAgainstItsTag,
  refusedRowWearingIconic,
  workMakersUnconfirmed,
  publicArtRowTypedABuilding,
  archaeologySiteTwinOfWorldHeritage,
  placeWithoutMembership,
  membershipSourceDisagreesWithRow,
  placeListingDisagreesWithMemberships,
  placementOfAnotherPlace,
  nameCarriesWhitespaceNobodyTyped,
];
