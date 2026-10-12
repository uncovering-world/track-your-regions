# ADR-0094: The item named as a World Heritage property is its item, whichever number it carries

**Date:** 2026-10-12
**Status:** Accepted

---

## Context

ADR-0088 decision 1 reads a World Heritage site's Wikidata items off its property number. It takes
every item carrying the property's own number, or a later numbering where no item carries the own
number. ADR-0043 decision 2 orders the picture the same way: the site's number first, then a later
numbering, then the lowest-numbered component.

An extension is numbered on, and the item that carries the first inscription's number is often a
part of the site or the site as it was. On the development catalogue on 2026-10-11 (#1373):

- The Moravian Church Settlements held only Christiansfeld (`1468`). The item of the property as
  inscribed today carries `1468bis`.
- The Cerrado Protected Areas held Cavernas do Peruaçu National Park (`1035`). Its own item carries
  `1035bis`. The Cerrado's card showed a cave 600 km from either park, because Peruaçu, a property
  of its own (`1747`) since 2025, still carries `1035` on Wikidata.
- Gelati Monastery showed Bagrati Cathedral, which left the property in 2017. Its `710` item is
  "Bagrati Cathedral and Gelati Monastery", and Gelati alone is `710bis`.
- Where the own number sits on several items, the tier keeps them all, the part beside the whole:
  Hagia Sophia beside Historic Areas of Istanbul, the Parthenon beside the Acropolis of Athens, the
  Patan Museum beside Kathmandu Valley. A site of several items is never merged (ADR-0088
  decision 2), so the Acropolis stayed two cards beside the archaeology row of the same item.

ADR-0088 rejected merging on several items "picking one by name", because Venice and "Venice and
its Lagoon" are two things. The name is not asked to choose between two things here. It is asked
which carrier *is* the property, and the answer it gives is narrower than a choice: a label every
word of which is in the property's name.

## Decision

1. **The items named as the property are its items, whichever numbering they carry** (narrows
   ADR-0088 decision 1). Among the items carrying the property's number or a later numbering of
   it, an item is named as the property when every word of its label is in the site's name, and
   no other such item shares more of the name (`namedAsTheProperty`, `unescoWikidata.ts`). Ties
   are kept: Galápagos Islands is two items alike, and a site of two items still merges on none.
   Where no label lies wholly in the name, the tiers of ADR-0088 decision 1 stand unchanged. A
   deprecated statement names nothing, and a component never.
2. **Those items answer first for the article and the picture** (narrows ADR-0043 decision 2's
   order). After them come the tiers as before. A carrier whose label shares less than half of
   its words with the name (`ANSWERS_TO_THE_NAME`) is asked for a picture only after the
   components, so that a part named for something else does not stand for the whole. A site with
   no other picture still takes its picture. The match stays by id: the name orders the carriers
   of the property's number and never brings in an item that does not carry it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The latest numbering's items first (`356bis` over `356`) | Replayed on 2026-10-12, it fixes the six sites #1373 names and moves four the wrong way. Durmitor would become the Tara River Canyon (`100bis`), Sheki the Palace of Shaki Khans (`1549rev`), Guimarães the Couros Zone (`1031bis`) and Budapest the Piarist centre (`400bis`). It also splits Bam, W-Arly-Pendjari and Monte San Giorgio into two items each. |
| The numbering the site's components carry | 14 sites mix numberings among their components on 2026-10-12, the Côa Valley among them, and a site of one point carries none. |
| Keep the tiers and let a curator pin the item | The catalogue holds 1,272 sites, and 87 of them are measured below. A curator would have to find each one by reading cards. |

## Consequences

**Positive:**
- Replayed over the 1,272 sites from the items Wikidata held on 2026-10-12:
  - 87 sites name another item, each time the whole where a part or the earlier inscription was
    held beside it or instead of it.
  - 12 pictures move, among them the Cerrado to Chapada dos Veadeiros and Gelati to the monastery.
  - 3 articles move, each to the property's own.
- 48 of the 87 are sites of one point whose item count changes. Four of them become one item that
  another row of the catalogue holds, and merge on the World Heritage source's next run:
  - Sacred City of Anuradhapura with the archaeology row Anuradhapura;
  - Acropolis, Athens with the archaeology row Acropolis of Athens;
  - Gelati Monastery with the place of worship of that name;
  - Abbey Church of Saint-Savin sur Gartempe with the place of worship of that name.

  Each is one place a traveller visits once. No site of one point loses a merge it had.

**Negative / Trade-offs:**
- The rule reads an English label. A carrier whose label is missing, or worded unlike the
  portal's name, is not named as the property, and the tiers decide as before.
- A one-word label wholly inside the name can be a part rather than the whole. Budj Bim Cultural
  Landscape now names Budj Bim alone. Phong Nha–Ke Bang and Hin Nam No now names the Vietnamese
  park alone, which carries `951bis` and whose words are all in the property's name. Both are
  serial sites, which are never merged on the item.
- The Cerrado keeps Peruaçu's article. An article stand-in is chosen by renown, not by name
  (ADR-0043 is unchanged there), and the same rule gives Via Appia the Appian Way's article.

## References

- Related ADRs: ADR-0088 (decision 1 narrowed), ADR-0043 (decision 2's order narrowed), ADR-0046
  (what a merge is)
- Related docs: `docs/tech/experiences.md` § the site's Wikidata items
- PR / issue: #1373, #1396
