---
slug: wikimedia-commons-category-photos
name: Wikimedia Commons, the files of an item's category taken near the place
publisher: Wikimedia Foundation (the service); the files' uploaders (the pictures, each under its own licence)
urls:
  home: https://commons.wikimedia.org/
  dataset: https://commons.wikimedia.org/wiki/Commons:Geocoding
  api: https://commons.wikimedia.org/w/api.php?action=query&generator=categorymembers&gcmtype=file&prop=coordinates
  terms: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use
family: global
kinds: [any]
tier: world
unit: { level: any, code: none, name: "the world, asked one item's category at a time" }
row:
  identity: "the item's Commons category (P373); a file title and its camera position"
  wikidata_link: P373
  coordinates: most
  languages: [the uploader's]
  signal: "people photographed the place: files of its category whose camera stood within 1 km"
terms:
  licence: "per file; only the count of files is kept, no file and no picture"
  database_right: not-asserted
  attribution: "none needed for a count; a picture shown is credited from extmetadata as ever (ADR-0043)"
  agent: unknown
  agent_rests_on: "no line in site-access.md: not judged for an agent reading pages"
  program: allowed
  program_rests_on: "a documented API under its operator's rules (ADR-0148): the Commons Action API under Wikimedia's API rules; only counts are kept"
  model: none
access:
  mode: api
  format: "MediaWiki API, generator=categorymembers (files) with prop=coordinates, gcmlimit=max, read until 10 files taken there or to its end, at most 20,000 files"
  cadence: continuous
  volume: "per place: the Roman Baths' category 217 files, 98 within 1 km; Rungholt's 17, none (2026-10-20)"
  rate: "the run's MediaWiki transport: one request at a time with the run's pause, a descriptive User-Agent, retries on 429 and 5xx with Retry-After"
scorecard:
  date: 2026-10-20
  completeness: 1
  identity: 2
  coordinates: 2
  names: 0
  signal: 1
  terms: 2
  access: 2
  cadence: 2
  total: 12
  verdict: adoptable
status: adopted
issue: 1768
looked_at: 2026-10-20
---

# Wikimedia Commons, the photographs of a place

**Adopted as a witness of a place a visitor goes to (2026-10-20, #1768).** The maintainer decided
that day (#1718) that a place is one a visitor goes to when two independent witnesses of four say
so. This source is the photographs witness: at least 10 files of the item's Commons category taken
within 1 km of the place. A Commons file's primary coordinate is where the camera stood, so a
category of photographs taken there says people went there. Archaeology's source row
(`experience_sources` id 5) reads it through its readership door (`visit/commonsPhotos.ts`).

**What was measured (2026-10-20, #1756).** Over dry run 178's 41 door arrivals, the photographs
witness said yes for 14 of the 20 sites and none of the 9 places with nothing to see. The Roman
Baths' category holds 217 files, 98 of them taken within a kilometre; Rungholt's holds 17, none
taken there. Without it, two of the 20 sites fall short of two witnesses.

The `wikimedia-commons-geosearch` record is a different read of the same host: the files near a
point, whatever they show. This one reads only the files a person filed under the place.
