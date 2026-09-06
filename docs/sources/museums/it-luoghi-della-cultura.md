---
slug: it-luoghi-della-cultura
name: Luoghi della cultura (Cultural-ON DBUnico 2.0)
publisher: Ministero della Cultura
urls:
  home: https://cultura.gov.it/open-data-e-linked-data
  dataset: https://dati.cultura.gov.it/
  api: https://dati.cultura.gov.it/sparql
  terms: https://cultura.gov.it/open-data-e-linked-data
family: registry
kinds: [art-museums, archaeology-museums, history-museums]
tier: regional
unit: { level: country, code: IT, name: Italy }
row:
  identity: "a URI of its own in the ministry's linked data"
  wikidata_link: unknown
  coordinates: all
  languages: [it]
  signal: "a typology in eleven macro-categories (museum, archaeology, church, palace, castle, library, archive, monument, …) and the supervising authority; no cut of its own"
terms:
  licence: "CC BY 3.0"
  database_right: unknown
  attribution: "Ministero della Cultura, Luoghi della cultura (Cultural-ON DBUnico 2.0), CC BY 3.0 as described"
  scraping: not-needed
access:
  mode: api
  format: "SPARQL; RDF/XML, Turtle, JSON downloads"
  cadence: monthly
  volume: "6,603 visitable cultural sites (museums, libraries, archives, archaeological areas), as published"
  rate: unknown
scorecard:
  date: 2026-09-06
  completeness: unknown
  identity: unknown
  coordinates: unknown
  names: unknown
  signal: unknown
  terms: unknown
  access: unknown
  cadence: unknown
  total: unknown
  verdict: provisional
status: looked-at
issue: 799
looked_at: 2026-09-06
---

# Luoghi della cultura

The ministry's register of visitable cultural sites — museums, archaeological areas,
monuments, libraries, archives — published as linked open data under CC BY 3.0 and updated
monthly, with a normalised typology, address, province, coordinates, description and the
supervising authority for each site. Looked at on 2026-09-06 as the worked example of a typed,
coordinated, licensed register.

**What was measured (2026-09-06).** Nothing: `dati.cultura.gov.it`, `dati.beniculturali.it`
and `cultura.gov.it` timed out or refused the connection from two network vantage points that
day. Everything in the front matter above the scorecard — 6,603 sites, eleven macro-categories,
coordinates, CC BY 3.0, monthly updates through the SPARQL endpoints — is the ministry's own
description of the dataset as its pages and the national catalogue relay it, not a measurement,
which is why every criterion is `unknown` and the verdict `provisional` (§ 6.2): a scorecard
filled from a blurb adopts nothing. Owed before any verdict: a fetch that answers; then the
Florence count, the share of rows with a Wikidata link, the licence page quoted, and the canon
of Florence art museums found and missed by name.

**What it would decide, if it measures as described.** On paper the strongest candidate of the
registers looked at: typed (so the art museums would be a filter, not a guess), coordinated,
licensed, monthly. Until it answers, Florence's cut is Wikivoyage's thirty fully-itemed See
listings over Wikidata's fifty art museums (`docs/tech/filling-a-kind.md` § 7.6). The place
that would show it: the Museo Stibbert — 11 sitelinks, on the guide's list with its item, not
on the world's.
