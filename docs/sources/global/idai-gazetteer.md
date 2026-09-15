---
slug: idai-gazetteer
name: iDAI.gazetteer, the German Archaeological Institute's gazetteer of places
publisher: Deutsches Archäologisches Institut (DAI)
urls:
  home: https://gazetteer.dainst.org/
  dataset: https://gazetteer.dainst.org/app/
  api: https://gazetteer.dainst.org/search.json
  terms: https://gazetteer.dainst.org/app/#!/help
family: global
kinds: [archaeology]
tier: world
unit: { level: any, code: none, name: "the world, as the institute's departments have worked it — Athens, Rome, Cairo, Istanbul, Madrid, Baghdad, Tehran, Sanaa" }
row:
  identity: "the gazetteer id (`gazId`); links out to GeoNames, Pleiades, Arachne and the GND, rarely to Wikidata"
  wikidata_link: P8217
  coordinates: most
  languages: [de, en, and the local names]
  signal: "a place type an archaeologist filed — `archaeological-site`, `archaeological-area` — beside `populated-place`, `landform`, `administrative-unit`"
terms:
  licence: "CC BY 4.0"
  database_right: waived
  attribution: "iDAI.gazetteer, Deutsches Archäologisches Institut"
  scraping: not-needed
access:
  mode: api
  format: "JSON — `search.json?q=<name>` (ten thousand results at most, no paging past them, no dump found)"
  cadence: continuous
  volume: "about 10,000 places typed archaeological-site and 1,611 archaeological-area (the search's own cap, 2026-09-15)"
  rate: "none published; the measurement asked one question per candidate, half a second apart"
scorecard:
  date: 2026-09-15
  completeness: 1
  identity: 1
  coordinates: 2
  names: 2
  signal: 1
  terms: 2
  access: 1
  cadence: 2
  total: 12
  verdict: adoptable
status: looked-at
issue: 895
looked_at: 2026-09-15
---

# iDAI.gazetteer

Looked at by #895 as a source of the digs the Wikidata class tree and OpenStreetMap miss —
a gazetteer written by archaeologists, not by encyclopedia editors or mappers — and not
adopted (ADR-0060 decision 4).

## What was measured (2026-09-15)

Asked by name and coordinate (a hit within two kilometres) about the two candidate sets the
issue had drawn:

| set | asked | a hit typed `archaeological-*` | … and not also `populated-place` |
|---|---|---|---|
| the 432 category arrivals at the line | 427 | 47 | 17 |
| the 586 World Heritage twins at the line | 580 | 11 | 7 |

**The gazetteer files the living city as a site.** Rome (*Roma*), Constantinople, Athens
(*Athina*), Thessaloniki, Tyre (*Tyros*), Sidon (*Saida*) and Syracuse (*Siracusa*) are each
`archaeological-site` beside `populated-place` — the institute's places are where its
departments have dug, and a city with antiquity under it is one. That is the same shape as
Wikidata's tree holding Athens through `free city`, with no second signal to tell Troy from
it. Where the gazetteer is precise it is about the classical world: Gerasa (`populated-place`,
`archaeological-area`, linked to GeoNames and Pleiades), Aigai and Vergina (`archaeological-site`),
Nemrut Dağı (`archaeological-site`). Nothing for Sanchi, Ajanta, Sukhothai or Ayutthaya.

**The link from Wikidata is thin.** `P8217` sits on 12 of the 432 category arrivals and 4 of
the 586 twins; the gazetteer itself links to GeoNames, Pleiades, Arachne and the GND, and only
rarely to Wikidata, so the join is by name and coordinate.

**No export.** The search caps at ten thousand results and offsets past them answer nothing;
the repository (`dainst/gazetteer`) documents an admin reindex and no dump. An enumeration
would be ten thousand questions by country, against a page that says nothing about how many
a caller may ask.

## How the scorecard was read

`docs/tech/filling-a-kind.md` § 6.2 on its world-tier sense. **Identity 1**: a stable id of
its own, joined to ours by name and distance. **Signal 1**: a professional's type, and one
that says *this ground was worked* rather than *a traveller stands in a ruin here*. **Access
1** for the cap and the missing dump. **Completeness 1**: the classical world and the Near
East, the institute's departments' reach; South and Southeast Asia thin. The verdict is the
scorecard's — 12 is `adoptable` by the register's line — and the source is set aside for the
reason the measurement gives, not for its score (ADR-0060 decision 4): `status` says what a
run reads today, `verdict` what the scorecard says.

## Terms

CC BY 4.0 on the site's own help page; attribution to the institute wherever its judgement
is shown. Nothing scraped. Not read by any run today.

## What this source cannot reach

- A dig outside the institute's field: India, Southeast Asia, the Americas.
- The difference between a city with antiquity under it and the antiquity itself, which is
  the one distinction the site rule turns on.
