---
slug: id-bali-provincial-tourism-office
name: "Dinas Pariwisata Provinsi Bali (Bali Government Tourism Office)"
publisher: "Pemerintah Provinsi Bali, Dinas Pariwisata"
urls:
  home: https://disparda.baliprov.go.id/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [places-of-worship, beaches-and-swimming, towns-and-villages, natural-landmarks, palaces-and-castles, public-art, cultural-landscapes, parks-and-gardens, archaeology]
tier: regional
unit: { level: region, code: ID, name: Bali }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [id]
  signal: "being a featured attraction on one of its per-regency pages (the survey's reading)"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Dinas Pariwisata Provinsi Bali"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: a news item of 2026-09-25 on the home page"
  volume: "nine per-regency pages of featured attractions, 2 to 12 on each, by the survey's count"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: unknown
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Bali provincial tourism office

The site of the province's tourism office, in Indonesian. Looked at on 2026-10-02 because the
Bali survey read it in its second pass as the island's own public source.

**What it is.** An office's site first: its menu is the office's profile, its tasks, its service
standards, and "Data Kepariwisataan", yearly statistics and directory books for download. The
pages a traveller wants, the featured attractions per regency, were found by the survey and not
from the home page read for this record, so what a row carries is `unknown` here. The office
also runs Love Bali (`lovebali.baliprov.go.id`), which its home page calls a tourism monitoring
system.

**Terms ([the access table](../site-access.md), 2026-10-02).** `disparda.baliprov.go.id`:
`allowed` (robots open; no terms linked). `robots.txt`: open (`*`: `Disallow:` (empty)). Terms:
no terms page linked. The footer links a privacy policy only (/kebijakan-privasi); that page
showed the fetch tool a cookie banner and no policy text. Bali's survey read it with `curl` and
reports no clause on robots, scraping or AI. Footer, read for this record: "©2026 Pemerintah
Provinsi Bali. All right reserved."

**What decides it.** Nothing yet: identity and coordinates were not looked at, so the verdict is
`provisional`. No licence is stated: ask first, at infotourism@baliprov.go.id (the footer's
address).

**What the survey measured.** It could be read by fetch: nine per-regency pages of featured
attractions (Badung 12 and a second page, Gianyar 6, Karangasem 9, Buleleng 5, Bangli 6,
Denpasar 2, Jembrana 5, Tabanan 5; Klungkung empty). The province's list of all 505 attractions,
a PDF, was not opened, and its tourism-village lists, the Love Bali listings and the events
calendar were counted for nothing, as directories. The Bali survey of 2026-10-02 counted it on
42 of the 290 entries of `db/catalogue-coverage/expectations/bali.jsonl` (by type: place 42). On
2 of them nothing else but the surveyor's own list names the entry. Places among those: Nungnung
Waterfall; Tukad Cepung Waterfall. The kinds in the front matter are those under which the
survey filed two or more of the entries it is named on.
