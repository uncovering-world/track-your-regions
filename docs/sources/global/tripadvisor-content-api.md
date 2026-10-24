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
  wikidata_link: P3134
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
issue: 1977
looked_at: 2026-10-25
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

**The Wikidata link (#1977, 2026-10-25).** Wikidata does link to Tripadvisor's location id, by
P3134. In the dump of 2026-10-19 the property is on 34,057 items. 31,981 of them have a
coordinate, and a Wikivoyage edition uses 38.8 % of those. Among them are 3,677 places of
worship, 1,432 art museums and 3,155 hotels. The statement is Wikidata's, under CC0. Reading it
uses nothing of the API, so the refusal above stands for the API while the presence of the id
on an item is available as a signal. `robots.txt` on www.tripadvisor.com disallows ClaudeBot
(read 2026-10-25), so the site itself is not read either.
