---
slug: ch-kgs-inventar
name: KGS-Inventar — the Swiss inventory of cultural property of national significance (A-objects)
publisher: Bundesamt für Bevölkerungsschutz (BABS), Fachbereich Kulturgüterschutz, with the cantons; published through swisstopo's data.geo.admin.ch
urls:
  home: https://www.babs.admin.ch/de/kulturgueterschutzinventar
  dataset: https://opendata.swiss/en/dataset/kulturguterschutzinventar-mit-objekten-von-nationaler-bedeutung
  api: https://data.geo.admin.ch/ch.babs.kulturgueter/kulturgueter/kulturgueter_2056.xtf.zip (the dump; also the WMS/WMTS layer ch.babs.kulturgueter)
  terms: https://opendata.swiss/en/terms-of-use
family: registry
kinds: [world-heritage, archaeology, architecture, places-of-worship, art-museums]
tier: regional
unit: { level: country, code: CH, name: Switzerland }
row:
  identity: "the KGS object number (Objekt_Nr, `KGS_NR<n>`); Wikidata links to it by P381 (PCP reference number), on 13,604 items, 13,490 with a coordinate (2026-10-10)"
  wikidata_link: P381
  coordinates: all
  languages: [de, fr, it — the canton's language]
  signal: "the A category itself (national significance), object-type codes, and for a World Heritage component the nomination's own component code in the description"
terms:
  licence: "opendata.swiss terms of use «Open use» (terms_open): free use for commercial and non-commercial purposes, no attribution required; the Swiss federal disclaimer (license.txt in the download)"
  database_right: not-asserted
  attribution: "Bundesamt für Bevölkerungsschutz BABS, KGS-Inventar (not required by the terms; given)"
  scraping: not-needed
access:
  mode: dump
  format: "INTERLIS 2.3 XTF (model KGS_PBC_V2_2), 7.1 MB — KGS_Objekt (Punktkoordinate in LV95, KGS_Kategorie, Objekt_Nr, Objektart codes, Beschreibung, Gemeinde, Kanton, Signatur_Typ), KGS_Image (Bild_URL on data.geo.admin.ch, Fotograf, Copyright), KGS_Link (Weblink to the canton's inventory, Bemerkung)"
  cadence: yearly
  volume: "3,434 A-objects with a point, 8,729 images, 2,944 links in the release of 2026-09-28"
  rate: none
scorecard:
  date: 2026-10-10
  completeness: 2
  identity: 2
  coordinates: 2
  names: 2
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 14
  verdict: adoptable
status: looked-at
issue: 1306
looked_at: 2026-10-10
---

# KGS-Inventar

The federal inventory of cultural property of national significance (*A-Objekte*), kept for
civil protection under the Hague Convention and published as open geodata. Looked at by #1306
for the Swiss components of the Prehistoric Pile Dwellings around the Alps.

**What was measured (2026-10-10).** `data/tmp-1306/kgs.py` parsed the XTF release of
2026-09-28, converted LV95 to WGS 84 with swisstopo's approximate formulas, and matched the
3,434 objects to the 111 component points of the serial site, 56 of them in Switzerland by the
catalogue's own boundaries. **51 of the 56 Swiss points have an A-object within 300 m whose
description names the component by the nomination's own code** (49 within 200 m) — "Riesi
(CH-AG-02), Fundstelle der UNESCO Welterbestätte «Prähistorische Pfahlbauten um die Alpen»"
(Seengen, 117 m), "Corsier-Port (CH-GE-02), site du patrimoine mondial de l'UNESCO" (3 m),
"Spitz (CH-FR-03)" (Greng, 0 m), "Bahnhof (CH-BE-07)" (Twann-Tüscherz, 1 m), "Lobsigensee
(CH-BE-05)" (242 m), "Baie de Clendy (CH-VD-15)" (274 m). The five Swiss points without such a
record have a neighbour instead — Insel Werd has the Roman vicus Tasgetium at 66 m, Rütte the
Von Rütte estate at 189 m, Zürich's Kleiner Hafner a paddle steamer at 248 m — or nothing near
(Feldbach, Enge Alpenquai). None of the 55 points in Italy, Germany, France, Austria and
Slovenia has a KGS object within a kilometre, as a national inventory should leave them. The
three Swiss points with no Wikidata item on the catalogue — Spitz, Les Grèves, Les Roseaux —
all have their KGS component record: for this site the inventory fills 3 of the 3 Swiss gaps
Wikidata leaves. Each
matched record carries the canton, the municipality, the object-type codes (1128, 1131, 1132;
the code list is in the model `KGS_PBC_V2_2` on models.geo.admin.ch, not in the XTF) and one to
three links to the canton's own inventory (ag.ch Denkmalpflege and the like). Pictures: 6 of
the 51 objects have a `KGS_Image`, each a JPEG on data.geo.admin.ch with `Fotograf` and
`Copyright` ("© www.picswiss.ch") — a third party's photograph, not a Commons file, so the
product may not draw it (ADR-0043) even though the credit line exists.

**Terms.** Every resource of the BABS dataset on opendata.swiss carries
`https://opendata.swiss/terms-of-use#terms_open` — «Open use»: "You may use this dataset for
non-commercial purposes. You may use this dataset for commercial purposes. You are not required
to provide the source." The download ships the federal disclaimer (www.disclaimer.admin.ch) on
liability. No `robots.txt` question arises: the dump is a file.

**What it is for.** For a Swiss component the inventory is the register that already knows it
*as* a World Heritage component, with an exact coordinate, the component code as a second key
beside the name, and an official cantonal page to link. The description is one line in the
canton's language; the picture, where there is one, is not reusable. The object number is
Wikidata's P381, which is a second road to the item where one exists — and on the development
catalogue 53 of the 56 Swiss points already carry one, so here the inventory confirms far more
than it fills; its value is the three it does fill, a Swiss component of another serial site, or
a Swiss place of another kind that has no item yet. The product review of 2026-10-10 does not
adopt a national register for the parts' picture and description — the general sources are read
first — and keeps this record as the reference for when one is.
