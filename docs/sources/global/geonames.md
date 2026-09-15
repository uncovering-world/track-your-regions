---
slug: geonames
name: GeoNames, the geographical database and its feature codes
publisher: GeoNames (Marc Wick), from national gazetteers (NGA GNS, USGS GNIS) and its users
urls:
  home: https://www.geonames.org/
  dataset: https://download.geonames.org/export/dump/
  api: https://api.geonames.org/ (a username is required)
  terms: https://www.geonames.org/about.html
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, one feature per named thing, coded by what it is" }
row:
  identity: "the GeoNames id; Wikidata links to it by P1566, and the alternate-names dump links back by the `wkdt` type"
  wikidata_link: P1566
  coordinates: all
  languages: [all]
  signal: "the feature code — ANS (archaeological or prehistoric site), RUIN (ruins), HSTS (historic site), PRHST (prehistoric site), beside TMPL, TMB, CSTL, MNMT, PAL"
terms:
  licence: "CC BY 4.0"
  database_right: waived
  attribution: "GeoNames (geonames.org)"
  scraping: not-needed
access:
  mode: dump
  format: "tab-separated dumps — allCountries.zip (422 MB), alternateNamesV2.zip (204 MB), daily"
  cadence: daily
  volume: "72,057 features under the codes this kind reads (RUIN 18,843; TMB 11,557; TMPL 8,926; HSTS 6,301; ANS 5,955; CSTL 5,677 …); 2,603 of them carrying a Wikidata link; 1,111,547 `wkdt` links in all (2026-09-15)"
  rate: "none for the dump; the web services are metered per username"
scorecard:
  date: 2026-09-15
  completeness: 1
  identity: 2
  coordinates: 2
  names: 2
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 14
  verdict: adoptable
status: looked-at
issue: 895
looked_at: 2026-09-15
---

# GeoNames

Looked at by #895 as a source of digs from a lineage that is neither Wikipedia's nor
OpenStreetMap's — the national gazetteers behind GeoNames code ruins abundantly in the Near
East and the classical world — and not adopted (ADR-0060 decision 4).

## What was measured (2026-09-15)

From the two dumps, the features coded as this kind might read them and every alternate name
of type `wkdt` (the Wikidata link the dump carries):

| how a feature meets a candidate | 432 category arrivals | 586 World Heritage twins |
|---|---|---|
| the candidate's own P1566 feature is coded ANS / RUIN / PRHST | 2 | 4 |
| a feature coded so links back to the candidate's item (`wkdt`) | 5 | 8 |
| a feature coded so lies within 1.5 km of the candidate | 73 | 37 |

**The precise reading is sparse and the loose one is noise.** Coded on the item's own feature:
Sanchi (ANS), Ayutthaya Historical Park (RUIN), Qasr Amra and the Appian Way (ANS); Sukhothai
Historical Park is `HSTS`, Nemrut's own item carries no GeoNames link at all though the
gazetteer links its tumulus to GeoNames 7513625, a feature the kept codes do not hold. Within
1.5 km, a ruin feature stands beside Istanbul (the Forum of Theodosius), the Vatican (Nero's
circus), Venice (the Tetrarchs), Verona, Bridgetown — every historic city has one. Only
2,603 of the 72,057 features under the kept codes carry a Wikidata link, and 241 of those are
ANS / RUIN / PRHST — 94 of them items OpenStreetMap does not already name.

## How the scorecard was read

`docs/tech/filling-a-kind.md` § 6.2 on its world-tier sense. **Signal 1**: the code is a real
statement about what a feature is, from a gazetteer that names a ruin as readily as a well;
what it does not carry is any sense of which ruin the world visits. **Completeness 1**: the
coverage follows the national gazetteers it was built from — dense where NGA mapped, thin
elsewhere — and the Wikidata link reaches one feature in thirty. **Identity 2** through P1566
and `wkdt`; **Access 2** for the dump. The verdict is the scorecard's — 14 is `adoptable` by the
register's line — and the source is set aside for the reason the measurement gives, not for
its score (ADR-0060 decision 4): `status` says what a run reads today, `verdict` what the
scorecard says.

## Terms

CC BY 4.0, stated on the About page; attribution to GeoNames wherever its data is shown. The
dump is read whole and nothing is scraped. Not read by any run today; the measurement's
extract is `data/cache/895-site-doors/geonames/`.

## What this source cannot reach

- Which ruins are worth a traveller's day: the code is the same on Silbury Hill and on a
  tumulus in a field.
- Most of the catalogue's own rows: the Wikidata link is on one feature in thirty, and a
  proximity join meets a different ruin in every old city.
