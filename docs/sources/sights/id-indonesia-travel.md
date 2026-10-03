---
slug: id-indonesia-travel
name: "Indonesia.Travel (Wonderful Indonesia)"
publisher: "Ministry of Tourism, Republic of Indonesia"
urls:
  home: https://www.indonesia.travel/
  dataset: none
  api: none
  terms: https://www.indonesia.travel/gb-en/terms-conditions/
family: tourism-board
kinds: [unknown]
tier: none
unit: { level: country, code: ID, name: Indonesia }
row:
  identity: "the site's own page per destination (/destination/<island group>/<province>/<slug>/); no id seen in the addresses"
  wikidata_link: none
  coordinates: unknown
  languages: [id, en, zh, fr, ja, nl, de, ar, ru, ko]
  signal: "being given a destination page or named in one of its articles"
terms:
  licence: "none; Terms & Conditions: no robot, spider, automatic device or manual process to monitor or copy pages without the Ministry's prior written permission"
  database_right: not-asserted
  attribution: "Ministry of Tourism, Republic of Indonesia"
  scraping: forbidden
access:
  mode: scrape
  format: html
  cadence: "unknown: no destination page was read for this record"
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: unknown
  identity: 0
  coordinates: unknown
  names: 2
  signal: 1
  terms: 0
  access: 1
  cadence: 0
  total: unknown
  verdict: veto
status: refused
issue: 1213
looked_at: 2026-10-02
---

# Indonesia.Travel

The Ministry of Tourism's site, the home of the Wonderful Indonesia campaign, with editions in
ten languages. Looked at on 2026-10-02: the Bali survey's first pass met 404 on two guessed
addresses, and its second pass read the site.

**What it sorts its places into.** Its About page: "Indonesia's wonders are presented through
five main categories: Nature, Culinary & Wellness, Arts & Heritage, Recreation & Leisure, and
Adventure." Destinations are pages under island group and province (`/destination/<island
group>/<province>/<slug>/`); beside them, travel ideas (articles) and events.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.indonesia.travel`: `refused`
(terms bar robots, automated access or mining, with no leave for an AI agent). `robots.txt`:
open (`User-agent: *` with no rule at all, then a sitemap line). Terms: bar automated access, at
https://www.indonesia.travel/gb-en/terms-conditions/. Under "Right of Access"; "effective on May
2018". The bar covers a manual process too. The clause, as the table has it: "You agree that you
will not use any device, software or routine to interfere or attempt to interfere with the
proper working of the websites, use any robot, spider, other automatic device, or manual process
to monitor or copy any pages within the Website or the Content without prior written permission
from the Ministry." The same page, read for this record before the table existed: "The Content
shall not be copied, reproduced, republished, uploaded, posted, transmitted, imitated or
otherwise distributed, whether in whole or in part, without the prior written permission of The
Ministry or the respective copyright owner." Three pages were fetched for this record with
`curl`, the home page, the terms and the About page; after the clause was read, nothing more
was.

**What decides it.** The access table: `refused`, on the site's own terms, which bar any robot,
automatic device or manual process that monitors or copies its pages without the Ministry's
written permission. Terms 0, so the verdict is `veto` and the status `refused`. Identity would
be 0 in any case. For another use the terms say to "write in to The Ministry"; the site has a
contact page, not read.

**What the survey measured.** The Bali survey's first pass met 404 on two guessed addresses; its
second read the Bali destination page in English and in Indonesian and eleven articles, and
named it on 100 entries. It was read before its terms were. Nothing of it counts: the surveys
withdrew every count taken from it, and this record carries no figure. The surveys withdrew, by
region: Bali: 100 counts.
