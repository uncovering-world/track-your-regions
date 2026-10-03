---
slug: jp-japan-guide
name: japan-guide.com
publisher: japan-guide.com
urls:
  home: https://www.japan-guide.com/e/e2158.html
  dataset: none
  api: none
  terms: https://www.japan-guide.com/e/e441.html
family: commercial
kinds: [places-of-worship, parks-and-gardens, festivals-and-events, neighbourhoods, palaces-and-castles, markets, art-museums, regional-food, towns-and-villages, natural-landmarks, specialty-museums, regional-drinks, day-trips-and-itineraries, hiking-trails-and-walks, viewpoints, squares-and-streets, zoos-and-aquariums, regional-crafts]
tier: regional
unit: { level: country, code: JP, name: Japan }
row:
  identity: "a number per page in its address (/e/e<number>.html), attraction pages included"
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "the guide's own rating of an attraction, shown as dots in the city's listing"
terms:
  licence: "none; material may be downloaded and copied for personal, non-commercial use; no redistribution, and no reproduction without the publisher's written permission"
  database_right: reserved
  attribution: japan-guide.com
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the page shows \"Page last updated:\" with no date to a fetch"
  volume: "120 numbered pages linked from the Kyoto page"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 1
  coordinates: unknown
  names: 0
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# japan-guide.com

A travel guide to Japan in English; the survey records it as written in Japan by residents.
Looked at on 2026-10-02 because the Kyoto survey read it as its guide from inside the country.

**What it sorts its places into.** A page per city with "Top attractions", a listing by district
in which each attraction carries the guide's rating, "by interest", and guides to food,
shopping, museums, cherry blossom and autumn colour spots, and itineraries. Every page has a
number in its address (`/e/e2158.html` is Kyoto), an attraction's page included. The Kyoto page
read carries no Japanese names; no attraction page was opened.

**Terms ([the access table](../site-access.md), 2026-10-02).** `www.japan-guide.com`: `allowed`
(terms silent on automated reading). `robots.txt`: some paths closed (`*`: /local/ only). Terms:
silent on automated reading, at https://www.japan-guide.com/e/e441.html. "Web site users may
download and copy the material for personal, non-commercial use, without the right to resell,
redistribute (that includes publishing on a personal web site) or create derivative works
therefrom. No part of this web site may be reproduced without the written permission of the
publisher". Nothing on automated access.

**What decides it.** Not decided: the coordinates were not looked at, so the total is `unknown`
and the verdict `provisional`. It has what most guides lack, a number per place and a rating of
its own. The terms allow copying for personal, non-commercial use and forbid redistribution,
"that includes publishing on a personal web site": for a catalogue that shows what it holds, ask
first.

**What the survey measured.** Six pages by fetch: the Kyoto page with its rated listing, Nara,
Uji, and the Kyoto food, museum and shopping guides. The Kyoto survey of 2026-10-02 counted it
on 116 of the 246 entries of `db/catalogue-coverage/expectations/kyoto.jsonl` (by type: place
92, event 7, activity 4, route 4, food 4, drink 2, object 2, work 1). On none of them is the
surveyor's own list the only other source. The kinds in the front matter are those under which
the survey filed two or more of the entries it is named on.
