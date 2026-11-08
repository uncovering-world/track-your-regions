# ADR-0188: A ruin mapped near a site under its name shows the site

**Date:** 2026-11-08
**Status:** Accepted

---

## Context

[ADR-0179](0179-archaeologys-sites-admit-by-the-frame-and-its-surroundings-tier-asks-the-map-for-a-ruin.md)
decision 3 admits a site to Archaeology's surroundings tier only where the map shows the place: an
OpenStreetMap object that carries the item's `wikidata` tag and that the site rule reads as a ruin or
a dig. It brought the noise among the tier's additions from 10.2 % to 3.5 %.
[ADR-0185](0185-archaeology-reads-a-world-heritage-listing-as-a-mark-and-as-the-map.md) let a World
Heritage listing stand in for the map.

Many ruins are mapped without their item. In the places-pass dry run of 2026-11-08 (#2381, logs
575–582), the condition refused 674 Archaeology candidates. A reproducible random sample of 80 of them
(seed 2381), judged as a traveller would, held:

- **38 ruins one visits:** Xpuhil, Nakum, Bhangarh, La Hougue Bie, the Tunnels of Claudius, the
  Theatre of Carthage, Medamud.
- **24 refused rightly:** cultures (Wucheng), places under water (Faras, Seuthopolis), a living mosque
  (İsa Bey), battlefields (Vicksburg), show caves, and finds spots with nothing to see.
- **18 unsure.**

Most of the 38 are on the map all the same, as an excavation or a ruin under the site's own name with
no `wikidata` tag: *Area archeologica dell'antica Abellinum*, *Candi Muara Takus*, *Necropoli Li
Muri*.

## Decision

**In Archaeology's surroundings tier, a ruin or dig mapped near a site under the site's name shows the
site, as an object carrying its item does.**

- **What counts as near and named.** An object of the local OpenStreetMap layer tagged
  `historic=archaeological_site` or `historic=ruins`, within 2 km of the item's point, whose `name` or
  `name:en` holds, as a whole word, a word of any of the item's Wikidata labels. The word has four
  letters or more, and accents are folded. Words every site's name may carry are left out, in the
  subset's label languages, together with the regional words a class of sites is named by: *temple*,
  *tempio*, *ruinas*, *castello*, *nuraghe*, *tell* (`GENERIC_WORDS`). A whole word keeps *tell* out
  of *Castello*.
- **Where it is read.** `namedRuinsNear` reads it off `osm_objects` and the local subset's labels. It
  is asked only of the survivors the map does not show by their item and no World Heritage listing
  stands in for. With no layer in place nothing is read: no new site enters by a name, and a site the
  tier holds keeps its standing (ADR-0175 decision 6), since the item-based read of the map falls back
  to the live mirror and this one has none.
- **It never shows an archaeology museum**, which the kind admits by its finds. The National
  Archaeological Museum of Paestum would otherwise come in beside Paestum, by Paestum's own ruins, as
  it did through the World Heritage doors (ADR-0185 decision 3). An item Wikidata also types an
  archaeological culture is not refused for it: Dimini is typed one and is a Neolithic settlement one
  visits, and Dadiwan's type site lies under its culture's point.
- **What the curator sees.** The card names the ruin it was shown by (`namedRuinNote`), and the arrival
  waits for a curator, as every Archaeology arrival does.
- **The register** states the radius
  (`ARCHAEOLOGY_SURROUNDINGS_REGISTER.namedRuinWithinMetres`). A radius of 0 turns the reading off.

## Measurement

On the 80-place sample, read off the dev layer (30.9 M objects, 420 k of them ruins or digs):

| Condition | Ruins admitted (of 38) | Wrong admitted (of 24) |
|---|---|---|
| Any ruin or dig within 300 m | 19 | 5 |
| Any ruin or dig within 2 km | 23 | 7 |
| A ruin or dig inside an area carrying the item | 3 | 0 |
| A ruin or dig whose name holds a word of the item's labels as a substring, within 2 km | 18 | 0 |
| **The same, the word whole and the generic words of six languages left out (the rule)** | **16** | **0** |

The unnamed ruins near wrong places are what made the plain radius noisy: one beside the İsa Bey
Mosque, a wat beside the Chandra Kasem palace. Naming the ruin removes them, and keeps nearly every
ruin the radius found. Over the 674 refusals, about 130 sites a traveller visits enter. The
main-against-branch dry run on the pull request counts them.

## The dry run

Main 60f7860d2 against 4569c5ec4 on dev (logs 591–598 and 599–606), compared by kind and external id:
- **Only Archaeology changed.** 185 places left `filtered`: 154 are created and 31 gain Archaeology.
- **Most are ruins a traveller visits:** Abellinum, Candi Muara Takus, Li Muri, Pessinus, Chysauster,
  Neak Pean, Lolei, Preah Ko, Xpuhil, Chicanná, Edzná, Comalcalco, Ollantaytambo, Sbeitla, Tlos and
  Bosra.
- **One place was wrong, and the museum exclusion above closes it:** the National Archaeological
  Museum of Paestum. An exclusion of archaeological cultures was tried too, and dropped. A re-run at
  1ed867843 showed it took out Dimini, a Neolithic settlement typed both a culture and a site, along
  with the Dadiwan culture.
- **A few are left to the curator, whom every Archaeology arrival waits for.** Their item is typed an
  archaeological site and the ground holds something of one:
  - mountains with a Celtic oppidum (Milseburg, the Bruchhauser Steine);
  - the Varus battlefield's park at Kalkriese;
  - the Whitman Mission;
  - the submerged park of Baia;
  - a chapel built on a dolmen (Santa Cruz de Cangas de Onís);
  - the Dadiwan culture, whose item sits on its type site.

## Consequences

- About two fifths of the ruins ADR-0179's map condition lost return, and none of the sample's wrong places do.
- A ruin is read by its name, and a name can mislead: two places that share a rare word within 2 km
  are read as one. The sample shows none. The curator answers each arrival.
- The world tier is unchanged. ADR-0179's conditions are the surroundings tier's alone.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Any ruin within a radius | It admits a fifth of the rightly refused places, which lie near unrelated ruins. |
| A ruin inside an area that carries the item | It is clean, but it reaches 3 of 38. |
| Drop the map condition | ADR-0179 measured 10.2 % noise without it. |
| Leave the condition, and have curators add the lost ruins | About 300 real ruins, added one by one, against a rule that reads them. |

## Related

- ADR-0179 (decision 3 narrowed here), ADR-0185, ADR-0134 (the local layer).
- #2381.
