# ADR-0048: A kind is filled in two tiers, each from its own kind of source

**Date:** 2026-09-06
**Status:** Accepted

---

## Context

Every kind the catalogue offers today is its world tier and nothing else: World Heritage is
the UNESCO list, art museums are the venues holding a work at 22 Wikipedia-language sitelinks
(ADR-0023), public art is the sculptures and monuments above the same line, reused by #754. The
line is honest about what it is — the world's cut on one signal — and what it leaves out is
most of what a region holds: Tbilisi and Lima have no museum in the catalogue, Kraków has the
Czartoryski alone, Spain holds 32 of the 200 public-art rows and the whole of Africa 10
(development catalogue, 2026-09-04). The vision promises the other half — "the iconic art
museums *and some other art museums worth your time*" — and no rule says where it comes from.

ADR-0045 fixed that a kind is offered only with a sync and a rule of completeness (decision 2)
and that a kind may have several sources (decision 3), but not what the second source *is*,
what its completeness means, or how a source is chosen. The next kinds to fill — regional art
museums (#628), archaeology and history museums (#581), the public art a country holds below
the world's line — would each answer ad hoc. #759 tried to measure the gap on the works pool
and was closed: a ranking source enumerates its own reach, so "what the line refused" is a
biased sample, not what a region holds. The question of sources comes before any measurement.

Measured on 2026-09-06 while writing the rules
(`docs/tech/filling-a-kind.md` § 7): France's *Liste des Musées de France* enumerates 1,217
labelled museums with coordinates and an id Wikidata links, under Licence Ouverte 2.0; Poland's
state register lists 135 museums "of high merit", nine of them in Kraków, with addresses and
no ids, under CC0; Peru's ministry lists the 56 museums it administers, and Lima's Larco and
Lima Art Museum are private and absent; Georgia's law establishes a register nobody
publishes; Wikidata holds 30 museums in Lima and 32 in Tbilisi against OpenStreetMap's 109 and
43; the world tier's line reaches 0 museums in Lima, 2 in Tbilisi, 3 in Kraków, 5 in all of
Estonia. Google Places and the Tripadvisor Content API forbid, by their terms, storing,
combining or placing what they return.

The search for sources will run again for every kind and every unit, and what it finds has to
outlive the session that found it.

## Decision

**1. A kind is filled in two tiers, always both, in this order: the world tier, then the
regional tier.** The world tier is what the world knows of the kind; the regional tier is what
a region holds that a traveller standing there would visit. A kind's rule of completeness
(ADR-0045 decision 2) is *one rule per tier*.

**2. The world tier comes from a global source with a signal comparable across the world, and
its completeness is the ranking's own rule.** A threshold on the signal, or a count, stated
once and applied to the whole world (ADR-0023 decisions 1 and 3 as they stand); the world tier
carries the Iconic badge and is the only thing that awards it (ADR-0045 decision 5 as it
stands). What the line leaves out is the regional tier's job, not a defect of the line.

**3. The regional tier comes from a source native to its unit, and is an enumeration followed
by a cut within the unit — never a world rank.** The unit is the source's own — a country for
a national register, a city for a city list — not a world-view region; the catalogue places
each place into regions by coordinates afterwards. The source enumerates what the unit holds;
the tier's rule cuts within the unit, by the source's own editorial judgement where it has one
or by a within-unit signal where it has none, with a floor on the group. A global source read
per unit is admitted as a regional-tier source only where no native source exists or can be
read, under the conditions the rules name (coverage measured against the unit's canon, the
share of rows with an identity known, a floor on the group), for that unit, until a native
source arrives. The regional tier carries no badge, and its completeness is per unit: the
enumeration read whole and the cut applied. A unit with no adopted source has no regional
tier, and the product says so rather than showing an empty list as a full one.

**4. The tiers meet on the place.** A regional source that names a place already in the world
tier names the same place (ADR-0046), which keeps its badge, keeps its membership in the kind,
and counts once per kind (ADR-0046 decision 8). A region's list of a kind is both tiers
together, the world tier's rows badged.

**5. A curator's list is a source of either tier.** It is judged by the same rules as any other
(identity, coordinates, a Wikidata item where one exists), it is how a unit with no native
source gets filled, and a curator may place an object in a tier and set or clear the badge. The
model has two tiers and one badge; "top" is the world tier, not a third status.

**6. A source is adopted for a tier only through the rules' scorecard — terms and access mode
included — and by the issue of the kind it fills.** Terms that forbid storing, combining or
showing what is read are a veto whatever the coverage. What a reader obtains by scraping or by
extracting from documents with a model enters through the gate as a proposal (ADR-0025),
never as a direct write.

**7. A source is a record before it is code.** Every candidate looked at is written into the
source register (`docs/sources/`) with its evidence and a status, whatever the outcome; a sync
is written from the record, and the record stays as the source's provenance. The register is
files until something reads it.

**Narrowed by this ADR:** ADR-0045 decision 2 (completeness is per tier) and decision 3 (a
kind's sources are at least one per tier, each tier preferring its own kind of source). The
scorecard's criteria, weights and lines, the search procedure and the family verdicts are
`docs/tech/filling-a-kind.md`'s, written before the first regional adoption and expected to
change with it; this ADR binds the model, not the numbers.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| One tier, a lower line on the world signal (the composite ADR-0023 rejected; the measurement #759 proposed) | Reaches the museums Wikipedia writes about, not the ones a region holds: at 10 sitelinks Lima has 4 museums and Tbilisi 9 (2026-09-06), and a missing datum still reads as zero. The regional tier's question is "what is here", which only something native to the unit answers. |
| A percentile of the world signal within a continent as the regional rule (#761) | A candidate *signal* for the cut where a native source has none — kept as such — but not a source: it still enumerates only what the global source knows, and a continent is not a unit anyone stands in. |
| Everything the enumerating source lists, no cut | OpenStreetMap tags 350 museums in Estonia against the statistics office's 160; a farm museum and a school's museum room are not "worth your time" to a traveller, and a list that says they are is the false claim ADR-0045 decision 2 forbids. |
| A world-view region as the regional tier's unit | A register covers a country and a guide a city; binding the tier to the canon's regions (#786) would leave every region without a source of its own empty and re-search the same country once per region. Placement by coordinates already maps a source's unit onto every region it overlaps. |
| A database table for the sources from the first day | Code before anything reads it, and a schema decided before the first adoption shows what a record needs. Files are reviewed and grepped like the docs they sit beside; the first sync brings the validator and, if needed, the table. |
| Google Places or a review site as the regional source — the most complete enumerations with a signal | Their terms forbid storing, combining and placing what they return (§ 5 of the rules); a scorecard of 13 with a veto is still a veto. |

## Consequences

**Positive:**
- #628 and #581 have a shape: find and record the native enumerators of the units they start
  with, score them, adopt by the rules; the public-art regional tier and every kind after them
  follow the same path.
- A unit's regional tier is honest about its source and its cut, and a region with no source
  says so instead of pretending.
- The world tier's line stops being argued about: what it leaves out has a home.
- Every search leaves records behind; the next kind in a unit already searched starts from them.
- A curator can fill Tbilisi today, by the same rules a ministry's register is judged by.

**Negative / Trade-offs:**
- Two tiers means two syncs, or one sync with two sources, per kind, and a cut rule per
  regional source; the first ones (#628) will cost more than the world tier did.
- The regional tier depends on sources that are uneven across the world — a labelled register
  in France, a spreadsheet of 135 in Poland, a law without a list in Georgia — so coverage will
  be uneven for a long time, and the fallback (a global source read per unit) will fill more
  units than the rule prefers.
- OpenStreetMap is held back (`hold`) until the catalogue answers what a derivative database
  under ODbL would bind; that answer is owed before it becomes a source of rows. Wikivoyage's
  listings are not held: the facts a listing carries — name, coordinates, item — are stored
  and its CC BY-SA text never is, which is the rules' answer to share-alike for that source.
- The rules will be revised by their first adoptions, which is a cost stated up front rather
  than a design that pretends to be finished.
- A curator's tier and badge need a screen (#603 is the badge's); until it exists the curator's
  list is a source in the rules and not yet in the product.

## References

- Related ADRs: ADR-0023 (works-first, the world tier of art museums), ADR-0024 (admission),
  ADR-0025 (the gate), ADR-0030 and ADR-0047 (a source's answers are cached, per source),
  ADR-0043 (pictures from Commons only), ADR-0045 (kinds and sources; the badge; narrowed here),
  ADR-0046 (identity across sources; counts)
- Related docs: `docs/tech/filling-a-kind.md` (the rules, the survey, the trial),
  `docs/sources/README.md` (the register), `docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md`
- PR / issue: #799; consumers #628, #581, #754, #761; #759 (closed, superseded)
