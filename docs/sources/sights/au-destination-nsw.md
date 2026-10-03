---
slug: au-destination-nsw
name: "Sydney.com and Visit NSW (Destination NSW)"
publisher: "Destination NSW"
urls:
  home: https://www.sydney.com/
  dataset: none
  api: none
  terms: https://www.sydney.com/terms-of-use
family: tourism-board
kinds: [beaches-and-swimming, historic-hotels-and-restaurants, neighbourhoods, natural-landmarks, parks-and-gardens, markets, viewpoints, entertainment-venues, squares-and-streets, national-parks-and-reserves, art-museums, historic-houses, zoos-and-aquariums, architecture, science-and-nature-museums, history-museums, shops, towns-and-villages, historical-sites, sports-venues, world-heritage, landmarks, public-art, archaeology, bridges-and-engineering, palaces-and-castles, live-music-venues, farms-and-workshops, specialty-museums]
tier: regional
unit: { level: region, code: AU, name: "New South Wales" }
row:
  identity: "the site's page per attraction (/destinations/<region>/<area>/<suburb>/attractions/<slug>); no id seen in the addresses"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en, de, ja, ko, zh]
  signal: "being recommended in an article or on a destination page; the operator listings are a directory"
terms:
  licence: "none; terms of use (last updated 23 September 2021): the content may be used or reproduced for non-commercial personal use only"
  database_right: reserved
  attribution: "Destination NSW"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: the article read is dated 2024-10-22"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: unknown
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 1
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Sydney.com and Visit NSW

"The official tourism site for Destination NSW", the state's tourism body, on two hosts with one
design and one set of terms: `sydney.com` for the city and `visitnsw.com` for the state. The
survey counts them as one source, and this is one record. Looked at on 2026-10-02 because the
Sydney survey read it as the state's source.

**What it sorts its places into.** Articles (itineraries, "best of" pieces) and a tree of
destinations: region, area, suburb, and under a suburb its attractions, food and drink, each
with a page. A destination page of the state site sorts its things to do by kind (waterfalls and
swimming holes, lookouts, bushwalks, family activities, dining). The pages of single operators
are listings that businesses supply, a directory, and the survey did not read them. No
attraction page was opened for this record.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.sydney.com`: `allowed`
(terms silent on automated reading). `robots.txt`: open (`*`: Drupal defaults). Terms: silent on
automated reading, at https://www.sydney.com/terms-of-use. "The Content may only be used or
reproduced by you for non-commercial personal use" (fetch tool's quotation); last updated 23
September 2021. Nothing on automated access. `www.visitnsw.com`: `allowed` (terms silent on
automated reading). `robots.txt`: open (`*`: Drupal defaults). Terms: silent on automated
reading, at https://www.visitnsw.com/terms-of-use. "The Content may only be used or reproduced
by you for non-commercial personal use" (fetch tool's quotation); last updated 23 September
2021. Nothing on automated access.

**What decides it.** Identity 0 on the addresses seen, so the verdict is `curator-list`; the
total is `unknown` because the coordinates were not looked at. It named more of the survey's
list than any other source but Wikivoyage. The terms keep reuse to personal, non-commercial use:
ask first.

**What the survey measured.** Sixty-two pages of `sydney.com` that recommend and one of
`visitnsw.com`, by fetch. The Sydney survey of 2026-10-02 counted it on 387 of the 483 entries
of `db/catalogue-coverage/expectations/sydney.jsonl` (by type: place 324, activity 27, route 15,
event 13, food 4, work 3, drink 1). On 4 of them nothing else but the surveyor's own list names
the entry. The kinds in the front matter are those under which the survey filed two or more of
the entries it is named on.
