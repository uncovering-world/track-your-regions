# ADR-0059: What the catalogue takes from OpenStreetMap it keeps separable and offers under ODbL

**Date:** 2026-09-13
**Status:** Accepted

---

## Context

OpenStreetMap is licensed under the Open Database License 1.0 (ODbL). The licence permits
commercial use; what it asks is **attribution** wherever the data or a work made from it is
shown, and **share-alike** on a *derivative database* — a database made by taking a substantial
part of OpenStreetMap and modifying or combining it — that is publicly used: such a database
must be offered under ODbL to anyone who asks. A *collective database*, in which OSM-derived
data sits beside independent data without being blended into it, binds only the OSM-derived
part (the OSM Foundation's Collective Database Guideline). A *produced work* — a rendered map,
a page — needs the attribution and nothing more. Whether we sell anything is not the question
the licence asks.

The catalogue has been holding OpenStreetMap at arm's length because that question was never
answered for it. `docs/tech/filling-a-kind.md` § 5 and § 6.2 make share-alike a `hold` on any
source, and the register's OSM record (`docs/sources/global/openstreetmap-overpass.md`, verdict
`hold`, 12 of 16) says the answer is owed "for the catalogue as a whole". ADR-0002 rejected OSM
for boundaries citing "licensing complexity for derived data". A planning session of
2026-06-24 accepted ODbL share-alike for geometry sources and noted that the obligation had to
be "taken into account separately for a future public product"; no ADR recorded it. Meanwhile
the foundation the catalogue stands on is already not commercial: GADM, the source of every
administrative division, forbids redistribution and commercial use without permission.

The archaeology kind (ADR-0058) is the first place OSM answers a question nothing else does:
whether an item Wikidata files under `archaeological site` is a ruin a traveller stands in
(`historic=archaeological_site`, with a site type and a polygon — Machu Picchu, Stonehenge,
Troy) or a living city (`place=city`, Athens). Measured on 2026-09-13 through the QLever mirror
of the OSM planet (`qlever.dev/api/osm-planet`, a SPARQL endpoint of the same shape the catalogue
already reads Wikidata through): 228,974 objects tagged `historic=archaeological_site`, 26,682
of them carrying a `wikidata` tag; of the 195 famous sites Wikidata's class rule loses, OSM knows
98, calls 17 archaeological sites and 45 living towns. The same mirror serves each object's
geometry as WKT.

## Decision

**1. OpenStreetMap may be read as a source: of a classification, of an extent, and — where a
kind's rules adopt it — of rows.** The `hold` of `filling-a-kind.md` § 6.2 is lifted for OSM on
the terms below; the register record moves from `hold` to a scorecard verdict on its merits, and
each kind's issue still adopts it or not for that kind.

**2. What is derived from OpenStreetMap is kept separable.** A fact the catalogue takes from
OSM — a verdict that an item is a site or a town, a site's extent, a coordinate, a row — is
stored with its provenance on the row or the field: the OSM object (`node/way/relation` and
id), the tag read, and the date. It is never blended into a column whose other values come from
elsewhere without that mark. This is the collective-database shape: the OSM-derived part of the
catalogue can be named and extracted, and the rest of the catalogue is not bound by it.

**3. The OSM-derived part is offered under ODbL, and the credit is shown.** Anyone who asks may
have the catalogue's OSM-derived data under ODbL. The attribution "© OpenStreetMap contributors"
is shown wherever that data is shown — on a card whose extent or verdict came from OSM, in the
register record, and in the product's data-sources note — in the form the OSM Foundation's
attribution guideline asks for.

**4. A connector to OpenStreetMap is written from a register record that has read the
policies, never before.** Before any code reads OSM for a kind, its register record quotes and
follows: the ODbL text and the OSMF community guidelines that apply (Attribution, Collective
Database, Substantial, Geocoding, Produced Work); the usage policy of the endpoint used — the
public Overpass instances' limits, or the terms and rate of a third-party mirror such as the
QLever OSM planet, which is not an OSM Foundation service and answers no faster than it is
asked politely; the tagging documentation of the keys read (`historic=archaeological_site`,
`archaeological_site=*`, `place=*`, `wikidata=*`); and the conventions of the `wikidata` tag,
which points at the item of the mapped object and not always at the item the catalogue holds
(Pompeii's item is tagged on the town's node, not on the excavations). A `User-Agent` that names
the project and a contact (`userAgent()`, ADR-0043's rule), a rate inside the policy, and a
cache of the answers (ADR-0030) are part of every connector.

**5. Reading OSM as a yardstick — to find and to count — binds nothing and needs no record
beyond the query.** That was already the rules' reading and it stands.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Never read OpenStreetMap; Wikidata and registers only | Loses the one source that says what stands on the ground: Wikidata's site tree cannot tell Athens from Pompeii without it, and the regional tier of sites has no other enumeration. |
| Read OSM only for verdicts and store nothing derived | A verdict stored on a row *is* derived data; pretending otherwise is the licence question left unanswered. Storing it with provenance is cheaper than arguing it is not there. |
| Publish the whole catalogue under ODbL | Not this ADR's to decide: the catalogue's own licence, and what GADM's terms allow, are a decision for the product's public release. Keeping the OSM-derived part separable leaves that decision open without blocking the kinds that need OSM now. |
| Rely on "we do not sell it" | ODbL permits commercial use and binds derivative databases whether or not money changes hands; the obligation is share-alike and credit, and it is met by decisions 2 and 3. |

## Consequences

**Positive:**
- The archaeology kind (ADR-0058) and, later, the regional tier of sites and the disputed-area
  geometry the world-view work has wanted since 2026-06-24 can read OSM without re-opening the
  licence each time.
- Provenance per derived fact is what ADR-0039 asks of a run anyway; here it also names what a
  future ODbL extract must contain.

**Negative / Trade-offs:**
- Every card that shows an OSM-derived extent or verdict carries one more credit line, beside
  the picture's.
- An ODbL extract of the OSM-derived part must be producible on request; the provenance marks
  are what make it so, and a test that every OSM-derived write carries them is owed with the
  first connector.
- Third-party mirrors (QLever's OSM planet) can change their endpoint or terms; the Overpass
  public instances are rate-limited and were unreliable on the day this was measured. The
  connector needs a fallback and a cache, as the Wikidata one has.

*Accepted on 2026-09-14 (#581 PR 2): the first connector exists, written from the register record
decision 4 asks for (`docs/sources/global/openstreetmap-qlever.md`), and every one of the four
obligations has a place in the code. The provenance is `metadata.osm` on the row, carrying the
object, the tag and the date; the OSM-derived part of a kind-5 site row is that key, `boundary`
and `area_km2` and nothing else; the credit is `ExtentLine`, which renders the extent and
"© OpenStreetMap contributors" together or renders nothing; and the reader carries the
`User-Agent`, the rate and the cache the decision asks of every connector.*

## References

- ODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/ ; OSMF community guidelines:
  https://wiki.osmfoundation.org/wiki/Licence/Community_Guidelines ; attribution guideline:
  https://wiki.osmfoundation.org/wiki/Licence/Attribution_Guidelines ; Overpass usage policy:
  https://dev.overpass-api.de/overpass-doc/en/preface/commons.html ; QLever OSM planet:
  https://qlever.dev/osm-planet
- Related ADRs: ADR-0002 (boundaries; rejected OSM for licensing complexity), ADR-0030 (answers
  cached with an expiry), ADR-0039 (a run records facts), ADR-0043 (the User-Agent rule),
  ADR-0048 (sources are records before code; the hold this lifts), ADR-0058 (the first reader)
- Related docs: `docs/sources/global/openstreetmap-overpass.md`, `docs/tech/filling-a-kind.md`
  § 5, § 6.2
- PR / issue: #581
