---
slug: uz-gazeta-uz
name: Gazeta.uz
publisher: "OOO \"Gazeta News\" (Tashkent), a private news publication"
urls:
  home: https://www.gazeta.uz/ru/2025/08/15/food-guide-samarkand/
  dataset: none
  api: none
  terms: https://www.gazeta.uz/ru/terms/
family: commercial
kinds: [regional-food]
tier: regional
unit: { level: country, code: UZ, name: Uzbekistan }
row:
  identity: "none: a place is a name inside one article"
  wikidata_link: none
  coordinates: some
  languages: [ru, uz, en]
  signal: "being named by the newsroom's own natives of the city"
terms:
  licence: "none; the site's terms of use of materials: any use only with the editors' prior written permission, quotation up to 30% with a hyperlink"
  database_right: not-asserted
  attribution: "Gazeta.uz, with a hyperlink to the page quoted"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "irregular: one guide article, dated 2025-08-15, on a daily news site"
  volume: "one article for Samarkand"
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
  cadence: 1
  total: 7
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Gazeta.uz

A private news site in Tashkent. What the Samarkand survey read, in its second pass, is one
article of it: a food guide to Samarkand of 15 August 2025, in Russian, whose lead says who
speaks: «Уроженцы города, работающие в редакции, рассказали, где и что едят самаркандцы»
(natives of the city who work in the newsroom tell where and what the city eats). Looked at on
2026-10-02 as a source written inside the country that is neither a board nor a guide.

**What it sorts its places into.** Nothing: it is an article. Places to eat are named in the
running text, and the page carries nine links to Yandex Maps.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.gazeta.uz`: `allowed` (terms
restrict reuse of material; silent on automated reading). `robots.txt`: open (`*` disallows
admin, click-tracking, search and query strings). Terms: silent on automated reading, at
https://www.gazeta.uz/ru/terms/. Quotation of up to 30% of a text is allowed with a hyperlink.
Nothing on robots, automated access or AI: the clause quoted is about reuse, not about reading.
The clause, as the table has it: "1.1. Воспроизводство, копирование, тиражирование,
распространение и иное использование информации с Сайта «Gazeta» возможно только с
предварительного письменного разрешения редакции." The same page, read for this record:
quotation is allowed "в объеме не более 30% от оригинального текста при условии обязательной
гиперссылки на Сайт"; requests go to info@gazeta.uz, and "Отсутствие ответа … в течение 2
рабочих дней означает отказ в получении разрешения" (no answer in two working days is a no).

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 7. An
article is read once by a curator; it is not a list anyone would sync.

**What the survey measured.** The article was read by fetch. The Samarkand survey of 2026-10-02
counted it on 8 of the 94 entries of `db/catalogue-coverage/expectations/samarkand.jsonl` (by
type: food 8). On none of them is the surveyor's own list the only other source. The kinds in
the front matter are those under which the survey filed two or more of the entries it is named
on.
