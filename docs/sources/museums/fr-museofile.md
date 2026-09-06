---
slug: fr-museofile
name: Liste des Musées de France (Muséofile)
publisher: Ministère de la Culture, Service des musées de France
urls:
  home: https://www.culture.gouv.fr/thematiques/musees/Les-musees-en-France/les-musees-de-france/museofile-le-repertoire-des-musees-de-france
  dataset: https://www.data.gouv.fr/datasets/liste-des-musees-de-france
  api: https://www.data.gouv.fr/api/1/datasets/liste-des-musees-de-france/
  terms: https://www.data.gouv.fr/pages/legal/licences/etalab-2.0/
family: registry
kinds: [art-museums, archaeology-museums, history-museums]
tier: regional
unit: { level: country, code: FR, name: France }
row:
  identity: "Identifiant Muséofile (M0369 is the musée de Montmartre)"
  wikidata_link: P539
  coordinates: all
  languages: [fr]
  signal: "the Musée de France appellation itself — granted under the Code du patrimoine, an editorial cut by the state; the thematic domain lives in the Muséofile base behind the list"
terms:
  licence: "Licence Ouverte / Open Licence 2.0"
  database_right: waived
  attribution: "Ministère de la Culture, Liste des Musées de France, last updated 2025-08-27"
  scraping: not-needed
access:
  mode: dump
  format: csv
  cadence: "punctual (data.gouv.fr); the register is updated at least once a year"
  volume: "1,217 rows, 281 kB (file of 2025-08-27)"
  rate: none
scorecard:
  date: 2026-09-06
  completeness: 2
  identity: 2
  coordinates: 2
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 13
  verdict: adoptable
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# Liste des Musées de France (Muséofile)

The official list of the museums carrying the *Musée de France* appellation under the Code du
patrimoine, published by the ministry on data.gouv.fr and drawn from Muséofile, the ministry's
directory of museums. Looked at on 2026-09-06 as the worked example of a national register
(`docs/tech/filling-a-kind.md` § 7.1).

**What was measured (2026-09-06).** The CSV named by the dataset's API holds 1,217 rows, every
one with latitude and longitude, 1,132 with a website. Columns: Identifiant Muséofile, région
administrative, département, commune, nom officiel du musée, date of the appellation decree,
address, lieu, postal code, telephone, URL, latitude, longitude, REF_Deps, geolocalisation.
No thematic column in this list — the domains (beaux-arts, histoire, archéologie …) are in the
Muséofile base the list is drawn from, which is what tells an art museum from a history museum.
Paris (département) holds 50 rows: the maison de Balzac (M1102), the musée Carnavalet (M1104),
the musée d'art moderne de la ville de Paris (M1101), the musée Zadkine (M1115), the Palais
Galliera (M1108), the musée de Montmartre (M0369) among them.

**Identity.** The Muséofile id is Wikidata's property P539: 1,363 items carry one, and 70 of
Paris's 236 museum items on Wikidata do — so most rows meet the world tier's places by an equal
item, and the rest by coordinates and name (ADR-0046 decision 2).

**Terms.** Licence Ouverte 2.0: free reuse including commercial, modification and
redistribution; attribution names the grantor and the date of the last update; compatible with
CC BY and ODC-BY. The database right is waived by the licence.

**What decides it for the regional tier of art museums.** The list is an enumeration with an
editorial cut built in (the label), so the tier's cut is the label plus the art domains of the
Muséofile base. The place that shows it: the musée Zadkine, a Musée de France no world line
reaches. Owed before `evaluated`: the Muséofile base's thematic domains read for the Paris
rows, and the canon of Paris art museums a person names, found and missed.
