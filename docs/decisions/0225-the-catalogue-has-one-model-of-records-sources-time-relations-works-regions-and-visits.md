# ADR-0225: The catalogue has one model: a record, its shape and time, its sources and kinds, its relations, works, regions and visits

**Date:** 2026-11-18
**Status:** Accepted — by the session that owns queue #2458, to which the maintainer delegated the acceptance on 2026-11-17 ([#2458, 21:21Z](https://github.com/uncovering-world/track-your-regions/issues/2458#issuecomment-6961352212): "the model document (#2634) is the session's to build, verify by several independent reviews and accept; no page for the maintainer and no further questions")
**Issue:** [#2634](https://github.com/uncovering-world/track-your-regions/issues/2634), queue #2458
**Built by:** #2634, #2124, #2125, #2126, #2127, #1719, #2128, #2584, #2585, #2008, #2009, #768, #1169, #2135, #2594, #1171, #2580, #2631, #1948, #1676, #2581, #2582, #2583, #2577, #2578, #2579, #2116, #2129, #2132, #2131, #586, #1907, #2015, #584, #2633
**Narrows:** [ADR-0022](0022-locations-are-marked-not-deleted.md) decisions 1 to 3 (a point's `missing_since`: the points retire, and a part's record carries it);
[ADR-0023](0023-works-first-museum-selection.md) decision 2 (no place carries the Iconic badge);
[ADR-0024](0024-a-category-may-refuse-what-the-source-still-lists.md) decisions 1 and 5 (`admission_reason` is a code with its evidence; no place badge; `curated_fields` is a list of words);
[ADR-0025](0025-per-source-curation-gate.md) decision 2 (no point table carries the gate: a part's gate is its record);
[ADR-0026](0026-a-run-records-what-a-container-holds.md) decisions 6 and 7 (`existence` and the points retire);
[ADR-0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md) decisions 1, 4a, 5 and 6 (the point tables retire);
[ADR-0029](0029-what-an-object-is-made-of-can-be-curated.md) decisions 1, 3 and 5 (the points retire; a claim is read with `= ANY` over a list of words);
[ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) decision 6 (the source's handle on a part is its part record);
[ADR-0038](0038-a-held-proposal-is-answered-per-field.md) decision 3 (an answer is keyed by the record or the work);
[ADR-0039](0039-a-run-records-facts-not-columns.md) decision 1 (`metadata` keeps the picture credit and UNESCO's mark only; facts are columns and tables);
[ADR-0040](0040-a-work-names-every-one-of-its-makers.md) decisions 1 and 4 (public art's makers are rows of `experience_makers`);
[ADR-0044](0044-a-work-leaves-a-museum-behind-a-floor-measured-on-works.md) decision 1 (a reader of works also reads `here_today`);
[ADR-0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) decisions 4 and 5 (a visit is on a record; the badge is on works only);
[ADR-0048](0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md) decisions 2 and 5 (no place badge; the admitting tier is a column);
[ADR-0052](0052-a-place-of-worship-is-admitted-for-itself-or-for-what-it-holds.md) decisions 1, 2 and 6 (no place badge; `admitted_for` is an item and a label; the admin's line governs a held work's door only);
[ADR-0053](0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md) decisions 1 and 2 (a reason code and no badge; a part's refusal is on its part record);
[ADR-0058](0058-archaeology-is-one-kind-of-sites-and-museums.md) decisions 3 and 5 (a find spot is a column of the work; the place line is `admissionRegister.ts`'s);
[ADR-0067](0067-accepting-a-refusal-keeps-it-and-a-batch-answer-pins-nothing.md) decisions 2 and 3 (`admission_decided_at` and `_by`);
[ADR-0070](0070-the-database-refuses-a-curation-state-move-the-gate-does-not-allow.md) (`existence` is gone; `source_membership` is derived from the listing periods);
[ADR-0084](0084-a-place-belongs-to-no-source-and-no-kind.md) decisions 2 and 3 (no badge on a membership; a record's provenance is its first source record);
[ADR-0086](0086-a-merge-is-a-record-that-moves-a-place-into-another-and-back.md) decisions 3 and 5 (the points retire; a curator's id on any log row is set null with the account);
[ADR-0090](0090-a-component-renumbered-by-an-extension-is-the-same-point.md) decision 1 (the row kept is a part record);
[ADR-0100](0100-a-serial-sites-components-are-places-part-of-the-site.md) decisions 1 and 2 (the points retire; no place badge);
[ADR-0111](0111-a-shared-field-that-names-a-familys-own-field-goes-with-it.md) (`country_names` and `country_codes` retire: a record's countries are read from its placement);
[ADR-0117](0117-the-location-pairing-is-made-complete-before-any-arm-reads-it.md) (the pairing pairs records, not points);
[ADR-0125](0125-a-type-answer-is-the-kinds.md) (the answer's key is the record or the work, not a part's kind, reference and name);
[ADR-0126](0126-the-two-tiers-differ-by-source-and-weigh-the-same.md) decision 3 (the badge marks works only);
[ADR-0129](0129-a-wikidata-item-a-place-holds-none-of-passes-the-gate.md) decision 1 (the item is the source record's id, not `metadata.wikidataQid`);
[ADR-0134](0134-openstreetmap-is-read-from-a-layer-cut-from-the-planet-and-a-miss-the-layer-cannot-vouch-for-is-asked-live.md) decision 3 (the objects an outline was read from are named on its view);
[ADR-0137](0137-a-point-a-reader-sees-is-another-sources-point-within-ten-metres.md) decision 2 (the adopted reference is the part record's id);
[ADR-0138](0138-unescos-page-about-a-site-is-kept-by-every-other-familys-run.md) decision 1 (the UNESCO page is a column; the rule stands);
[ADR-0140](0140-a-short-move-passes-the-gate.md) decision 3 (`moved_to_location_id` goes with the points);
[ADR-0143](0143-a-place-is-found-by-its-identifiers-before-a-run-creates-one.md) decision 6 (as ADR-0084 decision 3);
[ADR-0144](0144-a-curator-separates-one-kinds-membership-into-a-place-of-its-own.md) decision 1 (the original keeps its source record, not a pair on the place);
[ADR-0145](0145-an-edition-is-one-place-with-a-point-at-every-cast.md) decisions 1, 3 and 4 (a cast group is a whole whose casts are parts of the role `copy`);
[ADR-0146](0146-a-places-outline-belongs-to-the-source-that-drew-it.md) its storage, in its introduction and decisions 1 and 2 (an outline is a view on its source's record; the owner rule stands);
[ADR-0149](0149-what-the-catalogue-takes-from-unescos-dataset-it-keeps-separable-credits-and-offers-under-cc-by-sa.md) decision 4 (whose description it is is `description_source`);
[ADR-0153](0153-a-field-belongs-to-the-place-or-to-one-kind.md) decision 2 (kind facts are typed tables, not `facts`);
[ADR-0164](0164-a-find-its-readers-carry-counts-as-one-at-the-finds-line.md) decision 1 (no place badge);
[ADR-0166](0166-a-work-wikipedia-files-in-a-museums-collection-is-the-museums-where-wikidata-says-nothing.md) decision 3 (what placed a work is on its placement, not on the work);
[ADR-0190](0190-a-place-field-some-sources-read-is-kept-while-one-of-them-stands.md) (what a monument commemorates is held in subject lines);
[ADR-0197](0197-a-places-regions-are-one-row-per-region-written-by-one-function-from-the-points-it-shows.md) decisions 4 and 5 (the point tables go now);
[ADR-0198](0198-every-sources-record-of-a-place-is-one-row-in-a-kind-or-in-a-whole.md) decision 1 (which sources fill no kind is a rule of id schemes);
[ADR-0206](0206-one-visited-place-visits-the-whole-which-reads-k-of-n-over-its-offered-leaves.md) decision 4 (the triggers are on `experience_parts` and `source_records`);
[ADR-0210](0210-a-dispersed-whole-holds-no-point-and-every-line-of-a-serial-site-is-a-part.md) decision 3 (an edition's casts are parts);
[ADR-0212](0212-the-openstreetmap-layer-keeps-whole-the-objects-of-a-bridges-item-and-its-line-places-it.md) decisions 2 and 3 (a line is a view on its source's record);
[ADR-0217](0217-time-in-the-catalogue-is-held-as-periods-and-the-catalogue-is-read-as-of-a-date.md) decisions 4, 7 and 8 (the kinds kept outside are a column; a record gone before 1900 is listed and not ticked; a trip before the beginning or in a gap is refused);
[ADR-0224](0224-the-open-rules-of-adr-0217-to-adr-0219-are-the-maintainers-and-a-tick-paints-only-the-ground-the-traveller-was-on.md) decisions 2, 5 and 6 (an event held at one place with no dated period answers that place on any trip, undated too; a view's own tree is read as ground in that view; a record gone before 1900 takes no undated tick), and its open questions are answered
**Supersedes:** none. Every ADR named above keeps the decisions this one does not name.

---

## Context

The catalogue's model was decided in pieces: time (ADR-0217), shape and "part of" (ADR-0218),
visits (ADR-0219), and the maintainer's answers to their open rules (ADR-0224). Four designs were
still open: the relations between records (#2581), the long object a traveller goes along
(#1948), the record that is not a place (#1676), and each source's outline and line of a place
(#2583). Today's schema (`db/init/01-schema.sql` and the migrations up to 262) still holds what
those decisions retire: the three point tables, `experiences.existence`, the `facts` JSON of a
membership, the Iconic badge on a membership, and three tables of visits. No one document said
what the database is once all of it holds, so slices were cut from decisions read one at a time.

On 2026-11-17 the maintainer decided ([#2458, 21:13Z](https://github.com/uncovering-world/track-your-regions/issues/2458#issuecomment-6961170411)) that the whole model is written
as one document with its target schema before the code slices are built, that the open designs
are designed inside it, and that the slices are cut from the difference between it and today's
schema. At 21:21Z the same day the maintainer gave the document, its reviews and its acceptance
to the session, with no further questions.

The model was built in five steps:

1. **A core skeleton**: one vocabulary, one set of keys and conventions, one owner per table, and
   the session's decisions on the conflicts that cut across domains.
2. **Eight domain designs** built on it: the record (D1); time (D2); sources, kinds, admission and
   curation (D3); relations between records (D4); works (D5); regions and world views (D6);
   travellers and visits (D7); records beyond a point (D8). Each accounts for every requirement of
   the registers drawn from the accepted ADRs, the maintainer's recorded decisions, the open issues
   and the product documents.
3. **An integration** that settled 22 conflicts between the domains and mapped the 151 requirement
   rows no domain had placed: 72 are held by a table, column or constraint, 55 by a writer's or a
   reader's rule, and 24 are held by nothing, each with its reason (§ What this ADR does not
   decide).
4. **Five independent reviews**, each by its own session: conformity to every accepted ADR, the
   maintainer's decisions, the open issues that build on the model, the seasoned traveller walking
   real places through it, and the engineering. The session gave sixteen binding rulings on their
   findings, and every finding was applied or declined with its reason.
5. **A second round of review** of the revised model, by the seasoned traveller and by the
   engineer. The session gave ten more binding rulings on their findings, and every finding was
   applied as ruled.

The result is a target schema of the 97 tables listed below. It writes out 94 of them; the three
tables of the world-view editor's custom-subdivision dialog are kept as today's schema states
them. It loads alone into an empty PostGIS database and loads again over itself without change.

The working papers are not published (`docs/README.md` § Where things live), and this ADR is the
model's record. The DDL is not copied into `docs/`, because `docs/tech/` describes what exists. It
is published as it lands: as the migrations from 263 on in `db/migrations/`, and in
`db/init/01-schema.sql`, which the fresh build (#2129) reads alone. Until then the table list
below is the model's statement of every table.

## The model in plain words

### The words

| word | means | example |
|---|---|---|
| **record** | one thing the catalogue offers: a place, an area, a line, a dish, a festival, a type of thing | Cologne Cathedral; Maslenitsa at Bakshevo |
| **place** | a record with ground of its own (any shape but `none`) | Nelson's Pillar |
| **serial object** | a record of shape `none` that has parts | the Struve Geodetic Arc |
| **extended object** | a record with an area or a line of its own that also has parts | Museum Island |
| **source record** | one source's record of one record, in a kind or in a whole | the World Heritage record 292bis of Cologne Cathedral |
| **membership** | a source record in a kind | Cologne Cathedral in Places of worship |
| **part record** | a source record in a whole | a station's record in the Struve Arc |
| **kind** | what a traveller browses by | World Heritage Sites, Art Museums |
| **source** | how a kind is filled | the UNESCO list; Wikidata |
| **period** | something was so from one date until another | Nelson's Pillar stood 1809 → 8 March 1966 |
| **work** | a trackable item inside a venue | the Great Wave; the Pergamon Altar |
| **brick** | a division of the base layer (GADM today) | the division Andorra |
| **region** | a node of a world view, made of bricks | Toscana |
| **canon** | the one layer visits are counted on | — (#587 builds it) |
| **visit**, **tick** | one row per traveller and thing met; a visit as the traveller makes it | a tick on the Uffizi |

### A record

Everything the catalogue offers is a **record**, one row of `experiences`. Cologne Cathedral is
one record although two kinds offer it, World Heritage Sites (as 292bis) and Places of worship (as
Q4176). Maslenitsa at Bakshevo is a record although it has no ground of its own; so is
thieboudienne, the Gion Matsuri and the khachkar as a type. The table keeps its name: a rename
would touch 29 tables through 37 foreign keys, every writer list and the generated clients, and
buy no clarity. In prose and in comments a row of it is a record, and "place" is kept for a record
with ground.

A record belongs to no source. It has its own id; the first source that brought it is read from
its first source record, and `experiences.source_id` and `external_id` retire. It holds the value
a reader sees of every field:

- its name, subtitle and description, with whose text the description is
  (`description_source`: UNESCO's, an adaptation of it, or a curator's own);
- its picture with its credit;
- its Wikipedia and UNESCO pages as columns, and its official websites as rows;
- its makers as rows (`experience_makers`): Nelson's Pillar was designed by William Wilkins, and
  its statue was carved by Thomas Kirk;
- what a monument commemorates or depicts (`experience_subject_lines`, `experience_subjects`): the
  Lincoln Memorial commemorates, Christ the Redeemer depicts. A line read with nobody named is
  kept as such, so "read, and nobody" is told apart from "never read".

`metadata` keeps only the picture credit and UNESCO's mark of what was taken from its dataset; every
other fact has a column or a table. A curator's claim on a field is the field's value plus the
field's name in `curated_fields`, a list of words checked against a closed list. Each source's
view of a field stays on that source's record (`reported_*`).

A run never deletes a record. A record gone on the ground is held by its periods. Two records
found to be one are merged: the folded row is kept whole, so the merge can be undone.

### Its shape

Each record states its shape (ADR-0218): `point`, `area`, `line` or `none`.

- **Nelson's Pillar** is a `point`. It was blown up in 1966 and keeps its pin; its periods say it
  no longer stands.
- **Museum Island** is an `area`. Once its own outline is held, its coordinate is emptied and its
  pin is derived from the outline. The Neues Museum is a part of it by a curator's answer, and the
  Altes Museum lies within it.
- **The Øresund Bridge** is a `line`, 7.8 km of bridge, which crosses Hovedstaden and
  Skåne. Its deck crosses water that no region holds, so its two ends place it.
- **Lake Baikal** is an `area` whose shore takes its coordinate away.
- **The Struve Geodetic Arc** is `none` with parts: 34 stations in ten countries. It holds no
  coordinate, is drawn by its stations, and reads "1 of 34" for a traveller who has seen one.
- **Hadrian's Wall** is `none`: a collection of its forts, Housesteads among them, and itself a
  part of the Frontiers of the Roman Empire. The Hadrian's Wall Path is a record of its own, a line
  of 135 km.
- **The Pergamon Altar** is a `point` in Berlin. The outline its source sent is the ancient city's,
  in Izmir Province 1,827 km away: a drawing, never the altar's own, so it places the altar in no
  region.

One trigger derives the pin, the extent and the zoom at which the extent is drawn from what the
record holds. Nothing infers a shape from a missing coordinate.

### Its time

ADR-0217's model is built whole. Every date of the world is an approximate date (a year, perhaps a
month and a day, perhaps "about", a decade or a century), because Göbekli Tepe begins about
10,000 BC and a Postgres `date` stops at 4713 BC. A **period** is two such dates, whether it has
ended, and the first and last day it can cover as day counts, which every comparison reads. One
CHECK holds the block on every table that has one, and nothing else stores historical time.

- **When a record stood, was used, was closed or is held** (`place_periods`), for the record or
  for one kind. Nelson's Pillar stood from 1809 to 8 March 1966. The Cathedral of Christ the
  Saviour stood from 1883 to 1931 and again since 2000. The Pergamon Museum is closed since
  23 October 2023: a `closed` period, not a table of closures. Frick Madison was an Art Museum
  from 2021 to 3 March 2024 while the building still stands: a period of that kind only.
- **Each source's view of those periods** (`record_periods`), rewritten whole by its run.
- **When a membership was listed** (`record_listings`): Liverpool's World Heritage record from
  2004 to 21 July 2021.
- **When a site stood on the Danger List** (`record_danger_periods`): Cologne Cathedral 2004 to
  2006; Liverpool 2012 to its delisting in 2021.
- **What repeats every year** (`place_seasons`): boats to Sceilg Mhichíl from May to September;
  the Gion Matsuri in July. Maslenitsa's rule (Easter minus 55 days, for seven days) is held in
  words until #2633 computes movable dates.
- **Where a record stood before it moved** (`place_past_positions`): the Arch of Neutrality in the
  centre of Ashgabat until 2010. Each past position is placed in regions
  (`place_past_position_regions`), so a map read as of 2005 finds it where it was.
- **What a pass proposes about time** for a curator to answer (`experience_time_proposals`).

Whether a record stands today, and whether a membership is still listed, are derived by triggers
from those periods and written by nothing else.

### Its sources and kinds

A **kind** (`experience_kinds`, ids 1 to 9) is what a traveller browses by. It now also says how a
tick on its records reads:

- its form;
- its verb ("tried" for a dish, "attended" for a festival, "walked" for a trail);
- what a tick paints: the record's own ground, the place an event was held at on the trip's date,
  or nothing until the traveller says where;
- whether a visit may hold kilometres;
- whether its list is kept by a body outside the catalogue. World Heritage's is, so Liverpool moves
  to "no longer listed" when it leaves. Art Museums' is not, so the Guggenheim Bilbao, leaving by a
  change of the catalogue's own rule, simply leaves.

A **source** (`experience_sources`) is how a kind is filled. It fills one kind or none. Sources 1
to 11 keep their ids, and three are added:

- 12, *Wikidata statements*: part of, held at, replica of, replaced by;
- 13, *OpenStreetMap*;
- 14, *Wikivoyage*.

None of the three fills a kind as seeded. A source keyed by components, statements or a curator's
key never fills one, while an OpenStreetMap or Wikivoyage source may (a trail kind keyed by route
relations, #1948).

A **source record** (`source_records`) is one source's record of one record, either in a kind (a
membership) or in a whole (a part record), never both. A membership holds:

- the admission and its reason, a code with the evidence beside it;
- the tier that admitted it (world, surroundings or regional);
- the item it was admitted for, as an item and a label: the Pergamon Museum entered Art Museums
  for the Pergamon Altar;
- the source's view of each field;
- the regions the source names, with the GADM country codes the run resolved: the Wadden Sea names
  the Netherlands, Germany and Denmark;
- on a part record, what a visitor finds there.

A kind's own facts have typed tables: the World Heritage inscription
(`record_heritage_inscriptions`), the Danger List stays, and what a Wikidata rule read to admit a
membership (`record_rule_reads`). The curation gate's tables keep their roles. The Iconic badge
leaves memberships: no place carries it, and it stays on works.

### Its relations

- **Part of** (`experience_parts`) is derived from part records and written by nothing else. Each
  of the Struve Arc's 34 stations holds a World Heritage components record in the Arc. Housesteads
  holds a Wikidata-statement record in Hadrian's Wall, and a curator's "part of" is a record of the
  Curators source. A part's role is `part`, `copy` (a cast in a cast group) or `section` (a stage
  of a trail), with its order. "k of N" counts over the whole's leaves (`whole_leaves`).
- **Lies within** (`experience_lies_within`) is derived from geometry: the Altes Museum lies within
  Museum Island. A part is never also "within", since the Neues Museum would count twice.
- **Same** is a merge (`experience_merges`), undoable.
- **Every other relation** is a row of `experience_relations`:
  - *met at*: the khachkar at Noratus, one of them; a museum with one khachkar, where one can be
    seen;
  - *held at*, with its periods (`experience_relation_periods`): Maslenitsa at Bakshevo; Holy Week
    in Seville, which is held across the city, names its region instead;
  - *replica of*: Lascaux IV of the cave;
  - *replaced by*: Old St. Peter's by St. Peter's Basilica; Nelson's Pillar by the Spire of Dublin;
  - *runs along*: a towpath along the Canal du Midi, with the metres along the canal.

  A source proposes each relation and a curator answers. No curator enters a relation from
  nothing.

The outside ids a record is found by are `place_identifiers`. A series that no list makes a whole
is proposed to a curator in `experience_series_proposals`, and the answered row marks a confirmed
series. A type with thousands of instances, such as the khachkar, is a class object and no series.

### Its works

A **work** (`treasures`) is a thing inside a venue.

- **Copies of one matrix are one work.** The Great Wave is one row with eleven museum links, each
  link being that museum's impression, with its own item where it has one. A version made again,
  such as Matisse's *Dance (I)* and *Dance II*, is a work of its own.
- **A link has periods** (`experience_treasure_periods`). *The Concert* was at the Isabella Stewart
  Gardner until it was stolen on 18 March 1990. *Guernica* was at MoMA from 1939 to 1981 and is at
  the Reina Sofía since 1992. Whether a work is here today is derived from those periods, and each
  source's view of them is kept beside them (`experience_treasure_period_views`).
- **A work's other facts.** What placed a work at its venue is on its placement, not on the work.
  The site a find came from is a link of its own: the Dendera zodiac in the Louvre is linked to the
  Dendera Temple. The Iconic badge is on works only.
- **A record and a work can be one object.** The Pergamon Altar is a record and a work of the
  Pergamon Museum, and one link ties the two, so one sighting is one tick.

### Its regions and world views

The base layer's divisions are **bricks**. A **world view** is a tree of regions, each made of
bricks (`region_members`) or drawn by hand. Regions are compared by bricks: a region covers another
only when it holds all of its bricks. The only allowance is for measuring: a gap of 0.5 % of a
brick's area or less counts as held, which is the largest difference measured between a division
and the divisions under it. A whole Spain paints no Europe, because the Canaries lie in Africa.

- **The canon.** One view is the canon (`world_views.is_canon`), and its counting layer is marked
  (`regions.counts`). Until #587 builds it, the leaves of the Administrative view stand in for it.
- **Placement.** A record is placed by its own ground (`experience_shape_regions`, by basis:
  point, outline, line, nearest, a region a source names, the place an event is held at). Its
  regions in every view (`experience_regions`) are derived, or are a curator's placement.
  - An outline or a line is the record's own ground only where it reaches the pin, so the
    outline of ancient Pergamon places the altar standing in Berlin nowhere.
  - A line is placed also by its two ends: the Øresund Bridge is in Hovedstaden and Skåne.
  - A country a source names places a record only where the record has no ground in any region.
    Thieboudienne, with no ground, is in Senegal. The Great Barrier Reef, an outline at sea that
    touches no land, is in Australia. A chapel on the Iranian bank of the Aras is under Iran by
    its pin, whatever country a source names.
- **A region drawn by hand** (Lake Baikal's) lies on the canon regions of which at least 0.5 % of
  their own area lies inside its outline: Irkutsk Oblast and Buryatia, and not a third oblast that
  a simplified shore grazes.
- **A region that changes** is either **redrawn** or **replaced as an entity** (`region_changes`):
  - Languedoc-Roussillon redrawn into Occitanie: its ticks and placements move, then its row is
    deleted;
  - Artsakh, replaced on 1 January 2024: closed with its period and kept, with its ticks. The
    country of an old visit is read from such closed regions, and no table of historical borders
    is built.
- **A public view** that loses geometry is flagged in the admin panel (#2631).
- **A world view is deleted without failing.** Its placements, rejections, curator scopes and
  region ticks go with it. An event held at one of its regions loses that place and is asked
  again: Holy Week in Seville, held at a region of a Wikivoyage view, asks where it is held once
  that view is gone.

### Its visits

A **visit** (`user_visits`, today `user_visited_experiences`) is one row per traveller and thing
met, with exactly one referent:

- a record: the Uffizi; a station of the Struve Arc; Museum Island, with "1 of 5" beside the tick;
  thieboudienne; the Struve Arc itself, which reads "? of 34" until a station is named;
- a work: the Mona Lisa;
- a region: Toscana; Artsakh, kept closed;
- the traveller's own point (`user_own_points`): Siena, picked from a list of settlements that
  gives it a size, or a beach near Vernazza, drawn on the map.

`user_visited_regions` and `user_viewed_treasures` fold into it.

**Trips** (`user_visit_trips`) sit under a visit, from 1900 on, with the first and last day each
can cover. A trip on a record is accepted only while the record stood, compared at the date's
precision:

| record | trip | answer |
|---|---|---|
| Nelson's Pillar | "1966" | accepted |
| Nelson's Pillar | 1970 | refused |
| Cathedral of Christ the Saviour | 1980 (in its gap) | refused |
| Sydney Opera House | 1965 | refused |

A record that does not stand yet takes no tick (the Jeddah Tower), and a trip on a region is held
to the region's period: a trip of 2005 on South Sudan, which exists from 9 July 2011, is refused.

When a record's dates change later, a visit whose trip no longer fits is flagged, never deleted.
So is a sighting at a venue whose end is written later: a 2019 sighting at the Museu Nacional in
Rio, which burned in 2018. A record gone before 1900 (Old St. Peter's) is listed under "no longer
there" as history and takes no tick.

A dated sighting of a work names the venue it was seen at, and is checked against the work's time
there and the venue's closures. An undated sighting of a work that two or more venues hold asks
which: the Great Wave.

**A tick paints the region of the ground the traveller was on.**

- A record listed in two regions paints their common region, lighter, and asks which side, and
  the answer is a link between two visits (`user_visit_answers`), on a counted region of the
  canon the record is placed in. The Øresund Bridge asks
  "Hovedstaden or Skåne?" and Lake Baikal "Irkutsk Oblast or Buryatia?".
- An event paints where it was held on the trip's date. A held-at link with no dates holds for
  every date, so the Gion Matsuri paints Kyoto, undated too. The product asks only when the event
  has two or more held-at places, or dated periods that do not cover the trip: Maslenitsa at
  Bakshevo, once it has moved.
- A dish asks where it was tried: "Dakar", the own point.

Marks (went up the Berlin TV Tower) and walks (12 km of a stage of the Camino Francés, between
two stops) hang under a visit (`user_visit_marks`, `user_visit_walks`).

### Records beyond a point

- **Each source's outline or line is a view on that source's record** (`record_geometries`):
  Archaeology's excavation polygon of Pompeii; Bridges' line of the Øresund Bridge; a World
  Heritage buffer zone, kept and never shown as the outline (Yakushima). The record shows one view
  through `boundary_view_id` and `path_view_id`, and the OpenStreetMap credit is read from that
  view's objects and read date.
- **Arrival points** (`place_arrival_points`) are beside the shape and never parts of it:
  Yellowstone's North Entrance at Gardiner, the landing on Sceilg Mhichíl, Roncesvalles as a stop
  on a stage of the Camino. Each is a source's proposal.
- **Access** is open, restricted with a reason, or none: Mount Athos admits men only.
- **A long object** is a `line` record whose sections are parts.
- **A record that is not a place** is shape `none`, and its kind says how its tick reads.

### The rules every table keeps

- **Keys and timestamps.** Every surrogate key is an `integer`; only `experience_sync_changes`
  keeps its `bigint`. A foreign key is named for the table it points to. Timestamps are
  `timestamptz`. A curator's verdict is a pair, `<verb>_at` with `<verb>_by`. A fact about the
  world is never a timestamp.
- **Deletes.** A catalogue row that hangs on a record cascades from it. Traveller data never
  cascades from catalogue data: the writer that removes a record, a work or a region moves its
  visits first. A curator's act outlives the account, whose id is set null.
- **Vocabularies.** A closed vocabulary is a `varchar` with a CHECK, declared once in
  `@tyr/shared` and held to the schema by a type test. No new Postgres ENUM is created.
- **Writers.** A derived value has one trigger or function as its only writer. Every serving
  table names its writers, which the backend lint holds (ADR-0069), and declares its tier
  (ADR-0124).
- **Privacy.** Traveller data is read only under `/api/users/me`.
- **Accounts.** An account is hidden at once and erased after 14 days.

### From today's database to the model

The migrations from 263 on run in place, each in its own transaction (ADR-0041).

- **The catalogue's rows, the visits and the accounts are moved mechanically.** The schema moves
  the same way.
- **A curator's decision is moved where a new table holds it with the same meaning.** A curator's
  *lost* becomes an ended standing period.
- **A curator's decision with no home is dropped and counted** in the migration's report. The
  maintainer's rulings stand: the development database is disposable, and the fresh catalogue is
  curated again. No migration stops for a person.
- **Machine proposals nobody answered are recomputed**, not carried.
- **Run history is kept**, and derived tables are recomputed, never copied.

The check is #2129's: a database built from `db/init/01-schema.sql` alone and the migrated
development database give the same schema dump, NOT VALID constraints and seed rows included.
Catalogue Checks then run on the migrated database before it serves.

The migrations land in two halves.

- **The additive half, 263 to 266,** lands first and alone. It adds the day arithmetic, every new
  table, every new column of a kept table that today's code neither reads nor has to write, and
  the guards of their own rows. It then fills what today's rows already state: the World Heritage
  inscriptions and listings, websites, page columns, a work's find spot and made year, the run
  bars, and a trip's outer days. Today's code runs over it unchanged.
- **Everything else lands with the code that reads it,** one slice at a time. Each slice re-runs
  the backfill of a column before it moves that column's writer, and moves its declarations into
  the table's own section of `01-schema.sql`.

| slice | what lands | issues | after |
|---|---|---|---|
| B1 | Periods hold their outer days; standing is derived from periods | #1719 | — |
| B2 | A record's state is its periods: `existence` and the state verdict retire | #2584, #2585 | B1 |
| B3 | Kind facts in typed tables, and a listing derived from its periods; `facts`, `admitted_for` and `treasures.year` retire | #2127, #2009 | B1 |
| B4 | The shape, its views and what lies within; placement reads only the record's own ground | #2577, #2125, #1948 | B1 |
| B5 | The point tables go | #2124 | B3, B4 |
| B6 | Claims and tags are lists of words | its own issue | B3 |
| B7 | The curation log names its actor; an account can leave | its own issue | B5 |
| B8 | One visits table; own points; answers, marks and walks; trip-date conflicts | #768, #1169, #1171, #2008, #2015, #584, #2594 | B1, B5 |
| B9 | A run's mode, bars and status | its own issue | — |
| B10 | Sources 12 to 14 and the OpenStreetMap and Wikivoyage id schemes | #2128, #2633, #2135 | — |
| B11 | `experiences.source_id` and `external_id` go | #2116 | B5, B6 |
| B12 | A record's countries are read from its ground | #2135 | B5 |
| B13 | Relations, series and merge proposals | #2126, #586 | B4 |
| B14 | Regions and world views: closing a region, the canon's counts, a public view's ground | #2631, #2580, #1907 | B8 |
| B15 | Sign-in providers in one table | its own issue | — |
| B16 | Constraint and index names, column widths and NOT NULLs | #2116 | before B17 |
| B17 | The switch: the migrations fold into one baseline, and a fresh build is filled by every run | #2129, #2132, #2116 | last |

A kept function whose body reads a column a slice changes is restated in that slice, before the
column goes. The split into two halves and the cut of the slices are the session's.

## The tables of the model

Every table of the model, by owning domain. "Kept" means the table stays as it is today, its
constraints restated; "changed" names what changes; "new" is a table today's schema does not have.
Every one is a serving table (ADR-0124).

#### The record (D1, with D8's outline, line and access columns)

| table | what it holds | writers | change |
|---|---|---|---|
| `experiences` | The record: identity, content, shape, coordinate, derived pin and extent, the outline and line shown, access, and its derived standing and listing. Cologne Cathedral; Maslenitsa at Bakshevo | `db/experienceWriter.ts` for a curator, the run's upsert, the geometry writer; derived columns by their triggers only | changed: `source_id`, `external_id`, `existence`, `cast_points`, the country columns, the outline and line source columns and the state verdict go; shape pins, `claimed_location`, `pin`, `extent`, view ids, access, the page columns and `description_source` come |
| `experience_websites` | A record's official websites by language: the Mauritshuis in Dutch and English | `db/experienceWriter.ts`, the run's upsert | new (from `metadata`) |
| `experience_makers` | A record's makers with their roles: Nelson's Pillar's architect and sculptor | the same | new (from `metadata.creators` and `facts`) |
| `experience_subject_lines` | Whether what a record commemorates or depicts was read, and by which step | the same, and the run's kept-lines step | new |
| `experience_subjects` | Who or what it commemorates or depicts: the Lincoln Memorial, Abraham Lincoln | the same | new |
| `experience_point_hints` | A run's hint about a part's coordinate | the run's point hints, a curator's answer | changed: keyed by the part record |
| `experience_point_name_asks` | A question about a part's name | the same | changed: keyed by the part record |
| `experience_point_hint_suggestions` | A model's reading of a hint, never applied | the hint suggestions | changed: keyed by the part record |
| `record_geometries` | Each source's outline or line of a record, on that source's record, with the objects and the date it was read from: Pompeii's excavation polygon, the Øresund Bridge's line | `db/geometryWriter.ts`, which takes in today's `db/pathWriter.ts`, under the record's lock | new |
| `place_arrival_points` | An entrance, gate, landing, trailhead or stop beside a record's shape: Yellowstone's North Entrance | the arrival-point pass, a curator's answer under the lock; never a curator alone | new |

#### Time (D2)

| table | what it holds | writers | change |
|---|---|---|---|
| `place_periods` | When a record stood, was used, was closed or is held, for the record or one kind: Nelson's Pillar 1809 → 8 March 1966 | `db/placePeriodsWriter.ts` (a run's fill, a curator's answer) | changed: a surrogate key, the kind, the use's item, the decision's date |
| `record_periods` | Each source's view of those periods, rewritten whole by its run | the same | changed: a membership's own standing, refusal, read date |
| `record_listings` | When a membership was on a list kept outside the catalogue: Liverpool 2004 → 21 July 2021 | the same; `source_membership` follows by trigger | new |
| `place_seasons` | What repeats each year: Sceilg Mhichíl's boats May → September; Maslenitsa's rule in words | the same; only windows and words until #2633 | new |
| `place_past_positions` | Where a record stood before it moved: the Arch of Neutrality until 2010 | the same | new |
| `place_past_position_regions` | The regions each past position lies in, for reads as of a date | `refresh_place_shape_regions()` only | new, derived |
| `experience_time_proposals` | What a pass proposes about a closure, a season, a listing's end or a past position, for a curator | the time passes; a curator's answer writes the period | new |

#### Sources, kinds, admission and curation (D3)

| table | what it holds | writers | change |
|---|---|---|---|
| `experience_kinds` | A kind: name, order, crowding rule, form, verb, what a tick paints, whether it holds kilometres, whether its list is kept outside | the seed and migrations | changed: the five tick and list columns |
| `experience_sources` | A source: the kind it fills or none, id scheme, gate, licence, a held work's door | the seed; the admin's line | changed: sources 12 to 14 seeded; the last-run columns go (read from the run log); the work door lines come |
| `source_records` | One source's record of a record, in a kind or in a whole: admission with its code and evidence, tier, admitted-for item, the source's view of each field, the regions it names, part role, what a visitor finds at a part | `controllers/experience/membershipWriter.ts` (curator), the run's upsert and named part writers; derived columns by triggers | changed: `facts`, `is_iconic`, `admitted_for` (JSON) and `admission_answered_at` go |
| `experience_sync_logs` | One run of one source | the run | changed: a mode replaces `is_dry_run`; the bars move out |
| `experience_sync_bars` | The bars a run measured on each kind's pool | the run's admission step only | new (from `world_bars`) |
| `experience_sync_changes` | What one run did to one object, written once | the run's `changeRecorder.ts` | changed: keyed by record |
| `record_heritage_inscriptions` | What UNESCO says of an inscription, per World Heritage membership | the UNESCO run; a curator's claimed correction | new (from `facts`) |
| `record_danger_periods` | The stays on the Danger List: Cologne Cathedral 2004 → 2006 | the UNESCO run; a curator's claim | new (from `facts`) |
| `record_rule_reads` | What a Wikidata kind's rule read to admit a membership | the Wikidata runs' kind-facts step | new (from `facts`) |
| `experience_conflict_decisions` | A curator's no to a source's change of a claimed field, by value | `conflictDecisions.ts` under the lock | kept (integer key) |
| `experience_held_decisions` | A curator's answer to a held field, by value, per proposing source | `heldDecisions.ts` under the lock | changed: keyed by record or work, not by a part's kind, reference and name |
| `experience_view_choices` | A curator's choice between two sources' views of a field | the view-choice writer under the lock | kept; also answers makers, outline and line |
| `experience_view_suggestions` | A model's suggestion of a view, never applied | the suggestion call | kept |
| `curator_queue_set_aside` | A run's batch of questions set aside | the review queue | kept |
| `experience_kind_suggestions` | A model's reading of an arrival's kind, never applied | the suggestion call | kept |
| `experience_planned_kind_answers` | A curator's answer that a museum belongs to a planned kind | the curator's answer | kept |
| `experience_visit_questions` | A question whether a membership's place can be visited | the run's visit check | kept |
| `experience_visit_suggestions` | A model's reading of what a visitor finds, never applied | the suggestion call | kept |
| `experience_curation_log` | Every curator act, and every act taken in a curator's place; never rewritten | the one log writer | changed: record, kind, actor, reason code, batch, run and undo columns; the point acts refused for new rows |
| `curator_assignments` | A curator's scope: global, a region or a source | the admin; `db/regionWriter.ts` moves it with its region | kept |
| `membership_fame` | A membership's fame signals | the run's after-step | changed: a fourth signal |
| `membership_crowding` | The memberships crowded out of a dense city | the crowding refresh | kept |
| `place_venues` | The venues around a square or along a street | the Squares & streets run | kept |
| `wikipedia_editions` | An item's Wikipedia articles per edition | copied from the workbench | kept |
| `wikivoyage_articles` | The Wikivoyage articles that use an item | copied from the workbench | new |
| `coverage_kinds` | The register of kinds, a copy of its file | the coverage load | kept |
| `data_assertion_acceptances` | The debt each catalogue check carries | the admin panel | kept |

#### Relations between records (D4)

| table | what it holds | writers | change |
|---|---|---|---|
| `experience_parts` | "Part of", with the part's role and order: the Struve Arc's 34 stations | `parts_follow_records()` only | changed: role and order |
| `whole_leaves` | The leaves a whole's "k of N" counts over | `refresh_whole_leaves()` only | kept |
| `experience_lies_within` | "Lies within", from geometry: the Altes Museum in Museum Island | `refresh_lies_within()` only | new |
| `experience_relations` | Met at, held at, replica of, replaced by, runs along: Maslenitsa held at Bakshevo | `db/relationWriter.ts`: the proposing passes and a curator's answer | new |
| `experience_relation_periods` | When a *held at* held | the same | new |
| `place_identifiers` | The outside ids a record is found by or refers to | `refresh_place_identifiers()` only | kept |
| `place_identifier_verdicts` | A curator's word on one identifier | `placeIdentifierVerdictWriter.ts` | changed: `decided_by` |
| `experience_merges` | A merge, undoable | the merge, the pairing answer | kept |
| `experience_separations` | A membership set apart into a record of its own | the separation | kept |
| `experience_merge_proposals` | How two records stand to each other, asked once | the pairing pass; a curator's answer | changed: the shared item and the part concerned |
| `experience_merge_suggestions` | A model's judgement of a pair, never applied | the suggestion call | kept |
| `experience_pairing_due` | The records whose pairing inputs changed | `mark_pairing_due()`; the drain | kept |
| `experience_pairing_rule` | The rule version the proposals were found under | the pairing pass | kept |
| `experience_component_item_proposals` | A candidate item for a World Heritage component | the component-item finder; a curator's answer | changed: keyed by the part record |
| `experience_component_item_suggestions` | A model's reading of such a candidate | the suggestion call | changed: keyed by the part record |
| `experience_series_proposals` | A series proposed as a whole, and the mark of a confirmed one | the series check; a curator's answer | new |

#### Works (D5)

| table | what it holds | writers | change |
|---|---|---|---|
| `treasures` | A work: name, makers, picture, made date, find spot, versions, the Iconic badge, the record it is one object with | the run's works writer; `workWriter.ts` for a curator | changed: the made date replaces `year`; find spot, versions, candidate venues, readership and the tie to a record come |
| `experience_treasures` | A work's link to a venue, with its copy's item and `here_today` | the run's link reconciliation; `workWriter.ts` | changed: copy, decision, first run and `here_today` |
| `experience_treasure_periods` | When a work was at a venue: *The Concert* at the Gardner until 1990 | the works writer; `here_today` follows by trigger | new |
| `experience_treasure_period_views` | Each source's view of those periods | the run | new |
| `experience_treasure_placements` | Which memberships place a link, and on what evidence | the run | changed: evidence and the source that handed it over |
| `find_site_links` | A work's find site: the Dendera zodiac to the Dendera Temple | the find-site pass; a curator | kept |
| `experience_hand_overs` | A work another kind refused as held in a venue | the refusing run; a curator's answer | changed: the container and the decision |

#### Regions, world views and placement (D6)

| table | what it holds | writers | change |
|---|---|---|---|
| `administrative_divisions` | The base layer's bricks, their geometry rungs, area and country | the base-layer loader | changed: the GADM country |
| `world_views` | A tree of regions; the canon mark; how much of a public view lacks ground | `worldViewCrud.ts`, the import; `tile_version` by its trigger | changed: canon, credit, licence, finalisation and the ground count |
| `regions` | A node of a world view, with its geometry and, once replaced as an entity, its period: Artsakh until 1 January 2024 | `db/regionWriter.ts`, the geometry computations, the hull generator | changed: the counting mark and the period; `metadata` goes |
| `region_members` | The bricks a region holds, whole or cut | `db/regionWriter.ts` | kept |
| `region_geom_pieces` | A leaf's outline cut for point tests | its trigger only | changed: an order column |
| `region_changes` | Each structural change of a region, redrawn or replaced | `db/regionWriter.ts` only | new |
| `geometry_computations` | A world view's queued outline computation | the queue endpoint and the worker | kept |
| `import_runs` | One import of a world view | the import | kept |
| `region_import_state` | An imported region's import state | the import | kept |
| `region_match_suggestions` | A division proposed for an imported region | the matcher | kept |
| `region_image_overlays` | A map image an admin lays over a region to trace its subregions by, with its corners and opacity | the world-view editor's custom-subdivision dialog (`regionImageOverlay.ts`) | kept |
| `region_subdivision_groups` | The groups an admin sorts a region's members into, in order; each becomes a subregion | the same dialog (`regionSubdivisionGroups.ts`) | kept |
| `region_member_group_assignments` | Which group each member is in | the same dialog | kept |
| `experience_regions` | A record's regions in every view: derived, or a curator's placement | `refresh_place_regions()`; a curator's placement writer; `db/regionWriter.ts` moves them | changed: what an edit of the map left for a curator |
| `experience_shape_regions` | The regions each base of a record puts it in | `refresh_place_shape_regions()` only | kept; its bases restated (point, outline, line, nearest, named, held at) |
| `experience_rejections` | A record hidden from one region's list | `curationRegionController.ts` | changed: `rejected_at` |

#### Travellers and visits (D7)

| table | what it holds | writers | change |
|---|---|---|---|
| `users` | An account and its role; when its deletion was asked | the auth service | changed: the provider columns move out; `deletion_requested_at` |
| `user_auth_providers` | One sign-in method of an account | the auth service | changed: `provider_data` goes |
| `refresh_tokens` | A session's refresh token | the auth service | kept |
| `email_verification_tokens` | A pending email verification | the auth service | kept |
| `user_visits` | One visit: a record, a work, a region or the own point | the visit writer; a merge or a region edit moves visits through it | renamed from `user_visited_experiences`, changed: takes in `user_visited_regions` and `user_viewed_treasures`; the flag of a trip that no longer fits |
| `user_own_points` | A traveller's own point and its size: Siena | the visit writer; erased on request | new |
| `user_visit_answers` | A visit's question answered by another: the Øresund Bridge's side by a tick on Skåne | the visit writer | new |
| `user_visit_trips` | A dated trip under a visit, with its day counts and the venue a work was seen at | the visit writer | changed: day counts, venue, `updated_at` |
| `separated_visit_questions` | A traveller asked after a separation | the separation | kept |
| `user_new_badge_views` | When a reader first saw a new badge | the reader | kept |
| `user_visit_marks` | A mark on a visit: went up the Berlin TV Tower | the visit writer | new |
| `user_visit_walks` | Kilometres and stops of a walk on a trail section | the visit writer | new |
| `settlements` | Settlements a traveller picks an own point from, with a size | the settlements load | new |
| `settlement_names` | Their names in other languages | the settlements load | new |

**Retired.** `experience_locations`, `experience_location_placements` and
`experience_location_regions` (a component is a record with a part record, #2124);
`user_visited_regions` and `user_viewed_treasures` (folded into `user_visits`). Their rows are
carried before the tables are dropped.

**Kept and outside the model.** `schema_migrations`, and the
43 workbench tables, which are inputs (dumps, the Wikidata subset, the Wikipedia and Wikivoyage
reads, the OpenStreetMap layer, the coverage surveys, the AI settings and the query cache). The
model changes none of them, and no serving table holds a foreign key into the workbench.

## Decision

The model above is the catalogue's target, and the decisions below are what it rests on. Each
names its source. **The session's** marks a call that no accepted ADR and no recorded word of the
maintainer settled; the maintainer delegated those calls on 2026-11-17 ([#2458, 21:21Z](https://github.com/uncovering-world/track-your-regions/issues/2458#issuecomment-6961352212)),
and each is recorded here as the session's.

### The schema and how it is reached

1. **The tables listed above are the catalogue's schema**, and the code slices are built to the
   table each changes. The maintainer decided this on 2026-11-17 (#2458, #2634).
2. **The migrations from 263 on move what moves mechanically.** That is the schema, the
   catalogue's rows, the visits and the accounts. A curator's decision is moved where a new table
   holds it with the same meaning, and dropped and counted where none does. Machine proposals
   nobody answered are recomputed, derived tables are recomputed, and run history is kept. No
   migration stops for a person. This is the maintainer's: the development database is disposable
   and the fresh catalogue is curated again (2026-11-17, #2116, #2586). They land in two halves
   (§ From today's database to the model): 263 to 266 add only what today's code neither reads nor
   writes, and every other change lands with the code that reads it, in the slices listed there.
   The halves and the slices are the session's.
3. **The fresh build and the migrated database must agree.** A database built from
   `db/init/01-schema.sql` alone and the migrated development database give the same schema dump.
   A constraint a carried row cannot meet is added NOT VALID in both builds, and no data is
   invented to meet it. This is the session's, and it serves #2129.
4. **The minor tables of later issues wait for their own slices.** The tables that later issues need (#2015's marks
   vocabulary, #584, #1173, #2630, #2008's construction start beyond one column, #2594's airports,
   #586, #1907, #608) are added by those issues' slices as additive tables. This is the session's.

### The record

5. **The record table stays `experiences`.** A row of it is a record, and "place" is a record with
   ground. The session's.
6. **A record's provenance is its first source record.** `experiences.source_id` and
   `external_id` retire, and a run finds a record by its own membership's id (ADR-0084; #2124,
   #2131).
7. **JSON holds no fact a reader filters by.**
   - `metadata` keeps the picture credit and UNESCO's mark only. Websites, makers and subject lines
     are tables, and the Wikipedia and UNESCO pages are columns.
   - `curated_fields` is a `varchar(40)[]`, checked against its closed list, on every table that
     has one.
   - Whose a description is becomes `description_source`.

   The session's, under ADR-0065 and #2127.
8. **The point tables retire.** A component is a record with a part record, its coordinate is the
   record's, and the point cards are keyed by the part record. This is the maintainer's
   (2026-10-27, #2124).
9. **A source name's marked-up second line is the record's subtitle**, never part of its name:
   Auschwitz-Birkenau's "German Nazi Concentration and Extermination Camp (1940–1945)". The
   session's.

### Sources, kinds and admission

10. **A source fills at most one kind, and a kind is filled by one source or more** (ADR-0198
    decision 1). Whether a source fills no kind is a rule of its id scheme: one keyed by
    components, statements or a curator's key never fills one, and one keyed by OpenStreetMap or
    Wikivoyage ids may. Sources 12 (Wikidata statements), 13 (OpenStreetMap) and 14 (Wikivoyage)
    are seeded filling none. The session's.
11. **Kind facts are typed tables, and `facts` goes.** The maintainer decided this (2026-10-27,
    #2127). The tables are the inscription, the Danger List stays with real dates, and what a
    rule read. The makers are rows of the record, and the dedication is a subject line. That the
    Danger List stays carry dates (Cologne Cathedral 2004 → 2006) is the session's.
12. **No place carries the Iconic badge, and a membership's admitting tier is a typed column.**
    This is the maintainer's latest word (2026-10-31, #2177). It narrows every ADR that put the
    badge on a membership.
13. **What a membership was admitted for is an item and a label, never a work's id.** A
    Monuments & memorials marker is admitted for the person it commemorates, who is no work. The
    session's.
14. **A region a source names is kept with the country codes the run resolved.** So no serving
    read goes through the Wikidata subset (ADR-0221), and a record's country is read from the GADM
    country of its point and its placement. The codes place a record only where it has no ground
    in any region (decision 38). The session's.
15. **A kind says how a tick on its records reads**: its form, its verb, what its tick paints
    (`ground`, `held_at` or `asks_where`), whether a visit holds kilometres, and whether its list
    is kept outside. The constant `KINDS_KEPT_AS_FORMER` becomes that last column. This is the
    session's design of #1676 and #1948, under ADR-0224 decision 2.
16. **The curation log is carried whole**, as ADR-0040 decision 7 requires. New rows are refused
    the retired point acts by a NOT VALID constraint. The session's.

### Time

17. **ADR-0217 is built whole**, under the one period block. A closure is a `closed` period, never
    a table of its own (ADR-0217 decision 2), and standing is kept for the record or for one kind.
18. **Movable dates are not computed by this model.** Until #2633, a season is written only as a
    window or in words: Holy Week in Seville is "March or April", with no window. What #2633
    needs beyond the rule columns held here is its own additive migration. This follows ADR-0224
    decision 8; that the model does not claim #2633 needs no migration is the session's.
19. **Past positions are placed in regions**, so a map or a count read as of a date finds a moved
    record where it stood. The session's.

### Relations

20. **"Part of" stays derived from part records.** A part record carries its role (`part`, `copy`,
    `section`), and "k of N" counts over leaves (ADR-0198, ADR-0206, ADR-0218).
21. **Every other relation between two records is one row of `experience_relations`** (*met at*,
    *held at*, *replica of*, *replaced by*, *runs along*), with periods where it has them. "Same"
    stays a merge. This is the session's design of #2581, under ADR-0218 decision 9.
22. **"Lies within" is derived from geometry, in its own table.** A pair already linked by "part
    of" is left out of it, and a curator's no to a pair is a pairing answer *two*. This is the
    session's, under #2125: one refusal store is enough.
23. **A curator answers a source's proposal and never enters a relation or an arrival point from
    nothing.** Both tables refuse the Curators source, and an arrival point names its object
    (ADR-0218 decisions 7 and 12, held by the session's constraint).
24. **A cast group is a serial object whose casts are parts of the role `copy`**, and
    `cast_points` retires. This is the maintainer's (2026-10-27/28, #2126).
25. **A class object is told from a confirmed series by its own mark:** a confirmed series has an
    answered series proposal, and a class object has none. Its class item makes its shape `none`,
    so it holds no pin: the khachkar. The session's.

### Works

26. **Copies of one matrix are one work**, with a link per venue that holds the copy's own item. A
    version made again is a work of its own. This is the maintainer's (#1733).
27. **A work's time at a venue is periods on its link**, and whether it is there today is derived
    (ADR-0217 decision 4; the maintainer on #2578).
28. **A record and a work that are one object are tied by one link**, so one sighting is one tick:
    the Pergamon Altar. The session's.

### Records beyond a point

29. **Each source's outline and line is a view on that source's record**, and the record shows one
    view by its id. The outline and line source columns retire, and the OpenStreetMap credit is
    read from the view (ADR-0146's owner rule, ADR-0059). This is the session's design of #2583.
30. **Every value read from OpenStreetMap carries its object, its tag and the date it was read:**
    an address, a coordinate's reference, access, an arrival point and an outline (ADR-0059
    decision 2, held by the session's columns). An object is spelled one way, `node/…`, `way/…`
    or `relation/…`, and carries its tag whichever source proposed it. The spelling is the
    session's.
31. **Access is a column group of the record, with a reason from a closed list, and a replica is a
    relation.** This is the maintainer's (2026-10-28, #2134); the reason list is the session's.

### Regions and world views

32. **"All of the bricks" means all, with 0.5 % of a brick's area allowed for measuring alone.**
    The allowance is one function. Under a hand-drawn outline, a canon region counts when at least
    0.5 % of its own area lies inside the outline: Monaco in a drawn Côte d'Azur counts, and a
    shoreline sliver of a third oblast does not. That a tolerance stays is the maintainer's
    (#2579); the value and how it is measured are the session's.
33. **Until #587 builds the canon, the leaves of the Administrative view stand for it**, and the
    canon is marked (`world_views.is_canon`, `regions.counts`). The session's.
34. **A curator's placement on a hand-drawn region lists the record in that view only**, and a tick
    on such a region paints through the canon (ADR-0219 decision 7, ADR-0224 decision 4). This
    corrects the session's earlier reading that listed it in every view.
35. **A view's own tree is read as ground in that view.** In a view that sets Russia under Europe,
    a tick on Russia paints that view's Europe. Between views only bricks are compared, so the
    Administrative view still asks. The session's.
36. **A region replaced as an entity is closed with its period and kept with its ticks.** Every
    structural change is recorded as redrawn or replaced (ADR-0219 decision 6). A closed region
    holds no derived placement: the records placed through it are placed again in that view. A
    visit's country is read from the closed regions of the canon, and no table of historical
    borders is built (the session's).
37. **A public view that loses geometry is flagged in the admin panel**, and the migration hides
    the views on the development database that fail (#2631). The session's.
38. **A record is placed by its own ground.** An outline or a line is its ground only where a
    curator claimed it, the record has no pin, or it reaches the pin: the Pergamon Altar is placed
    in Berlin, never by the outline of ancient Pergamon at Bergama. A line is placed also by its two
    ends, so the Øresund Bridge, whose deck crosses water, is in Hovedstaden and Skåne. A country a
    source names places only a record with no ground in any region: one with no point, outline or
    line of its own (thieboudienne in Senegal), and one whose own ground lies in no region (the
    Great Barrier Reef, an outline at sea, in Australia, as ADR-0218 decision 10 says). A chapel on
    the Iranian bank of the Aras is under Iran by its pin, whatever country a source names. The
    session's.
39. **Deleting a world view never fails.** It deletes the placements, rejections, curator scopes
    and region ticks on its regions. A held-at relation on one of them loses its target and is
    proposed again, so the event asks where it is held; a single region's delete does the same.
    The session's.

### Visits

40. **A visit is one row on a record, a work, a region or the traveller's own point**, and the
    region and work visit tables fold into it (ADR-0219 decisions 1 and 8). Its questions and
    answers, marks and walks are rows under it. A "which side" is answered only by a counted
    region of the canon that the record is placed in. This is the session's design of #2579's
    columns.
41. **A trip on a record is accepted only while the record stood.** It is refused before the
    record's beginning, inside a gap and after its end, compared at the date's precision. When a
    record's dates change later, a visit whose trip no longer fits is flagged, never deleted, and
    so is a sighting at a venue whose end, or whose link's end, is written later: a 2019 sighting
    at the Museu Nacional in Rio, which burned in 2018. A trip on a region is held to the region's
    period, its beginning included: a trip of 2005 on South Sudan is refused. The principle is the
    maintainer's (#2619, 2.23 rule 4). The session extended it to the beginning, to gaps, to venues
    and to regions, answering ADR-0224's open question.
42. **A membership that ended while the building stands does not refuse the visit.** The visit
    counts in the kind only on the days the membership held: Frick Madison after March 2024. The
    session's.
43. **A dated sighting of a work names its venue**, and is checked against the work's time there
    and the venue's closures: *The Concert* at the Gardner in 2005 is refused, and so is the
    Pergamon Altar in 2025. An undated sighting of a work that two or more venues hold may leave
    the venue open, and the product asks which: the Great Wave. The session's.
44. **A record gone before 1900 is listed under "no longer there" as history and takes no tick**,
    dated or not (Old St. Peter's). The tick's floor is ADR-0202's 1900; the section has none. A
    record that does not stand yet takes no tick either: the Jeddah Tower. The session's.
45. **An event's tick paints where the event was held on the trip's date.** A held-at link with no
    period holds for every date: the Gion Matsuri, held in Kyoto with no dates known, paints Kyoto
    on any trip, undated too. The product asks where only when the event has two or more held-at
    places, or dated periods that do not cover the trip's date (Maslenitsa at Bakshevo, once it has
    moved), and the tick paints nothing until answered. An event held across a city names its
    region. This narrows ADR-0224 decision 2, which asked on every undated trip, and the narrowing
    is the session's.
46. **A direct tick on a serial object is allowed, reads "? of N" and paints nothing** until the
    traveller names a part. The session's.
47. **Traveller data never cascades from catalogue data, and a curator's act outlives the
    account.** An account is hidden at once and erased after 14 days (the maintainer, #1176).

### Conventions

48. **Every surrogate key is an `integer`.** Only `experience_sync_changes` keeps `bigint`. A
    closed vocabulary is a `varchar` with a CHECK, declared once in `@tyr/shared`, and no new ENUM
    is created. Every date of the world is an approximate date. A derived value has one writer,
    and every table names its writers (ADR-0069). The session's.

## The ADRs this one narrows

Each clause below no longer holds as written; the rest of each ADR stands. "Replaced" means the
clause's object no longer exists in the model; "narrowed" means the clause holds in a changed form.

| ADR | decision | clause | effect |
|---|---|---|---|
| 0022 | 1–3 | "experience_locations.missing_since records when a run first offered the experience without that point" | replaced: a part's record carries `missing_since` |
| 0023 | 2 | "An admitted museum's experiences row is written is_iconic = true" | replaced: the badge is on works only |
| 0024 | 1 | "admission_reason text" | narrowed: a code with `admission_evidence` |
| 0024 | 5 | "added to curated_fields … the same protection is_iconic already has" | narrowed: no place badge; `curated_fields` a list of words |
| 0025 | 2 | "experiences, experience_locations, experience_treasures and treasures each gains the same three-state column" | narrowed: no point table; a part's gate is its record |
| 0026 | 6, 7 | "offeredLocationSql gains `existence <> 'lost'`"; "existence is untouched" | replaced: `existence` and the points retire |
| 0027 | 1, 4a, 5, 6 | "A stored row is the point the source is offering when external_ref matches"; "keep the experience_location_regions row" | replaced: the point tables retire |
| 0029 | 1, 3 | "experience_locations and treasures carry curated_fields"; "A point's external_ref and ordinal are never claimable" | narrowed: the points retire |
| 0029 | 5 | "curated_fields ? 'name' AND …" | narrowed: `= ANY` over a list of words |
| 0037 | 6 | "external_ref, ordinal, source_membership, missing_since: the source's handle on the row" | narrowed: the handle is the part record |
| 0038 | 3 | "one standing answer per place, part and field" | narrowed: keyed by record or work |
| 0039 | 1 | "a key is a fact and names itself, `metadata.<key>`" | narrowed: `metadata` keeps the picture credit and UNESCO's mark only |
| 0040 | 1, 4 | "public art's metadata.creators as a JSON array" | replaced: `experience_makers` |
| 0044 | 1 | "Every reader-facing read of a museum's works carries missing_since IS NULL" | narrowed: and `here_today` |
| 0045 | 4 | "A visit is recorded on the place (or on one of its locations …)" | narrowed: on a record; a part's record is a record |
| 0045 | 5 | "the 22-sitelink line keeps deciding which works and, by holding one, which museums carry the badge" | narrowed: the badge is on works only |
| 0048 | 2, 5 | "the world tier carries the Iconic badge"; "a curator may … set or clear the badge" | narrowed: no place badge; `source_records.tier` |
| 0052 | 1 | "an admitted place carries the Iconic badge … and admitted_for names the most famous of the works" | narrowed: no place badge; an item and a label |
| 0052 | 2, 6 | "api_config.enterSitelinks and api_config.staySitelinks … written by PUT …/line" | narrowed: the admin's line governs a held work's door only |
| 0053 | 1 | "admission_reason = 'kept out by a curator', the admission pin, and the badge cleared" | narrowed: a reason code; no badge |
| 0053 | 2 | "experience_locations and experience_treasures gain refused_at"; "unreadPointSql" | narrowed: a part's refusal is on its part record |
| 0058 | 3 | "with foundAt … in the treasure's metadata" | replaced: the work's find-spot columns |
| 0058 | 5 | "enterSitelinks / staySitelinks for places … on experience_sources.api_config" | narrowed: `admissionRegister.ts` holds the place line |
| 0067 | 2, 3 | "It sets … admission_answered_at"; "or admission_answered_at IS NOT NULL" | replaced: `admission_decided_at` and `_by` |
| 0070 | — | "The two-valued axes (admission, existence, source_membership) move freely" | narrowed: `existence` is gone; `source_membership` is derived |
| 0084 | 2 | "the admission, the badge and the gate state" (on the membership) | narrowed: no badge |
| 0084 | 3 | "The place's own source_id and external_id are provenance." | replaced: the first source record |
| 0086 | 3 | "A folded point whose external_ref equals one of the survivor's … is folded into that point" | narrowed: part records move with the merge |
| 0086 | 5 | "experience_curation_log.curator_id may be null on a merged row and on no other" | replaced: set null with the account, beside the actor |
| 0090 | 1 | "The row is kept and its external_ref rewritten to the incoming one" | narrowed: the row is a part record |
| 0100 | 1, 2 | "experience_locations goes back to being … the points of one place"; "its badge" | narrowed: the points retire; no place badge |
| 0111 | — | "country_names goes with UNESCO's country_codes" | replaced: a record's countries are read from its placement |
| 0117 | — | "completePairing … searches an augmenting path … for each point left over" | narrowed: the pairing pairs records |
| 0125 | — | "UNIQUE NULLS NOT DISTINCT (experience_id, part_kind, part_ref, part_name, field, source_id)" | replaced: the key is over record or work |
| 0126 | 3 | "What the badge marks is left open (#1737)" | narrowed: answered, works only |
| 0129 | 1 | "On a held row metadata.wikidataQid is written" | narrowed: the item is the source record's id |
| 0134 | 3 | "every OSM object named in metadata.osm of a place or a location" | replaced: the view's object references |
| 0137 | 2 | "experience_location_placements.adopted_ref" | replaced: the part record's id |
| 0138 | 1 | "unescoUrl is written by UNESCO's run alone" | narrowed: a column; the rule stands |
| 0140 | 3 | "the old point names the arrival (moved_to_location_id)" | replaced: the points retire |
| 0143 | 6 | "experiences.source_id and external_id say where a place first came from" | replaced: as 0084 decision 3 |
| 0144 | 1 | "the original keeps its pair" (source_id, external_id) | narrowed: as 0084 decision 3 |
| 0145 | 1, 3, 4 | "each cast is one of its experience_locations"; "The place's countries are every cast's"; "Its stored location is an anchor" | replaced: a cast group is a whole with parts of the role `copy` |
| 0146 | intro, 1–2 | "recorded on the place (experiences.boundary_source_id)"; "replaces or clears only an outline it drew" | replaced in its storage: a view on the source's record; the owner rule stands |
| 0149 | 4 | "a claimed key, metadata.descriptionAdaptedFrom" | narrowed: `description_source` |
| 0153 | 2 | "They are kept in experience_kind_memberships.facts, and its run writes them whole on every pass" | replaced: typed tables |
| 0164 | 1 | "the museum counts it toward its own badge" | narrowed: no place badge |
| 0166 | 3 | "The treasure carries metadata.placedBy = 'wikipedia'" | replaced: the placement's evidence |
| 0190 | — | "commemorates is the first such field, written by PUBLIC_ART_SOURCES" | narrowed: subject lines |
| 0197 | 4, 5 | "a point that changes … its state (curation_state, refused_at, missing_since, existence …)"; "experience_location_regions stays … until the point tables go" | replaced: the point tables go now |
| 0198 | 1 | "A source whose records place parts in wholes fills no kind … and every other source fills one" | narrowed: decision 10 here |
| 0206 | 4 | "Statement-level triggers on experience_parts and experience_locations call it" | narrowed: on `experience_parts` and `source_records` |
| 0210 | 3 | "the anchor is written only to a place that holds a coordinate: an edition's casts (ADR-0145)" | narrowed: casts are parts |
| 0212 | 2, 3 | "path_source_ref names the objects … path_updated_at the instant"; "(path_source_id)" | replaced: a view on the source's record |
| 0217 | 4, 7 | "the kinds KINDS_KEPT_AS_FORMER names" | narrowed: `experience_kinds.list_kept_outside` |
| 0217 | 7 | a place of the "no longer there" section can be ticked | narrowed: not one gone before 1900 (decision 44) |
| 0217 | 8 | "A tick on the Cathedral … counts though its only trip is dated 1980" | narrowed: refused inside a gap (decision 41) |
| 0224 | 2 | "Where the trip has no date, or the event's place on that date is not known, the product asks where it was" | narrowed: an event held at one place with no dated period that misses the trip answers that place, undated too (decision 45) |
| 0224 | 5 | "Russia … answers neither Europe nor Asia … so the part is always asked" | narrowed to comparisons between views (decision 35) |
| 0224 | 6 | bullet 2: "A tick with no date still counts" | narrowed: not on a record gone before 1900 (decision 44) |

**ADR-0224's open questions are answered here,** each as the session's:

- the canon's stand-in (decision 33);
- a placement on a hand-drawn region (decision 34);
- the measuring allowance (decision 32);
- a view's own tree (decision 35);
- a trip before the beginning or in a gap (decision 41);
- an unanswered event tick (decision 45);
- a direct tick on a serial object (decision 46).

**Honoured, not narrowed:**

- ADR-0040 decision 7: the log is carried whole;
- ADR-0046 decision 5 and ADR-0199 decision 4: a folded record's visit stays on it for the undo;
- ADR-0059 decision 2: every outline and line is a source's view;
- ADR-0125: a held answer with no source holds against any source;
- ADR-0146: a record shows only a view of its own records;
- ADR-0202: the trip's year floor of 1900;
- ADR-0218 decisions 7 and 12: proposals a curator answers;
- ADR-0218 decision 10: an area no land region holds is placed by the region its source names (decision 38);
- ADR-0219 decision 7: that view only;
- ADR-0221: no serving read through the subset;
- ADR-0041: each migration declares its own transaction.

## What this ADR does not decide

Of the 151 requirement rows the integration mapped, 24 are held by no table, each with its reason:

- **Workbench inputs outside the model**: the coverage surveys, the dumps and their reads.
- **Later issues and proposals**: region facts with their licences (a proposal, FUT-751),
  re-joining base-layer halves split across continents (#786), the canon's weight signals (#587),
  #1529, and a platform beside Wikipedia (#2630).
- **A rule superseded** by ADR-0179.
- **An open question**: the type words of Places of worship beyond today's (#862).
- **Process requirements**, which § From today's database and ADR-0223 answer.

Also left to their owners: the computable movable dates (#2633), the canon itself (#587), and
which types default to an area from what size, which is measured in the slice that writes the
defaults.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Rename `experiences` to `records` | It touches 29 tables through 37 foreign keys, about forty table names, every writer list and lint group, the generated row types, the OpenAPI document and the web's client, and buys no clarity: "experience" fits a dish and a festival better than "place" does |
| Publish the DDL as `docs/tech/clean-model-schema.sql` now | `docs/tech/` describes what exists. A schema published before its migrations would be a second, drifting source of truth; it lands as the migrations and `01-schema.sql` |
| A table per form (places, events, dishes) | A record changes shape in curation and is offered by kinds of two forms (ADR-0218) |
| Keep `facts`, `metadata` and `curated_fields` as JSON | Readers filter on them; a JSON document hides a fact from the constraints and the generated types (#2127) |
| A `place_closures` table | A closure is a period that pauses a membership or the record, which ADR-0217's block already holds |
| `experience_lies_within` with its own refusals table, or a second table with parts in it | One answer table for "same / two / part of" is enough, and a part inside its own whole would count twice |
| A source column beside each outline or line | A second copy of what the view's record already says, free to drift |
| `bigint` keys | Node's driver returns `int8` as a string, so every generated type would carry text; no serving table comes near 2³¹ |
| New Postgres ENUMs for the vocabularies | A value cannot be removed, nor added inside a migration's own transaction |
| A table of historical borders (#616) | The closed regions of the canon hold that history already |
| Carry every curator decision of the development database | The maintainer ruled the development database disposable (DEC-013, DEC-016; 2026-11-17) |
| An admitting work's id on the membership | A marker is admitted for a person, who is no work |
| An undated event tick that paints a place its dated periods do not settle | ADR-0224 decision 2: where the place on the trip's date is not known, the product asks. A held-at link with no period is known for every date, so it answers |
| A country a source names placing every record of that source | A chapel on the Iranian bank of the Aras would be listed under Azerbaijan as well as Iran |
| A deleted world view refusing while an event is held at one of its regions | A view could then never be deleted; the event is asked again instead |
| Compute movable dates now | #2633 is its own feature; until it lands, "March or April" is what is known |

## Consequences

**Positive:**

- One document says what the database is, and every slice is built to the tables it changes.
- Every fact has one home and one writer: no JSON key a reader filters by, no source column beside
  a view, no badge on a place.
- A traveller's tick claims only what the traveller could have seen: no visit to a pillar that had
  fallen, no Europe for "somewhere in Spain", and no tick on a church demolished in the 16th and 17th centuries.
- The fresh build and the migrated database meet in one schema dump, so the development database
  is a test of the fresh one.

**Negative / Trade-offs:**

- The migrations touch most tables of the catalogue at once, and a curator's decision with no new
  home is dropped. The fresh catalogue is curated again, by the maintainer's ruling.
- Each issue built to this ADR must name it, which owes 35 issues a line.
- Several answers are the session's, under a delegation, and an answer the maintainer later
  changes needs an ADR that narrows this one.
- Until the slices land, the database holds the model's new tables and columns empty or filled
  once from today's rows, beside the legacy columns today's code still writes; each slice re-runs
  its backfill before it moves the writer.
- More ticks ask a question (the side of a bridge, where a dish was tried, where a festival held
  at two places was, which venue an undated sighting of a work was at), and a trip date that does
  not fit is refused rather than filed.
- Movable dates stay in words until #2633, and #2633 brings its own migration.

## References

- Related ADRs: ADR-0217, ADR-0218, ADR-0219, ADR-0224 (the model's decided pieces); ADR-0198,
  ADR-0069, ADR-0084, ADR-0045 (the record and its writers); ADR-0041 (migrations); ADR-0124
  (tiers); ADR-0221 (the subset)
- Issues: #2634, the queue #2458 (the maintainer's orders of 2026-11-17, 21:13Z and 21:21Z),
  #2619 (the maintainer's answers), #2129 (the fresh build)
- Schema: `db/init/01-schema.sql`; `db/migrations/` 263 to 266 (the additive half), and each slice's own migrations after them
