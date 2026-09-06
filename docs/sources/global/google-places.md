---
slug: google-places
name: Google Places API
publisher: Google
urls:
  home: https://developers.google.com/maps/documentation/places/web-service
  dataset: none
  api: https://places.googleapis.com/
  terms: https://cloud.google.com/maps-platform/terms
family: commercial
kinds: [any]
tier: none
unit: { level: any, code: none, name: any }
row:
  identity: "the place id (the one thing that may be cached)"
  wikidata_link: none
  coordinates: all
  languages: [many]
  signal: "ratings and review counts"
terms:
  licence: "Google Maps Platform Terms of Service"
  database_right: reserved
  attribution: "required, on a Google map"
  scraping: forbidden
access:
  mode: api
  format: json
  cadence: continuous
  volume: unbounded
  rate: "billed per request"
scorecard:
  date: 2026-09-04
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
looked_at: 2026-09-04
---

# Google Places

Refused on terms, for both tiers and for curator screens alike (`docs/tech/filling-a-kind.md`
§ 5, § 7.5), on the reading of the Maps Platform Terms of Service made on 2026-09-04:
§ 3.2.3(e) "No Use With Non-Google Maps" forbids displaying or using Places content on a
non-Google map; § 3.2.3(c)(iv) forbids using latitude/longitude from the API as input for
point-in-polygon analysis; § 3.2.3(b) forbids caching Google Maps Content beyond what the
service-specific terms allow, which is the place id. The product's map is MapLibre and its
placement is point-in-polygon, so this is not an enrichment declined but a source excluded.
The scorecard's 13 is what makes the record worth keeping: everything but the terms is there,
and the terms are a veto.
