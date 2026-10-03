---
slug: id-detik-bali
name: "detikBali and detikTravel"
publisher: detikcom
urls:
  home: https://www.detik.com/bali/
  dataset: none
  api: none
  terms: https://www.detik.com/copyright
family: commercial
kinds: [regional-food, towns-and-villages, festivals-and-events, beaches-and-swimming, natural-landmarks, places-of-worship, shows-and-performances, regional-drinks, markets, intangible-heritage, art-museums, cultural-landscapes, parks-and-gardens, public-art, history-museums, zoos-and-aquariums]
tier: regional
unit: { level: region, code: ID, name: Bali }
row:
  identity: "none: a place is an item of a list article; the article has a number in its address"
  wikidata_link: unknown
  coordinates: unknown
  languages: [id]
  signal: "being an item of one of its list articles"
terms:
  licence: "the publisher's copyright page: free use by individuals for reference and non-commercial purposes"
  database_right: not-asserted
  attribution: detikBali
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: a daily news site, by its own account; the survey kept no date of the articles it read"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# detikBali and detikTravel

The Bali edition of an Indonesian news site, in Indonesian, with its travel section; the survey
records it as written by a Bali newsroom. Looked at on 2026-10-02 because the Bali survey read
it in its second pass as its Indonesian-language source.

**What it sorts its places into.** The edition's menu: Berita, Sepakbola, Hukum & Kriminal,
Budaya, Wisata, Kuliner, Bisnis, Nusra, Bali Bungah. What the survey read are list articles
under Wisata, Kuliner and Budaya: so many places, so many dishes, so many ceremonies. Only the
front page was read for this record, so what a row carries is not known here.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.detik.com`: `allowed`
(copyright page lets individuals use the material for reference and non-commercial purposes).
`robots.txt`: open (`*`: `Allow: /`; Googlebot and Google-Extended have rules of their own).
Terms: allow reuse, at https://www.detik.com/copyright. Nothing on robots or automated access;
other use needs detikcom's permission and attribution. /disclaimer and /pedoman-media are silent
too. The clause, as the table has it: "Seluruh materi artikel/berita (teks, foto, video, logo)
yang terdapat dalam seluruh situs keluarga besar detikcom dilindungi undang-undang hak cipta.
Seluruh materi tersebut bebas dimanfaatkan oleh individu untuk keperluan referensi dan
non-komersial." `travel.detik.com`: `allowed` (as www.detik.com). `robots.txt`: open (`*`:
`Allow: /`). Terms: the same page as the host before. Footer, read for this record: "Copyright @
2026 detikcom. All right reserved".

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. The publisher's copyright page lets individuals use
its material for reference and without commerce, and asks its permission and a credit for
anything else: terms 1. No address to write to was read.

**What the survey measured.** Thirteen list articles by fetch, of places, temples, dishes,
drinks, dances, arts, villages and ceremonies; its calendar of every holy day of 2026 was not
counted, as a directory. The Bali survey of 2026-10-02 counted it on 88 of the 290 entries of
`db/catalogue-coverage/expectations/bali.jsonl` (by type: place 50, food 12, event 10, activity
9, drink 7). On 10 of them nothing else but the surveyor's own list names the entry. The kinds
in the front matter are those under which the survey filed two or more of the entries it is
named on.
