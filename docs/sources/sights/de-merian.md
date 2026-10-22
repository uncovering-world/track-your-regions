---
slug: de-merian
name: "Merian"
publisher: "Jahreszeiten Verlag GmbH (Merian)"
urls:
  home: https://www.merian.de/
  dataset: none
  api: none
  terms: https://www.merian.de/impressum
family: commercial
kinds: [art-museums, notable-works, architecture, history-museums, science-and-nature-museums, archaeology, historical-sites, city-gates-and-walls, public-art, towers, squares-and-streets, parks-and-gardens, beaches-and-swimming, natural-landmarks, places-of-worship, festivals-and-events]
tier: regional
unit: { level: country, code: DE, name: Germany }
row:
  identity: "none: places are named in the text of articles, with no page of their own"
  wikidata_link: none
  coordinates: none
  languages: [de]
  signal: "the editors' picks: ranked lists ('Die Top 10 Sehenswürdigkeiten', 'Die 15 besten Museen') and themed articles"
terms:
  licence: unknown
  database_right: unknown
  attribution: "MERIAN, named as the source"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "continuous: the Berlin articles read carry dates of the last two years"
  volume: "a destination page per city with a dozen linked articles"
  rate: unknown
scorecard:
  date: 2026-10-16
  completeness: unknown
  identity: 0
  coordinates: 0
  names: 2
  signal: 2
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1600
looked_at: 2026-10-16
---

# Merian

The travel magazine and guidebook series of Jahreszeiten Verlag in Hamburg, in German. Looked at
on 2026-10-16 because the Berlin survey read it as its German-language guide. It is written from
inside Germany, but it is a publisher's guide, and the survey counted visitBerlin as its source
from inside the country; this record is for the second German source it read.

**What it sorts its places into.** Destinations, each with a page that links its articles. Berlin's
links a dozen: the top ten sights, the fifteen best museums, swimming lakes, Christmas markets,
hotels, fine dining, neighbourhood walks led by residents. A place is named in an article's text
and has no page of its own. One page under `/mehr/merian-partner/` is a partner page of
visitBerlin, the city's tourism company, and was left unread: it is the board's selection under
Merian's name.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.merian.de`: `allowed`
(`robots.txt` allows Anthropic agents by name). Terms: silent on automated reading, at
https://www.merian.de/impressum. The verdict was taken from the table and not judged again.

**What decides it.** Identity and coordinates 0: a place is a name in a sentence. So the verdict
is `curator-list`: its ranked lists are an editorial cut a curator can read, not rows a sync can
take. The total is `unknown` until completeness is measured on the merged list.

**What the survey measured.** Four pages by fetch, one at a time: the Berlin page, the top ten
sights, the fifteen best museums and the Christmas markets. The Berlin survey of 2026-10-16 counted it on 50 of the 221 entries of `db/catalogue-coverage/expectations/berlin.jsonl`. The kinds in the front matter are those under which the survey filed two or more
of the entries it is named on.
