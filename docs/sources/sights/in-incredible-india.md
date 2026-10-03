---
slug: in-incredible-india
name: "Incredible India"
publisher: "Ministry of Tourism, Government of India"
urls:
  home: https://www.incredibleindia.gov.in/en/delhi/delhi
  dataset: none
  api: none
  terms: https://www.incredibleindia.gov.in/en/terms-of-use
family: tourism-board
kinds: [markets, historic-hotels-and-restaurants, places-of-worship, parks-and-gardens, entertainment-venues, palaces-and-castles, neighbourhoods, public-art, art-museums, squares-and-streets, world-heritage, tombs-and-mausoleums, landmarks, archaeology, science-and-nature-museums, specialty-museums, famous-peoples-places]
tier: regional
unit: { level: country, code: IN, name: India }
row:
  identity: "the site's own page per place (/en/<state>/<city>/<slug>); no id exposed"
  wikidata_link: none
  coordinates: some
  languages: [en]
  signal: "being given a page or an article under the city's page"
terms:
  licence: "none; Terms of Use: no reproducing, publishing or displaying of any of the Content without prior written consent"
  database_right: not-asserted
  attribution: "Incredible India (Ministry of Tourism, Government of India)"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the page read carries no date"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 1
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 6
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Incredible India

The national tourism site, "designed, developed and maintained by Ministry of Tourism,
Government of India" (its Terms of Use). Looked at on 2026-10-02 because the Delhi survey read
its Delhi pages in the second pass.

**What it sorts its places into.** A page per city under its state (`/en/delhi/delhi`), with the
places of the city as pages beneath it (`/en/delhi/delhi/<slug>`) and articles on food, culture,
entertainment and wellness. The Delhi page, the one read for the row, carries map data with a
latitude and longitude in its markup; whether each place has its own point was not measured.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.incredibleindia.gov.in`:
`allowed` (terms silent on automated reading). `robots.txt`: open (`*`: `Allow: /`, one asset
folder disallowed). Terms: silent on automated reading, at
https://www.incredibleindia.gov.in/en/terms-of-use. Forbids to "sell, reproduce, publish,
distribute, […] or otherwise use any of the Content" without written consent; nothing on robots,
automated access or AI. The same page, read for this record: "Any other proposed use of the
material or any authorization is subject to the approval of the Ministry of Tourism." Footer: "©
Ministry of Tourism, Government of India."

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 6. The
terms are ask first, in writing; the Terms of Use say where applications for permission go, and
the address did not come through in the text read. The site has a contact page
(`/en/contact-us`).

**What the survey measured.** It could be read: the Delhi page and seven of its articles; "80
places to visit near Delhi", a directory, was not opened. The Delhi survey of 2026-10-02 counted
it on 87 of the 220 entries of `db/catalogue-coverage/expectations/delhi.jsonl` (by type: place
70, food 13, activity 3, event 1). On 6 of them nothing else but the surveyor's own list names
the entry. Places among those: Asola Bhatti Wildlife Sanctuary. The kinds in the front matter
are those under which the survey filed two or more of the entries it is named on.
