/**
 * What must be true of the catalogue's own rows, said as queries that return
 * nothing.
 *
 * Every other lane in this repository watches the code. `npm run check` reads
 * the source, Semgrep and Trivy read it again, the schema guards read two SQL
 * files as text, and the e2e smoke drives a browser over a fixture. None of
 * them can see a defect that writes *wrong rows* into a database that is
 * otherwise healthy — a sync run that ends in `success` because a withdrawal
 * plus an arrival is an ordinary outcome, whatever the two rows mean together.
 *
 * That is not hypothetical. From 2026-08-10 the catalogue held a withdrawn
 * point for Bilbao Fine Arts Museum whose replacement stood 1.2 cm away: the
 * same museum door, written to more decimal places. Nothing reported it. It
 * surfaced nine days later because a human read a card that happened to print
 * the distance — and by then a curator had answered `location_marked_former`
 * on a working museum.
 *
 * Three neighbouring lanes were considered and are separate on purpose (#547):
 * #522 is the executable SQL lane that catches a predicate meaning the wrong
 * thing *before* it ships, #497 is the per-run anomaly report that catches a
 * defect *as it happens*, and this one is the cheapest of the three and the
 * only one that watches the **resting state** — what the database holds right
 * now, whoever put it there and whenever.
 *
 * **A rule is absolute; the catalogue it is asked about is not.** This list
 * will grow — points without coordinates, objects no region holds, geometry
 * that covers nothing, whatever a new kind of data brings with it — and much
 * of what it will find is already there. Measured on the dev catalogue the day
 * this landed: 28 objects a reader is offered sit in no region at all, and 173
 * points the source still offers carry no region row. A lane that demanded
 * zero everywhere would be red from its first run and would stay red, which is
 * how a check becomes wallpaper.
 *
 * So the rule stays absolute and the *debt* is what gets recorded
 * (ADR-0032): `data_assertion_acceptances` holds the count each assertion
 * returned when a person last looked and accepted it, and the panel asks
 * whether the number has **grown**. A new assertion arrives with no accepted
 * count, so its first appearance shows everything it found — which is the
 * honest thing for a rule nobody has answered for yet, and the moment to
 * decide between fixing it and carrying it knowingly.
 *
 * **Why this sits in the controller layer.** Most of the assertions have to ask
 * the product's own question — is this a row a reader may be shown, is this a
 * point placement should have placed, is this a proposal the queue is holding —
 * and the only correct way to ask it is to compose the fragments those reads
 * compose (`experienceLifecycle.ts`, `waitingCounts.ts`). Those are controller
 * modules, and the service layer may not import one: `regionAssignmentService`
 * spells the same predicate as a literal rather than reach across that line. So
 * these live beside them instead, where they can read the real predicates
 * rather than copies — and a copy is exactly what would rot. An assertion that
 * asks a *slightly* different question than the read it guards is worse than no
 * assertion: it reports clear while the screens disagree.
 */

import {
  experienceOfferedToReaderSql,
  hideLostSql,
  offeredLocationSql,
  offeredToReaderSql,
  publishedContentSql,
} from '../../experience/experienceLifecycle.js';
import { heldWaitingSql } from '../../experience/waitingCounts.js';
import { LOCATION_UNCHANGED_METERS } from '../../../services/sync/changeSet.js';
import { parseDangerListing } from '../../../services/sync/dangerListing.js';

import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';
import { divisionTreeAssertions } from './divisionTreeAssertions.js';
import { regionGeometryAssertions } from './regionGeometryAssertions.js';

export type { AssertionRow, CatalogueAssertion } from './assertion.js';

/**
 * Metres to millimetres, because the case this file exists for is 12 mm and
 * "0.0 m" would read as nothing at all.
 */
const metres = (row: AssertionRow, key: string): string => Number(row[key] ?? 0).toFixed(3);
/** A `timestamptz` arrives as a `Date`; the day is the part an operator needs. */
const day = (row: AssertionRow, key: string): string => {
  const value = row[key];
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? 'an unknown day');
};

/**
 * Two stored rows of one object that the source is talking about as one place.
 *
 * The pair rule of ADR-0027 — the reference decides which row is a candidate,
 * the geometry decides whether the source means the same place — applied
 * between two rows *already in the table* rather than between a stored row and
 * an incoming one. `samePointSql` cannot be reused for it: it compares against
 * the incoming list, which is not what either of the first two assertions is
 * about. The tolerance is imported rather than spelled, so a change to it
 * cannot leave the assertion guarding the old number.
 *
 * A null reference never matches. Without one there is nothing to make a
 * candidate of, and a distance-only pairing would be catastrophic here for the
 * same reason it is in the writer: 4172 pairs of points of one experience lie
 * within a kilometre of each other, many at exactly nought metres, because
 * what separates two rock shelters in one cliff is the component number.
 */
function samePlaceSql(left: string, right: string): string {
  return `${left}.external_ref IS NOT NULL
      AND ${right}.external_ref IS NOT DISTINCT FROM ${left}.external_ref
      AND ST_DWithin(${left}.location::geography, ${right}.location::geography,
                     ${LOCATION_UNCHANGED_METERS})`;
}

/**
 * A place marked as withdrawn while its replacement stands beside it.
 *
 * #543's shape exactly, and the query is the detection half of
 * `db/migrations/026-collapse-false-withdrawals.sql` — promoting it from a
 * one-shot repair into a standing assertion is most of what #547 is worth.
 *
 * Wider than the repair, deliberately. The migration takes only pairs it can
 * collapse safely, so it wants a survivor holding an ordinal and a ghost
 * carrying neither a visit nor a region assignment. An assertion is not
 * repairing anything: a pair a migration must leave standing because a
 * traveller's visit hangs off it is still a pair the catalogue should not
 * hold, and it is the one a person most needs to be told about, since only a
 * curator can decide which place that person went to.
 *
 * The **survivor** is offered in the sense every reader-facing read means it,
 * which is `offeredLocationSql` and not the flag alone. `location_marked_lost`
 * is a real verdict a curator can record on a place, and a survivor carrying
 * it is on no map: calling it "the one offered under reference" would be a
 * sentence that is simply untrue, and the pair would report for ever with
 * nobody able to act on it.
 *
 * The **ghost** keeps its own predicate, and that asymmetry is the finding
 * rather than an oversight. A ghost is by definition not offered — that is
 * what marks it — and a curator's verdict on it is what this assertion is
 * reporting *about*: #543 is a curator answering `location_marked_former` on a
 * museum that never moved. A pair does not stop being a false withdrawal
 * because somebody answered the false question.
 */
const withdrawnBesideItsReplacement: CatalogueAssertion = {
  id: 'withdrawn-beside-its-replacement',
  area: 'places',
  title: 'A place marked as withdrawn while its replacement stands within ten metres of it',
  kind: 'invariant',
  meaning:
    'The source rewrote a coordinate rather than moving a place, and the run read it as a departure. '
    + 'The pin left every reader-facing read and a curator is being asked a question with no true answer. '
    + 'Repair with db/migrations/026-collapse-false-withdrawals.sql, which collapses the pairs it can '
    + 'and names the ones a curator has to settle.',
  sql: `SELECT ghost.id AS ghost_id,
               survivor.id AS survivor_id,
               ghost.missing_since AS marked_at,
               ghost.external_ref AS external_ref,
               e.name AS experience_name,
               ST_Distance(ghost.location::geography, survivor.location::geography) AS metres
          FROM experience_locations ghost
          JOIN experience_locations survivor
            ON survivor.experience_id = ghost.experience_id
           AND survivor.id <> ghost.id
           AND ${offeredLocationSql('survivor')}
           AND ${samePlaceSql('ghost', 'survivor')}
          JOIN experiences e ON e.id = ghost.experience_id
         WHERE ghost.missing_since IS NOT NULL
         ORDER BY e.name, ghost.id`,
  describe: row =>
    `${text(row, 'experience_name')}: a place marked as withdrawn on ${day(row, 'marked_at')} `
    + `stands ${metres(row, 'metres')} m from the one offered under reference `
    + `${text(row, 'external_ref')} (locations ${count(row, 'ghost_id')} and ${count(row, 'survivor_id')})`,
};

/**
 * Two places of one object, on offer, at one reference, within ten metres.
 *
 * The floor under the writer. ADR-0027 stopped it creating this shape and
 * migration 026 removed the ones it had already made, so a row matching here
 * means either the writer regressed or something wrote points around it.
 *
 * It is also where the *held* shape lands. Under a gated source a false
 * withdrawal is not a marked row at all: the arrival waits beside the visible
 * point, both offered, and only the arrival's `curation_state` tells them
 * apart. The sentence says which one is unread, because the two shapes are
 * repaired in opposite directions.
 *
 * "On offer" is `offeredLocationSql` on both rows rather than the flag alone,
 * for the reason the assertion above states about its survivor: a curator who
 * settles a duplicate by recording one of the two as gone has taken it off
 * every map, and a rule that went on reporting "a reader is shown the same
 * door as two destinations" would be describing a screen nobody sees.
 */
const twoOfferedPlacesAtOneReference: CatalogueAssertion = {
  id: 'two-offered-places-at-one-reference',
  area: 'places',
  title: 'Two places of one object on offer under one reference, within ten metres of each other',
  kind: 'invariant',
  meaning:
    'One place is stored twice. A reader is shown the same door as two destinations, and every count '
    + 'of the object disagrees with every other by one. Where one of the two is unread, this is a '
    + 'false withdrawal held by the gate rather than marked.',
  sql: `SELECT first.id AS first_id,
               second.id AS second_id,
               first.external_ref AS external_ref,
               first.curation_state AS first_state,
               second.curation_state AS second_state,
               e.name AS experience_name,
               ST_Distance(first.location::geography, second.location::geography) AS metres
          FROM experience_locations first
          JOIN experience_locations second
            ON second.experience_id = first.experience_id
           AND second.id > first.id
           AND ${offeredLocationSql('second')}
           AND ${samePlaceSql('first', 'second')}
          JOIN experiences e ON e.id = first.experience_id
         WHERE ${offeredLocationSql('first')}
         ORDER BY e.name, first.id`,
  describe: row => {
    const unread = [
      text(row, 'first_state') === 'pending' ? count(row, 'first_id') : null,
      text(row, 'second_state') === 'pending' ? count(row, 'second_id') : null,
    ].filter(id => id !== null);
    const note = unread.length > 0 ? `, unread: ${unread.join(' and ')}` : '';
    return `${text(row, 'experience_name')}: two places on offer under reference `
      + `${text(row, 'external_ref')} stand ${metres(row, 'metres')} m apart `
      + `(locations ${count(row, 'first_id')} and ${count(row, 'second_id')}${note})`;
  },
};

/**
 * An object a reader can reach, with no place a reader can see.
 *
 * A list entry with no pin, in a product where the list and the map are two
 * views of one set — the failure ADR-0025 decision 5 exists to prevent, and
 * for a one-place object it is the whole object: named in every list, absent
 * from the map, and opening it shows nowhere to go.
 *
 * Two routes reach it and both are live. Under a gate, an object's only place
 * can be written unread while the object itself is published. Without one, a
 * withdrawal applied with no arrival to hold it leaves the same emptiness. A
 * third is a curator's manual region claim outliving every visible point of
 * the object it holds, which `readerRegionMembershipSql` names as the residue
 * its own exemption leaves and points here (#521).
 *
 * `lost` objects are excluded rather than counted: a place that no longer
 * stands is deliberately off every list and map while staying in a visit
 * history, so it has no pin to be missing. The rest of "a reader can reach"
 * is the composite itself, never a subset of it — this family of predicates
 * was written as a subset of itself six times on one branch.
 */
const listedWithNowhereToGo: CatalogueAssertion = {
  id: 'listed-with-nowhere-to-go',
  area: 'places',
  title: 'An object offered to readers with no place a reader can see',
  kind: 'invariant',
  meaning:
    'The object is in lists, counts and search, and the map has nothing to draw for it. Either its '
    + 'places are unread and want publishing, or the source withdrew them and a curator has to say '
    + 'whether the object is still somewhere a traveller can go.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               e.external_id AS external_id,
               (SELECT count(*) FROM experience_locations el
                 WHERE el.experience_id = e.id) AS places_held
          FROM experiences e
         WHERE ${hideLostSql()}
           AND ${experienceOfferedToReaderSql()}
           AND NOT EXISTS (SELECT 1 FROM experience_locations el
                            WHERE el.experience_id = e.id
                              AND ${offeredLocationSql()}
                              AND ${publishedContentSql('el')})
         ORDER BY e.name`,
  describe: row => {
    const held = count(row, 'places_held');
    const stock = held === 0 ? 'holds no place at all' : `holds ${held} none of which a reader may see`;
    return `${text(row, 'experience_name')} (${text(row, 'external_id')}): offered to readers and `
      + `${stock} (experience ${count(row, 'experience_id')})`;
  },
};

/**
 * Visits recorded against a place no reader-facing read offers.
 *
 * A count to watch rather than a zero to hold, and ADR-0022 is why: a
 * traveller who stood somewhere stood there, and the record of it cannot
 * depend on a source still listing the place or on the place still standing.
 * So these rows are legitimate and expected — what carries meaning is the
 * number *moving*, since every one of them is a person's record that has
 * stopped being displayed to them.
 *
 * Grouped by place, never by person. The report is a maintainer's, and who
 * went where is not a maintainer's business — the count is the whole of what
 * this assertion has to say, and printing a user beside it would put personal
 * whereabouts in a terminal and a paste buffer for nothing.
 */
const visitsOnPlacesNoReaderIsShown: CatalogueAssertion = {
  id: 'visits-on-places-no-reader-is-shown',
  area: 'places',
  title: 'Visits recorded against a place no reader-facing read offers',
  kind: 'watch',
  meaning:
    'Expected, and accepted by ADR-0022: a visit outlives the source listing the place. Watch the '
    + 'number rather than the rows — a jump means a run took a batch of places off the map, and each '
    + 'one is a record somebody can no longer see.',
  sql: `SELECT el.id AS location_id,
               el.name AS place_name,
               e.name AS experience_name,
               count(*) AS ticks
          FROM user_visited_locations v
          JOIN experience_locations el ON el.id = v.location_id
          JOIN experiences e ON e.id = el.experience_id
         WHERE NOT (${offeredToReaderSql()})
         GROUP BY el.id, el.name, e.name
         ORDER BY count(*) DESC, e.name`,
  describe: row => {
    const ticks = count(row, 'ticks');
    const place = text(row, 'place_name') || `location ${count(row, 'location_id')}`;
    return `${text(row, 'experience_name')} — ${place}: `
      + `${ticks} ${ticks === 1 ? 'visit' : 'visits'} on a place no reader is shown`;
  },
};

/**
 * An object a reader is offered that no region holds.
 *
 * The first assertion this lane carries about *where things are* rather than
 * about the places themselves, and the first one the catalogue does not pass:
 * 28 objects on the dev catalogue the day it was written. It is here for both
 * reasons — the fact is worth reporting, and a lane whose whole design rests
 * on carrying known debt should be proved against real debt rather than
 * against an empty result.
 *
 * What it means on the ground: the object is in search and on the map, and
 * browsing cannot reach it. Every region page a traveller opens is a list of
 * what is there, and this object is in none of them, so the only way to find
 * it is to already know its name.
 *
 * The known cause is a matching gap rather than a defect in the roll-up — a
 * point that falls just outside every region's boundary (#469) or lies
 * offshore (#470) is placed nowhere at all. That is why the remedy is a
 * curator's manual claim or a better match, and why this number is expected to
 * be worked down rather than to be zero tomorrow.
 *
 * Membership is read whole here, not through `readerRegionMembershipSql`. That
 * fragment answers "may this reader be shown this object *in this region*",
 * which needs a region to be about; the question here is whether **any** row
 * puts the object anywhere, and an object held only by a row a reader cannot
 * see is the previous assertion's business rather than this one's.
 */
const heldByNoRegion: CatalogueAssertion = {
  id: 'held-by-no-region',
  area: 'regions',
  title: 'An object offered to readers that no region holds',
  kind: 'invariant',
  meaning:
    'The object cannot be found by browsing: no region page lists it, though search and the map '
    + 'still have it. Usually a point that fell outside every boundary (#469) or lies offshore '
    + '(#470); the remedies are a better match or a curator placing it by hand.',
  sql: `SELECT e.id AS experience_id,
               e.name AS experience_name,
               e.external_id AS external_id,
               array_to_string(e.country_names, ', ') AS countries
          FROM experiences e
         WHERE ${hideLostSql()}
           AND ${experienceOfferedToReaderSql()}
           AND NOT EXISTS (SELECT 1 FROM experience_regions er
                            WHERE er.experience_id = e.id)
         ORDER BY e.name`,
  describe: row => {
    const where = text(row, 'countries') || 'no country named';
    return `${text(row, 'experience_name')} (${text(row, 'external_id')}): in ${where}, `
      + `and in no region (experience ${count(row, 'experience_id')})`;
  },
};

/**
 * A place the source still offers that no region holds.
 *
 * The point-level half of the assertion above, and where its 28 objects come
 * from: 173 offered points carry no `experience_location_regions` row at all.
 * Both are worth asking. An object no region holds cannot be browsed to; a
 * point no region holds is a pin that votes nowhere, and an object with several
 * places can be perfectly findable while one of its components is not counted
 * anywhere.
 *
 * The predicate is placement's own, not a reader's, and that is the point:
 * placement writes from every *offered* point, unread ones included, precisely
 * so a region curator's queue is not empty (ADR-0025 decision 5). So an offered
 * point missing from the roll-up is placement not having reached it, whatever a
 * reader may see of it.
 *
 * Read as a traveller would: Aldabra Atoll, the Great Barrier Reef, Bikini
 * Atoll, Cordouan Lighthouse standing in the Gironde estuary. What these have
 * in common is water — a boundary set built from land polygons has nowhere to
 * put them (#470), and a point a few metres outside a coastline has the same
 * problem for a different reason (#469).
 */
const offeredPlaceInNoRegion: CatalogueAssertion = {
  id: 'offered-place-in-no-region',
  area: 'regions',
  title: 'A place the source still offers that no region holds',
  kind: 'invariant',
  meaning:
    'Placement never put this point anywhere, so it counts towards no region and votes on no '
    + 'membership. Offshore and just-outside-the-boundary points are the known causes (#470, #469); '
    + 'a jump in this number means a placement run failed rather than a coastline being awkward.',
  sql: `SELECT el.id AS location_id,
               el.name AS place_name,
               e.id AS experience_id,
               e.name AS experience_name
          FROM experience_locations el
          JOIN experiences e ON e.id = el.experience_id
         WHERE ${offeredLocationSql()}
           AND NOT EXISTS (SELECT 1 FROM experience_location_regions r
                            WHERE r.location_id = el.id)
         ORDER BY e.name, el.id`,
  describe: row => {
    const place = text(row, 'place_name') || `location ${count(row, 'location_id')}`;
    return `${text(row, 'experience_name')} — ${place}: on offer and in no region `
      + `(location ${count(row, 'location_id')})`;
  },
};

/**
 * A picture on screen with nobody credited.
 *
 * The one term the licences ask for. Most Commons files are CC BY or CC BY-SA,
 * which of a page that merely shows a photograph ask that its author be named
 * wherever it appears, and UNESCO's syndication terms ask for the same in their
 * own words. `imageCredit.ts` captures the credit at sync time into
 * `metadata.imageCredit` on both tables and `ImageCreditLine` renders it — so a
 * row holding a picture and no credit is a picture displayed with nobody named.
 *
 * Measured the day this landed: 1590 of 1604 objects and 1321 of 1321 works.
 * The largest debt this lane carries, and the two halves got there differently
 * — which is why the line says which of the two a row is.
 *
 * **On the objects, the author is already known and the gate is holding it.**
 * 1414 of the 1590 have a `held` change naming `imageCredit` waiting in the
 * curation queue: a run since ADR-0025 fetched the photographer, the gate
 * refused to write it unread, and it has been waiting ever since. The page
 * meanwhile shows the picture. Publishing that change names the author; the
 * remaining 176 have nothing waiting and need a run to fetch one.
 *
 * **On the works, nothing has fetched one.** `treasureWriter` writes a work's
 * credit straight into its row rather than proposing it, so there is no queue
 * to look in and no `contents` changeset mentions a credit — measured, zero.
 * A museum run is what writes these.
 *
 * That distinction is the whole value of saying it per row: "publish what is
 * waiting" and "go and fetch it" are different afternoons, and a report that
 * called all 2911 one thing would send a person to the wrong one.
 *
 * No lifecycle gate on either side. A credit is owed wherever the picture is
 * shown, and the curation screens show pending rows to curators: working on the
 * catalogue rather than publishing it does not change whose photograph it is.
 * A curator's own chosen picture is included for the same reason — the run
 * leaves a claimed image alone, so nothing else will ever name its author.
 *
 * `metadata->>'imageCredit' IS NULL` covers both shapes of "nothing is claimed
 * about this picture": the key absent, and the key present holding JSON null,
 * which is what a run writes for a claimed image it may not describe.
 */
const pictureWithNobodyCredited: CatalogueAssertion = {
  id: 'picture-with-nobody-credited',
  area: 'pictures',
  title: 'A picture shown with nobody credited',
  kind: 'invariant',
  meaning:
    'The page shows a photograph and names no author, which is the one thing CC BY and CC BY-SA '
    + 'ask of a page that shows a picture, and what UNESCO\'s terms ask in their own words. '
    + 'Where the line says the author is waiting, a run has already fetched it and the gate is '
    + 'holding it — publishing that change names them. Where it does not, a sync run has to fetch '
    + 'one, and a picture a curator chose by hand needs one entered.',
  // "Waiting" is the queue's own question, composed rather than re-spelled.
  // `experience_sync_changes` is provenance and nothing deletes it (#480), while
  // the pointer is cleared the moment a run proposes nothing — a Commons fetch
  // that 429s for one file does exactly that. A flag keyed on the changeset
  // alone would therefore say "waiting on a curator" for ever over an empty
  // queue, and send a person to publish something nobody is holding.
  //
  // The narrow half beside it asks whether what is waiting is *this*: the held
  // field is `metadata` as a whole, so the question is whether the proposal
  // carries an `imageCredit` the stored row does not have. Both halves key on
  // the same pointer.
  //
  // Only objects are asked, because only an object's credit can be held:
  // `treasureWriter` writes a work's straight into its row rather than proposing
  // it, and no `contents` changeset mentions a credit — measured, zero. If that
  // changes, the work arm needs its own question rather than this constant.
  sql: `SELECT 'object' AS holder, e.id AS row_id, e.name AS row_name,
               split_part(split_part(e.image_url, '//', 2), '/', 1) AS host,
               (${heldWaitingSql('e')}
                AND EXISTS (SELECT 1 FROM experience_sync_changes ch
                            CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
                             WHERE ch.experience_id = e.id
                               AND ch.sync_log_id = e.pending_change_sync_log_id
                               AND (f->>'held')::boolean
                               AND f->'new' ? 'imageCredit')) AS credit_waiting
          FROM experiences e
         WHERE e.image_url IS NOT NULL AND e.image_url <> ''
           AND e.metadata->>'imageCredit' IS NULL
         UNION ALL
        SELECT 'work', t.id, t.name,
               split_part(split_part(t.image_url, '//', 2), '/', 1),
               FALSE
          FROM treasures t
         WHERE t.image_url IS NOT NULL AND t.image_url <> ''
           AND t.metadata->>'imageCredit' IS NULL
         ORDER BY 1, 3`,
  describe: row => {
    const waiting = row.credit_waiting === true
      ? ', its author fetched and waiting on a curator'
      : '';
    return `${text(row, 'row_name')}: a picture from ${text(row, 'host') || 'an unnamed host'} `
      + `with nobody credited${waiting} (${text(row, 'holder')} ${count(row, 'row_id')})`;
  },
};

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
 * The list, in the order a person reads it: the two that say a place is stored
 * twice, the one that says an object has nowhere to go, the count that is not
 * a violation, the two about where things are, the one about a fact stored
 * twice, and the one about whose photograph is on the page.
 *
 * Adding to it is the whole extension mechanism — an object with an id, an
 * area, a sentence, a query and a way to say one of its rows out loud. Nothing
 * else needs touching, and a new assertion's first run reports what it finds
 * rather than pretending the catalogue was always clean.
 */
export const catalogueAssertions: CatalogueAssertion[] = [
  withdrawnBesideItsReplacement,
  twoOfferedPlacesAtOneReference,
  listedWithNowhereToGo,
  visitsOnPlacesNoReaderIsShown,
  heldByNoRegion,
  offeredPlaceInNoRegion,
  ...regionGeometryAssertions,
  ...divisionTreeAssertions,
  dangerFlagAgainstItsTag,
  pictureWithNobodyCredited,
];
