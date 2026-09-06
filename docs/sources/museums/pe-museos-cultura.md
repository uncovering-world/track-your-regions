---
slug: pe-museos-cultura
name: Museos del Ministerio de Cultura (museos.cultura.pe) and the Registro Nacional de Museos
publisher: Ministerio de Cultura del Perú, Dirección General de Museos
urls:
  home: https://museos.cultura.pe/museos
  dataset: https://www.datosabiertos.gob.pe/dataset/sistema-nacional-de-museos-del-estado
  api: none
  terms: none
family: registry
kinds: [art-museums, archaeology-museums, history-museums]
tier: regional
unit: { level: country, code: PE, name: Peru }
row:
  identity: "the name; a registry code exists in the Registro Nacional but was not seen"
  wikidata_link: none
  coordinates: none
  languages: [es]
  signal: "administered by the ministry (the directory) — a fact about ownership, not about a traveller's visit"
terms:
  licence: unknown
  database_right: unknown
  attribution: "Ministerio de Cultura del Perú, Dirección General de Museos"
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: unknown
  volume: "56 museums administered by the ministry, as the directory states"
  rate: unknown
scorecard:
  date: 2026-09-06
  completeness: 0
  identity: 1
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 5
  verdict: not-adoptable
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# Museos del Ministerio de Cultura, and the Registro Nacional de Museos

Two things under one record, because the second was not reachable. The ministry's directory
at `museos.cultura.pe` lists the 56 museums the Ministry of Culture administers — state
museums — with a thumbnail, virtual tours and collection links, filterable by department, and
without addresses, coordinates, licence or download. The *Registro Nacional de Museos Públicos
y Privados* (2015), the wider list of public and private museums, sits on the national open-data
portal, whose host did not resolve from here on 2026-09-06.

**What decides it.** Completeness 0 for the art-museums kind, and it is the instructive case of
`docs/tech/filling-a-kind.md` § 7.1: a state directory enumerates the state's own. Lima's
museums a traveller goes to — the Larco Museum (18 sitelinks, tagged with its item on
OpenStreetMap), the Lima Art Museum (10, untagged), the Pedro de Osma museum — are private and
absent from it. Wikidata knows 30 museums in Lima (28 with coordinates, 3 art museums, none
at 22 sitelinks); OpenStreetMap 109 in the metropolitan box, 35 with a Wikidata tag;
Wikivoyage's *Lima/Central Lima* article 99 See listings, 30 with an item. The national
registry is the candidate to measure; until then Lima's regional tier is the global-read-per-
unit fallback with a curator's cut.
