---
slug: au-concrete-playground
name: "Concrete Playground"
publisher: "Concrete Playground"
urls:
  home: https://concreteplayground.com/sydney
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [beaches-and-swimming, neighbourhoods, natural-landmarks, historic-hotels-and-restaurants, viewpoints, parks-and-gardens, hiking-trails-and-walks, national-parks-and-reserves, outdoor-activities, art-museums, towns-and-villages, architecture, historical-sites, landmarks, festivals-and-events, history-museums, world-heritage, entertainment-venues, science-and-nature-museums, on-site-activities, day-trips-and-itineraries, squares-and-streets, markets, zoos-and-aquariums, public-art, tours-and-cruises, historic-houses]
tier: regional
unit: { level: city, code: AU, name: Sydney }
row:
  identity: "none seen: a place is an item of a list article; the site also keeps a directory of venues"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being named in one of its list articles"
terms:
  licence: "none stated"
  database_right: not-asserted
  attribution: "Concrete Playground"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "older than two years: the article read dates from 2017, though the site publishes news daily"
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
  cadence: 0
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Concrete Playground

A city guide and news site; the pages read are its Sydney edition's, which the survey records as
written by residents. Looked at on 2026-10-02 because the Sydney survey read it as its guide
from inside the city.

**What it sorts its places into.** Sections (Food & Drink, Arts & Entertainment, Design & Style
and others), each with news, list articles under "Discover" and a "Directory" of venues. A place
is an item of a list article. The directory was not opened for this record, and the survey read
articles.

**Terms ([the access table](../site-access.md), 2026-10-02).** `concreteplayground.com`:
`allowed` (robots open; no terms linked). `robots.txt`: open (`*`: `Allow: /`; competition,
account and search paths disallowed). Terms: no terms page linked. No terms link on the home
page (Sydney: only a privacy policy; /terms answers 404).

**What decides it.** Identity 0, so the verdict is `curator-list`; the total is `unknown`
because the coordinates were not looked at. No terms page is linked: ask first. Its articles
age; the one read for this record is from 2017.

**What the survey measured.** Seventeen pages by fetch. The Sydney survey of 2026-10-02 counted
it on 197 of the 483 entries of `db/catalogue-coverage/expectations/sydney.jsonl` (by type:
place 169, activity 12, route 11, event 3, food 1, drink 1). On none of them is the surveyor's
own list the only other source. The kinds in the front matter are those under which the survey
filed two or more of the entries it is named on.
