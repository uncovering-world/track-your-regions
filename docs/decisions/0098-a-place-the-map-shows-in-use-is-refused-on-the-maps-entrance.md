# ADR-0098: A place the map shows in use is refused on the map's entrance

**Date:** 2026-10-12
**Status:** Accepted
**Issue:** [#1352](https://github.com/uncovering-world/track-your-regions/issues/1352)
**Narrows:** [ADR-0060](0060-the-site-pool-has-a-second-entrance-the-map.md) decisions 2 and 3

---

## Context

ADR-0060 let Archaeology's site pool take in a candidate only OpenStreetMap named — no class under
`archaeological site` on the item — and listed what Wikidata's classes can say against the map's
word. It considered a veto on classes of worship and rejected it: Reims, Palermo and Monreale
cathedrals arrive under `historic=archaeological_site`, and so do Ajanta, Ellora, the mortuary
temple of Hatshepsut and Esagila; a living cathedral was to be one card for a curator.

On 2026-10-12 the 89 Archaeology arrivals open on the development catalogue held those cards and
more: Reims, Palermo and Monreale cathedrals, Gol Stave Church, the Lingaraja and Brihadisvara
temples, the Kailasa temple at Ellora, and Prora, whose blocks people live in. A mapper's
`historic=archaeological_site` sat on the cathedral's crypt (Reims, `node/7388163831`) or on the
whole temple precinct (Lingaraja, `way/225868292`).

A class veto still cannot tell them from the ruins: measured over the same 89, the worship,
fortification, palace and museum trees refuse the mortuary temple of Hatshepsut, Esagila, the
Jesuit missions of the Guaraní, the Hồ citadel, Babak Castle and the Karla Caves beside the living
buildings. OpenStreetMap can. The same item's objects carry what the place is used for:
`amenity=place_of_worship` on Reims Cathedral's own building (`way/92294792`), on the Lingaraja
precinct beside its dig tag; `building=apartments` on Prora's blocks; `historic=castle` with no
ruin tag on Bamburgh Castle. Read off every object of the item outside a ruin, that signal fires on
nine of the 89 — the eight above and Bamburgh — and on none of the ruins: Dunfermline's abbey
carries `amenity=place_of_worship` beside `ruins=yes`, Zvartnots' church `historic=ruins`, and the
mortuary temple of Hatshepsut, Esagila, the Jesuit missions and the Hồ citadel carry no such tag.

## Decision

**1. A candidate only the map named is refused when one of its objects says the place is used
today** (narrows ADR-0060 decision 2). `inUseOf` (`siteTest.ts`) reads `OSM_IN_USE`
(`siteClasses.ts`) off an object the mapper did not mark as ruins — `historic=ruins`, a `ruins`
key, `building=ruins`: a place of worship (`amenity=place_of_worship`), homes (`building=apartments`,
`residential`, `house`, `dormitory`), a standing castle or palace (`historic=castle`, `palace`). The
refusal is in the living group and names the object: *in use today — OpenStreetMap maps it as a
place of worship (amenity=place_of_worship on way/92294792), and Wikidata gives it no class of a
site; only a mapper's tag calls it an archaeological site here (…)*. World Heritage on the item
does not lift it — Reims Cathedral carries it.

**2. English Wikipedia's category is read for such a candidate too, and lifts the refusal**
(narrows ADR-0060 decision 3). `categoryVotes` runs after the per-item read, since a place used
today is said so by its objects, and asks of a row in use as of a row that states a population.
Bamburgh Castle, filed under *Archaeological sites in Northumberland* for its research
excavations, comes in this way, as Jerash does.

**3. Only the map's entrance.** A candidate the class tree vouches for is judged as ADR-0058
decision 4 judges it; Angkor's or Ephesus' objects in worship do not refuse the site.

## Alternatives Considered

- **The class veto ADR-0060 rejected** — it refuses six of the ruins measured above.
- **Requiring the dig object to carry the item's own outline** — the dig tag sits on the whole
  Lingaraja precinct, and on a node for Reims; no geometry rule separates the two.

## Consequences

- What the signal does not reach stays a curator's card: Amber Fort, Derawar Fort, the Hill of
  Crosses, Gol Gumbaz and Jantar Mantar carry no object the map says is in use, and the Pergamon
  Altar and Pitch Lake are an exhibit in Berlin and a tar pit, no building at all.
- The per-item read asks two more keys, `amenity` and `building` (`OSM_TAG_KEYS`).
