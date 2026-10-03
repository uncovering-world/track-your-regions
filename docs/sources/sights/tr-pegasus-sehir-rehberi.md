---
slug: tr-pegasus-sehir-rehberi
name: "Pegasus Şehir Rehberi (the city guide of Pegasus Airlines)"
publisher: "Pegasus Hava Taşımacılığı A.Ş. (Pendik, İstanbul)"
urls:
  home: https://www.flypgs.com/sehir-rehberi/istanbul-gezi-rehberi
  dataset: none
  api: none
  terms: none
family: commercial
kinds: [neighbourhoods, places-of-worship, historic-hotels-and-restaurants, palaces-and-castles, towns-and-villages, regional-food, parks-and-gardens, art-museums, architecture, archaeology, squares-and-streets, natural-landmarks, landmarks, markets, beaches-and-swimming, science-and-nature-museums, history-museums, notable-works, viewpoints, festivals-and-events, public-art]
tier: regional
unit: { level: country, code: TR, name: "Türkiye" }
row:
  identity: "none: a place is a heading inside a guide page"
  wikidata_link: none
  coordinates: none
  languages: [tr, en, de]
  signal: "being written up in the city's guide pages or the blog"
terms:
  licence: "none stated; robots.txt carries Content-Signal: search=yes, ai-input=yes, ai-train=yes"
  database_right: not-asserted
  attribution: Pegasus
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the page read carries no date"
  volume: "a guide page per city with sub-pages; 14 second-level and 20 third-level headings on the Istanbul page"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 0
  names: 2
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

# Pegasus Şehir Rehberi

The city guide a Turkish airline keeps on its own site, in Turkish with English and German
editions, and its blog. Looked at on 2026-10-02 because the Istanbul survey read it in its
second pass as its Turkish-language guide.

**What it sorts its places into.** A guide page per city with general information, a
step-by-step plan for the trip and ready-made itineraries ("İstanbul Hakkında Genel Bilgiler",
"İstanbul Seyahatinizi Adım Adım Planlayın", "İstanbul İçin Hazır Seyahat Planları"), and
sub-pages for where to eat and what to see. A place is a heading with a paragraph: no page, no
id, no map point on the page read.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.flypgs.com`: `allowed`
(robots carry `Content-Signal: search=yes, ai-input=yes, ai-train=yes`; home page answered 403
at the audit). `robots.txt`: open (`*`: `Allow: /`; PDF, search, feed and blog-author paths and
script files disallowed. /sehir-rehberi/, /gezi-rehberi/ and /blog/ articles are not
disallowed). Signal: robots.txt: `Content-Signal: search=yes, ai-input=yes, ai-train=yes`.
Signal: /llms.txt exists: "# Pegasus Airlines". Terms: not read. The home page answered 403 to
every reader at the audit, so its footer was not seen. The copy Istanbul saved earlier today
links a privacy notice only (/gizlilik). Footer of the guide page, read for this record: "©
2026, All Rights Reserved".

**What decides it.** Identity 0 and coordinates 0, so the verdict is `curator-list` whatever the
total of 6. No licence is stated: ask first. No address to write to was read.

**What the survey measured.** Eight pages by fetch, in Turkish: the Istanbul guide, where to
eat, places to see, a historical walk, and four blog articles. The Istanbul survey of 2026-10-02
counted it on 137 of the 266 entries of `db/catalogue-coverage/expectations/istanbul.jsonl` (by
type: place 119, food 9, activity 3, work 3, event 2, drink 1). On 11 of them nothing else but
the surveyor's own list names the entry. The kinds in the front matter are those under which the
survey filed two or more of the entries it is named on.
