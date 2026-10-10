---
slug: ro-lmi
name: Lista Monumentelor Istorice (LMI), Romania's list of historic monuments — read through Wikidata (P1770) and the Romanian Wikipedia's county lists
publisher: Ministerul Culturii / Institutul Național al Patrimoniului (the list); Wikidata and the Romanian Wikipedia's Wiki Loves Monuments lists (the open copies read here)
urls:
  home: https://patrimoniu.ro/ro/articles/lista-monumentelor-istorice
  dataset: https://www.wikidata.org/wiki/Property:P1770 (the LMI code on Wikidata); https://ro.wikipedia.org/wiki/Lista_monumentelor_istorice_din_România (the county lists)
  api: https://qlever.dev/api/wikidata (the Wikidata copy); https://eism.geo-spatial.ro/eismgeo/rest/services/Patrimoniu/PatrimoniuWM/MapServer (the institute's own ArcGIS service behind map.cimec.ro — not read, see terms)
  terms: https://patrimoniu.ro/ro/articles/termeni-si-conditii
family: registry
kinds: [world-heritage, archaeology, places-of-worship, architecture]
tier: regional
unit: { level: country, code: RO, name: Romania }
row:
  identity: "the LMI code (e.g. CJ-I-s-A-07533: county, group I archaeology / II architecture / III public art / IV memorial, m monument or s site or a ensemble, A national or B local value, number) — Wikidata's P1770 on 30,248 items, 7,045 of them with a coordinate (2026-10-10)"
  wikidata_link: P1770
  coordinates: some
  languages: [ro]
  signal: "the listing itself, with its group (archaeology, architecture, public art, memorial) and value class (A national, B local) in the code"
terms:
  licence: "the list is an annex to a ministerial order published in Monitorul Oficial; patrimoniu.ro's Termeni și condiții reserve the site's content; the copies read are Wikidata (CC0) and the Romanian Wikipedia (CC BY-SA 4.0, text) with Commons pictures"
  database_right: reserved
  attribution: "Wikidata (CC0); Lista monumentelor istorice din județul <X>, Wikipedia în limba română, CC BY-SA 4.0"
  scraping: reserved
access:
  mode: api
  format: "SPARQL over QLever's Wikidata copy (one query: item, P1770 code, P625 coordinate, Romanian label, P18 picture — 2.8 MB, 2 s); the county lists as wikitext tables (LMI code, name, address, coordinate, Commons picture); the institute's list as PDFs per county (2015 edition) — a document, not read here"
  cadence: continuous
  volume: "7,045 LMI-coded items with a coordinate on Wikidata, 2,921 of them with a picture (2026-10-10); the 2015 list holds about 30,000 entries"
  rate: "QLever: one query; the Wikipedia API: one request at a time, with a pause (Wikimedia's etiquette)"
scorecard:
  date: 2026-10-10
  completeness: 1
  identity: 2
  coordinates: 1
  names: 1
  signal: 1
  terms: 1
  access: 2
  cadence: 2
  total: 11
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# Lista Monumentelor Istorice, through Wikidata and the Romanian Wikipedia

Romania's statutory list of historic monuments, about 30,000 entries coded by county, group and
value, updated by ministerial order (the current edition is the annex to order 2.828/2015,
Monitorul Oficial 113 bis of 15 February 2016). Looked at by #1306 for the 277 components of
Frontiers of the Roman Empire – Dacia, none of which carries a Wikidata item on the development
catalogue and 270 of which have no candidate even by place and name (#1272).

**Where the list may be read.** The institute's own pages were read for their terms, not their
data: patrimoniu.ro's *Termeni și condiții* say the user "nu poate copia, descărca, reproduce,
modifica, distribui, transmite, transfera sau crea lucrări derivând din conținutul Serviciului
fără permisiunea scrisă a Furnizorului" — no copying or downloading of the site's content
without the institute's written permission — so neither the LMI PDFs nor the map server behind
map.cimec.ro (an ArcGIS REST service on eism.geo-spatial.ro with the national archaeological
repertory, places of worship, museums and tumuli as layers, `copyrightText` empty, no
`robots.txt` on either host) is read by a run until the institute answers a written request.
The list's content is public law, and two open copies carry it: Wikidata, where the LMI code is
property P1770, and the Romanian Wikipedia's *Lista monumentelor istorice din județul <X>*
pages — the Wiki Loves Monuments tables, one row per monument with its code, address,
coordinate and Commons picture. Those are what this record measures.

**What was measured (2026-10-10).** One QLever query over Wikidata returned 7,045 LMI-coded
items with a coordinate, all with a Romanian label and 2,921 with a picture. Matched to the 277
Dacian points (`data/tmp-1306/wd-lmi-result.json`): **34 points have an LMI item within 1 km;
20 of those carry an archaeology code (`XX-I-…`) and 17 are castra by their label** — *Castrul
roman de la Gresia* (TR-I-s-B-14205) at 0 m, *Castrul roman de la Pojejena* (CS-I-s-A-10866) at
0 m, *Castrul roman Buridava* at 340 m, *Tibiscum* at 483 m, *Castrul roman Ad Pannonios* at
577 m, *Castrul roman de la Livezile* at 674 m, *Castrul roman de la Târsa* at 687 m; 19 of the
34 have a Commons picture. The other 14 hits are the village's wooden church or a roadside
cross 300–1,000 m away (Muncel, Lozna, Șintereag), so distance alone is the wrong test and the
code's group letter and the label are what tell a fort from its neighbour. On the Romanian
Wikipedia, a geosearch at Bologa with `gsprimary=all` returns the castra article *Castrul roman
Resculum* at 280 m and the county list's rows at 279–379 m — rows a primary-coordinates search
never sees.

**Terms.** Wikidata is CC0; the Wikipedia tables are CC BY-SA 4.0 text with pictures that are
Commons files under their own licences, each with its credit (ADR-0043). The institute's own
services are `reserved` until it answers. The database right over the statutory list is the
ministry's and is not waived anywhere the survey read.

**What it is for.** For a Romanian component without an item, Wikidata's LMI-coded items within
reach, filtered to the archaeology group and matched on the label, are the candidates the
component finder (#1272, #1317) should be proposing — with the LMI code as a second key beside
the name — and nineteen of them bring a Commons picture with them. The county lists reach what
Wikidata does not have yet, as rows a curator reads.
