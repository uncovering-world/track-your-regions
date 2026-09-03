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
import { heldFieldRefusedSql, heldPartRefusedSql } from '../../experience/heldDecisions.js';
import { LOCATION_UNCHANGED_METERS } from '../../../services/sync/changeSet.js';

import { DISPLAYABLE_PICTURE_HOSTS, PICTURE_EXTENSIONS } from '../../../types/urlSafety.js';

import { count, text } from './assertion.js';
import type { AssertionRow, CatalogueAssertion } from './assertion.js';
import { divisionTreeAssertions } from './divisionTreeAssertions.js';
import { objectAssertions } from './objectAssertions.js';
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
 * wherever it appears — and every picture the product draws is a Commons file
 * (ADR-0043), so that is the only term in play. `imageCredit.ts` captures the
 * credit at sync time into `metadata.imageCredit` on both tables and
 * `ImageCreditLine` renders it — so a row holding a picture the product draws
 * and no credit is a picture displayed with nobody named. A picture on a host
 * the drawing side refuses is not drawn, so it is not this check's: it is
 * `picture-the-product-may-not-show`'s, and its remedy is the repair button.
 *
 * Measured the day this landed (2026-08-24): 1590 of 1604 objects and 1321 of
 * 1321 works — the largest debt this lane carried. 1414 of those objects had a
 * `held` change naming `imageCredit` waiting in the queue: the portal's own
 * photographer, fetched from its export for a photograph the product has since
 * stopped drawing. ADR-0043 changed both halves of that picture: the World
 * Heritage rows now carry a Commons file *with* its credit, written by the
 * repair rather than proposed, so on the dev database this check fell from
 * 1590 to the 330 Commons pictures that really lack one (2026-09-02). What the
 * `credit_waiting` flag still tells apart is the same two afternoons — a credit
 * a run fetched and the gate is holding, against one nobody has fetched — and
 * the line says which of the two a row is.
 *
 * **On the works, nothing had fetched one when this landed** — 1321 of 1321,
 * with one shape excepted since ADR-0037. `treasureWriter` writes a work's
 * credit straight into its row, and a museum run is what writes these, so the
 * runs since have brought that to 77 (2026-09-02); but a *held* picture holds
 * its credit with it,
 * and the credit the run fetched for that picture rides in the museum's contents
 * record as a `metadata.imageCredit` entry beside the held `image_url`. So the
 * work arm below asks the museum's pointer for exactly that entry, and a work
 * reads "waiting" only where its picture is itself waiting on a curator.
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
    + 'ask of a page that shows a picture. '
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
  // The narrow half beside it asks whether what is waiting is *this*, and has to
  // ask it of both record shapes because both are live. Since ADR-0039 the held
  // field is `metadata.imageCredit` and its value is the credit; a card filed
  // before it holds `metadata` as a whole, where the question is whether the
  // payload carries an `imageCredit` the stored row does not have. The second is
  // the compatibility half, not the first. Both key on the same pointer.
  //
  // A work is asked too, since ADR-0037, and its question is shaped by where a
  // held credit lives: the treasures upsert holds a work's credit only with its
  // picture, and the credit the run fetched for the held picture rides in the
  // museum's contents record as a `metadata.imageCredit` entry beside the
  // `image_url` one (`treasureWriter.ts`, `creditChange`). So the work arm walks
  // the museum's pointer to that record and looks for a held credit naming this
  // work — through this venue's link, since the pointer is the museum's. A
  // credit fetched for a picture the row already shows is written, not held, so
  // a work with a picture and no credit is "go and fetch one" unless its picture
  // is itself waiting on a curator.
  //
  // Waiting, and not merely proposed: a credit a curator refused (#722) is
  // settled, no card offers it any more, and reporting the row as waiting would
  // point at a screen that has nothing to say about it.
  //
  // **Refused, not merely answered** — the one place this asks a narrower
  // question than the queue does, and the reason is `creditPin`'s: on a card
  // filed before ADR-0039, publishing the object's source-data row while its
  // picture is still open and different deliberately withholds the run's credit,
  // and publishing the picture afterwards finishes what that call had to leave.
  // Since ADR-0039 the credit is its own row and `partnerOf` couples it to the
  // picture, so the two move together and this cannot arise on a newer card. So a *published* credit can
  // still be one click from being written, and reading it as settled would drop
  // "waiting on a curator" from a row that is — sending an admin to find a
  // photographer the queue could have named. A refusal is the only answer after
  // which nothing will come. Keyed on the field on one side and on the part on
  // the other, from the same module the queue and the count compose.
  sql: `SELECT 'object' AS holder, e.id AS row_id, e.name AS row_name,
               split_part(split_part(e.image_url, '//', 2), '/', 1) AS host,
               (${heldWaitingSql('e')}
                AND EXISTS (SELECT 1 FROM experience_sync_changes ch
                            CROSS JOIN LATERAL jsonb_array_elements(ch.changed_fields) AS f
                             WHERE ch.experience_id = e.id
                               AND ch.sync_log_id = e.pending_change_sync_log_id
                               AND (f->>'held')::boolean
                               AND NOT ${heldFieldRefusedSql('e.id')}
                               -- Both record shapes, because both are live. Since
                               -- ADR-0039 the credit is an entry of its own, whose
                               -- new value *is* the credit; before it the credit
                               -- was a key inside the catch-all payload, and a
                               -- card filed then stands until a run re-proposes.
                               -- Asking only the older shape would answer false
                               -- for every card a run files from here and send an
                               -- admin to fetch a photographer the queue can name
                               -- in one click, which is the exact confusion this
                               -- check exists to prevent.
                               -- And that it actually carries one. The older
                               -- shape asked this implicitly, by testing for the
                               -- key; the work arm below asks it outright. A run
                               -- that *removes* a credit files an entry under the
                               -- same name whose new value is absent -- the shape
                               -- creditPin's remaining live arm is named after --
                               -- and naming it waiting would append "its author
                               -- fetched and waiting on a curator" to a row where
                               -- no author is on offer at all.
                               AND ((f->>'field' = 'metadata.imageCredit'
                                     AND jsonb_typeof(f->'new') = 'object')
                                    OR (f->>'field' = 'metadata' AND f->'new' ? 'imageCredit'))
                               )) AS credit_waiting
          FROM experiences e
         WHERE e.image_url IS NOT NULL AND e.image_url <> ''
           -- A picture on a host the drawing side refuses is not shown, so
           -- nobody is uncredited for it: that row is the other assertion's,
           -- and its remedy is the repair button rather than a run. Without
           -- this, every row still carrying the portal's photograph read as a
           -- photograph on show needing a photographer (ADR-0043).
           AND ${drawableHostSql('e.image_url')}
           AND e.metadata->>'imageCredit' IS NULL
         UNION ALL
        SELECT 'work', t.id, t.name,
               split_part(split_part(t.image_url, '//', 2), '/', 1),
               EXISTS (SELECT 1
                         FROM experience_treasures et
                         JOIN experiences e ON e.id = et.experience_id
                         JOIN experience_sync_changes ch ON ch.experience_id = e.id
                                                        AND ch.sync_log_id = e.pending_change_sync_log_id
                         CROSS JOIN LATERAL jsonb_array_elements(
                           COALESCE(ch.contents -> 'treasures' -> 'changed', '[]'::jsonb)) AS c
                         CROSS JOIN LATERAL jsonb_array_elements(c -> 'fields') AS f
                        WHERE et.treasure_id = t.id
                          -- The queue's own question, composed as the object arm
                          -- composes it: a refused or missing museum keeps its
                          -- pointer while the held card hides it, and keyed on the
                          -- pointer alone this would say "waiting" about a change
                          -- no screen offers to publish.
                          AND ${heldWaitingSql('e')}
                          AND c -> 'item' ->> 'ref' = t.external_id
                          AND f ->> 'field' = 'metadata.imageCredit'
                          AND (f->>'held')::boolean
                          AND NOT ${heldPartRefusedSql('e.id', "'treasures'")}
                          AND jsonb_typeof(f -> 'new') = 'object') AS credit_waiting
          FROM treasures t
         WHERE t.image_url IS NOT NULL AND t.image_url <> ''
           AND ${drawableHostSql('t.image_url')}
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
 * Is this stored picture one the product draws?
 *
 * `isDisplayablePictureUrl`, spelled in SQL from the same two lists
 * (ADR-0043): a Commons host or a subdomain of one — under `/wikipedia/commons/`
 * on the upload host — naming a picture file and not the `/wiki/File:` page
 * about one, or an `/images/` path on our own origin, the one local shape the
 * drawing side maps. All four arms, not the host alone, so that the two picture
 * assertions partition the rows: a Commons PDF is not a picture nobody is
 * credited for, it is a picture the product may not show. `split_part` twice
 * reads the authority out of a url without a parser, which is enough for a
 * stored value the writers have already judged.
 */
function drawableHostSql(column: string): string {
  const hosts = DISPLAYABLE_PICTURE_HOSTS.map((host) => `'${host}'`).join(', ');
  // A subdomain of a listed host counts, as it does for `isPictureHost`.
  const subdomains = DISPLAYABLE_PICTURE_HOSTS.map((host) => `'%.${host}'`).join(', ');
  // The host as the parser reads it — lowercased, without a port — and the
  // path behind any-case scheme letters, so the SQL agrees with `new URL()`.
  const host = `lower(split_part(split_part(split_part(${column}, '//', 2), '/', 1), ':', 1))`;
  const path = `substring(${column} FROM '^[A-Za-z]+://[^/]+(/[^?#]*)')`;
  const extensions = PICTURE_EXTENSIONS.map((ext) => ext.slice(1)).join('|');
  return `(${column} LIKE '/images/%'
           OR ((${host} = ANY (ARRAY[${hosts}]) OR ${host} LIKE ANY (ARRAY[${subdomains}]))
               AND (${host} NOT LIKE '%upload.wikimedia.org' OR ${path} LIKE '%/wikipedia/commons/%')
               AND ${path} !~* '^/wiki/File:'
               AND ${path} ~* '\\.(${extensions})$'))`;
}

/**
 * A stored picture the product may not draw.
 *
 * ADR-0043's own invariant over live rows: every `image_url` names a Commons
 * file or a file we host, because the World Heritage Centre's terms do not
 * let this product show its photographs and every writer refuses any other
 * host now. What this catches is the past — 1260 rows carried
 * `whc.unesco.org/document/<id>` on the day the rule landed, and a database
 * restored from before it carries them still. Such a row shows no picture at
 * all (the drawing side refuses the host), so nothing is being shown wrongly;
 * what is wrong is a card with an empty frame and a stored value nothing will
 * ever draw. The remedy is one button, *Fix pictures* on the source's card in
 * the sync panel, which is why the sentence names it rather than a run.
 *
 * Both tables, because both are shown: a work's photograph is drawn on the
 * same terms as the object's.
 */
const pictureTheProductMayNotShow: CatalogueAssertion = {
  id: 'picture-the-product-may-not-show',
  area: 'pictures',
  title: 'A stored picture on a host whose terms do not let us show it',
  kind: 'invariant',
  meaning:
    'The row names a photograph on a host the product may not draw from — the World Heritage '
    + 'portal\'s own, on every row imported before ADR-0043 — so the card shows an empty frame '
    + 'and the stored value is one nothing will ever draw. Press Fix pictures on the source\'s '
    + 'card in the sync panel: it replaces each one from Commons where Wikidata states a '
    + 'picture, and takes the rest off. A picture a curator chose by hand from elsewhere is '
    + 'refused on the way in now; one stored before that needs a curator to replace it.',
  sql: `SELECT 'object' AS holder, e.id AS row_id, e.name AS row_name,
               split_part(split_part(e.image_url, '//', 2), '/', 1) AS host
          FROM experiences e
         WHERE e.image_url IS NOT NULL AND e.image_url <> ''
           AND NOT ${drawableHostSql('e.image_url')}
         UNION ALL
        SELECT 'work', t.id, t.name,
               split_part(split_part(t.image_url, '//', 2), '/', 1)
          FROM treasures t
         WHERE t.image_url IS NOT NULL AND t.image_url <> ''
           AND NOT ${drawableHostSql('t.image_url')}
         ORDER BY 1, 3`,
  describe: row =>
    `${text(row, 'row_name')}: a picture stored from ${text(row, 'host') || 'an unnamed host'}, `
    + `which the product may not show (${text(row, 'holder')} ${count(row, 'row_id')})`,
};

/**
 * The list, in the order a person reads it: the two that say a place is stored
 * twice, the one that says an object has nowhere to go, the count that is not
 * a violation, the two about where things are, the rules about regions and
 * about the boundaries under them, the rules about an object as a row, and the
 * pair about pictures — a stored one the product may not draw, then a drawn
 * one nobody is credited for.
 *
 * Adding to it is the whole extension mechanism — an object with an id, an
 * area, a sentence, a query and a way to say one of its rows out loud. Nothing
 * else needs touching, and a new assertion's first run reports what it finds
 * rather than pretending the catalogue was always clean. A rule joins the file
 * of its area where one exists, and the registry spreads that file's list.
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
  ...objectAssertions,
  pictureTheProductMayNotShow,
  pictureWithNobodyCredited,
];
