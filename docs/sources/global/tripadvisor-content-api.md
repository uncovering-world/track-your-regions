---
slug: tripadvisor-content-api
name: Tripadvisor Content API
publisher: Tripadvisor
urls:
  home: https://www.tripadvisor.com/developers
  dataset: none
  api: https://api.content.tripadvisor.com/
  terms: https://tripadvisor-content-api.readme.io/reference/api-master-terms-new
family: commercial
kinds: [any]
tier: none
unit: { level: any, code: none, name: any }
row:
  identity: "the location id (the one thing that may be cached)"
  wikidata_link: none
  coordinates: all
  languages: [many]
  signal: "ratings, rankings and review counts"
terms:
  licence: "Tripadvisor Content API Master Terms"
  database_right: reserved
  attribution: "a Mark on every use (§ 3.4.2), a link back (§ 3.4.6), logos served from Tripadvisor"
  scraping: forbidden
access:
  mode: api
  format: json
  cadence: continuous
  volume: unbounded
  rate: "billed monthly against a budget"
scorecard:
  date: 2026-09-06
  completeness: 2
  identity: 1
  coordinates: 2
  names: 2
  signal: 2
  terms: 0
  access: 2
  cadence: 2
  total: 13
  verdict: veto
status: refused
issue: 799
looked_at: 2026-09-06
---

# Tripadvisor Content API

Refused on terms (`docs/tech/filling-a-kind.md` § 5, § 7.5), on the Master Terms read on
2026-09-06: § 3.4.3 permits caching only as the Caching Policy allows, and the policy allows
nothing but the location id; § 3.4.4(iv) forbids commingling or integrating Licensed Content
with any third-party content; § 3.5.2(c) forbids editing, transforming or adapting it; § 3.1.2
limits use to display through the customer's own site to end users; § 3.1.3 forbids model
training and allows retrieval-augmented grounding for internal testing only; displays must be
non-indexable. Storing rows, combining them with a register's and placing them in regions is
everything the catalogue does, so the API is out for both tiers. A guidebook's or a review
site's editorial list remains what a curator reads before writing their own.
