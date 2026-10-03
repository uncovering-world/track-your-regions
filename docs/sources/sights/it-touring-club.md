---
slug: it-touring-club
name: "Touring Club Italiano"
publisher: "Fondazione Touring Club Italiano"
urls:
  home: https://www.touringclub.it/
  dataset: none
  api: none
  terms: https://www.touringclub.it/termini-e-condizioni
family: association
kinds: [places-of-worship, archaeology, squares-and-streets, notable-works, neighbourhoods, public-art, art-museums, parks-and-gardens]
tier: regional
unit: { level: country, code: IT, name: Italy }
row:
  identity: "none seen: a destination's list of sights is drawn by script and was not read"
  wikidata_link: unknown
  coordinates: unknown
  languages: [it]
  signal: "the club's own picks: a destination's 'Da non perdere', its 'Aperti per Voi' places, its articles"
terms:
  licence: "none; terms and conditions: use of the content needs a written request and must not be for profit"
  database_right: reserved
  attribution: "Touring Club Italiano"
  scraping: permitted
access:
  mode: scrape
  format: "html; the list of sights of a destination is drawn by script"
  cadence: "irregular: the Rome page was modified 2024-02-19"
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
  cadence: 1
  total: unknown
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Touring Club Italiano

The site of the Italian touring club, a foundation with members, whose menu names its own
programmes ("Aperti per Voi", "Bandiere Arancioni") and its publications. Looked at on
2026-10-02 because the Rome survey read it as a second Italian-language source. It is filed as
`association`: it is neither a public body nor a firm.

**What it sorts its places into.** Destinations, events and news. A destination's page (Rome:
"cosa vedere, dove dormire, dove mangiare") gives a prose introduction and "Da non perdere", two
picks; the list of sights under it is drawn by script and its sitemap lists none, so the survey
could not read it and this record did not try. Beside it, articles, found by the survey through
one search of the site that named nothing.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.touringclub.it`: `allowed`
(terms silent on automated reading). `robots.txt`: open (`*`: `Allow: /`, ten query parameters
disallowed). Terms: silent on automated reading, at
https://www.touringclub.it/termini-e-condizioni. Use of the content needs a written request and
must not be for profit; nothing on robots, automated access or mining.
`inviaggio.touringclub.it`: `allowed` (as www.touringclub.it). `robots.txt`: open (The same file
as www.touringclub.it). Terms: the same page as the host before.

**What decides it.** Identity 0 on what could be read, so the verdict is `curator-list`; the
total is `unknown` because the coordinates were not looked at. The list that matters, the club's
sights per destination, is the part a fetch does not see: it wants a browser before it can be
judged. The terms ask for a written request and no profit: ask first.

**What the survey measured.** The Rome page (its prose and its two picks) and five articles; the
club's "Roma Guida Visual" PDF carries a no-copy flag and was not read. The Rome survey of
2026-10-02 counted it on 36 of the 353 entries of
`db/catalogue-coverage/expectations/rome.jsonl` (by type: place 30, work 4, drink 1, activity
1). On none of them is the surveyor's own list the only other source. The kinds in the front
matter are those under which the survey filed two or more of the entries it is named on.
