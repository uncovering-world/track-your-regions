---
slug: et-visit-ethiopia
name: "Visit Ethiopia"
publisher: "not named on the pages read; the survey records it as Ethiopian Tourism, the contact address is info@mot.gov.et, and the footer reads 'Powered By Bekur'"
urls:
  home: https://visitethiopia.et/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [natural-landmarks, places-of-worship, festivals-and-events, regional-food, archaeology, history-museums, public-art, parks-and-gardens, world-heritage, towns-and-villages, palaces-and-castles]
tier: regional
unit: { level: country, code: ET, name: Ethiopia }
row:
  identity: "the site's page per 'space' (/space/<slug>) and a numeric data-id on each card of the listing"
  wikidata_link: none
  coordinates: some
  languages: [en]
  signal: "being one of the 67 'spaces' under Destinations, some marked Featured"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Visit Ethiopia"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages carry no date"
  volume: "67 spaces, 15 to a page"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 1
  coordinates: 1
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 6
  verdict: not-adoptable
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Visit Ethiopia

The national tourism site at `visitethiopia.et`, built on a booking platform: its places are
"spaces" beside hotels, tours and cars, each with a price field and a review score. Looked at on
2026-10-02 because the Addis Ababa survey read it as its source from inside the country.

**What it sorts its places into.** Destinations (`/space`) lists 67 spaces, 15 to a page, with
filters for Attractions (UNESCO World Heritage Sites, National Parks and Public Parks are the
three shown), Space Type, Destination Type and Amenities, and a map view. Each space is filed
under one of six routes: Addis Ababa and Its Surroundings; Eastern Ethiopia and the Bale
Mountains; The Afar Triangle; The Historic North and the Simien Mountains; The Rift Valley and
the Cultural Mosaic of the South; Western Ethiopia – Renowned for Lush Nature and Coffee. Things
to do are four pages: Nature Experience, Cultural Experience, Outdoor and Adventure, Research
and Educational Travel. The one place page read, Unity Park, carries a description, opening
hours, its attraction types and a point on a map (9.0363, 38.7519).

**Terms ([the access table](../site-access.md), 2026-10-02).** `visitethiopia.et`: `allowed`
(robots open; terms link is empty). `robots.txt`: open (`*`: `Disallow:` (empty)). Terms: no
terms page linked. The footer shows "Terms and Privacy Policy" as a link with an empty address.
Footer, read for this record: "© 2025 Powered By Bekur. All rights reserved".

**What decides it.** The total is 6 and the verdict `not-adoptable`. It has what the family
usually lacks, a number per place and a point on the row read, and it loses on names (English
only, where the city bureau's own site runs in English, Amharic and Oromo), on terms (no
licence, so ask first) and on cadence (no date anywhere). Whether every space carries a point
was not measured: one was opened. The address to write to: info@mot.gov.et.

**What the survey measured.** It could be read: the home page, the five pages of `/space`, the
events page, the cultural-experience page and ten destination pages; the regional index page
answered 500, and `visitethiopia.travel`, the older address, redirects to an unrelated site. The
Addis Ababa survey of 2026-10-02 counted it on 51 of the 117 entries of
`db/catalogue-coverage/expectations/addis-ababa.jsonl` (by type: place 34, event 5, food 5,
activity 4, drink 1, object 1, route 1). On 4 of them nothing else but the surveyor's own list
names the entry. Places among those: Adwa Victory Memorial; Jemma River gorge; Washa Mikael
rock-hewn church. The kinds in the front matter are those under which the survey filed two or
more of the entries it is named on.
