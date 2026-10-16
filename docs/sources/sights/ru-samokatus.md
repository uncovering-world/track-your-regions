---
slug: ru-samokatus
name: "Самокатус (samokatus.ru)"
publisher: "ООО «Самокатус»"
urls:
  home: https://samokatus.ru/moscow/
  dataset: none
  api: none
  terms: https://samokatus.ru/policy
family: commercial
kinds: [art-museums, squares-and-streets, history-museums, tours-and-cruises]
tier: regional
unit: { level: any }
row:
  identity: "a heading inside a city page; no id exposed"
  wikidata_link: none
  coordinates: none
  languages: [ru]
  signal: "being named on a city's page"
terms:
  licence: "none stated; the access table finds the policy page silent on automated reading"
  database_right: unknown
  attribution: "Самокатус"
  scraping: unknown
access:
  mode: scrape
  format: html
  cadence: "unknown: the page read carries no date"
  volume: "one page per city"
  rate: unknown
scorecard:
  date: 2026-10-16
  completeness: 0
  identity: 0
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 4
  verdict: curator-list
status: looked-at
issue: 1600
looked_at: 2026-10-16
---

# Самокатус

A Russian travel site written in Russia for independent travellers, with a page per city. The
Samarkand survey read its Samarkand page; this record was written on 2026-10-16 because the Moscow
survey read its Moscow page as a second guide from inside the country.

**What it sorts its places into.** One page per city: what to see, the museums, markets, food,
where to sleep and how to get around, as headings with paragraphs. No page per place and no map
point on the page read.

**Terms ([the access table](../site-access.md), 2026-10-02).** `samokatus.ru`: `allowed`
(closed paths not read). `robots.txt`: `*` allows `/` and closes `/trips/`, `/admin`, `/api` and a
feed path; the city guides are not closed. Terms: silent on automated reading, at
https://samokatus.ru/policy.

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total. The Moscow page is short: it names the main sights and little else, so its completeness is
scored 0.

**What the survey measured.** One page by fetch, in Russian: `/moscow/`. The Moscow survey of 2026-10-16 counted it on 18 of the 197 entries of `db/catalogue-coverage/expectations/moscow.jsonl`. The
kinds in the front matter are those under which the survey filed two or more of the entries it is
named on.
