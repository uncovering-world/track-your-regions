---
slug: cn-visit-beijing
name: "Visit Beijing (visitbeijing.com.cn)"
publisher: "Beijing Municipal Bureau of Culture and Tourism"
urls:
  home: https://english.visitbeijing.com.cn/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [unknown]
tier: regional
unit: { level: city, code: CN-BJ, name: Beijing }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [en]
  signal: "being the title of one of its weekend routes (what still counts)"
terms:
  licence: "unknown: no terms page linked on either host"
  database_right: unknown
  attribution: unknown
  scraping: reserved
access:
  mode: scrape
  format: "html; the lists are drawn by script and show a fetch their first screen only"
  cadence: unknown
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: unknown
  coordinates: unknown
  names: unknown
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

# Visit Beijing

The city's tourism site, on two hosts that the access table judges apart. The English edition,
`english.visitbeijing.com.cn`, holds the articles a traveller would read and is refused: its
`robots.txt` closes every page to every agent. The lists (attractions, food, routes) are served
from `r.visitbeijing.com.cn`, whose `robots.txt` allows every agent. Looked at on 2026-10-02
because the Beijing survey read it as its source from a public body inside the country. No page
of either host was fetched for this record.

**Terms ([the access table](../site-access.md), 2026-10-02).** `r.visitbeijing.com.cn`:
`allowed` (robots allow every agent; no terms linked). `robots.txt`: open (The whole file:
`User-agent: *` / `Allow: /`). Terms: no terms page linked. No terms link on the home page.
`english.visitbeijing.com.cn`: `refused` (`robots.txt` disallows every agent). `robots.txt`:
disallows every agent (The whole file: `User-Agent: *` / `Disallow: /`). Terms: no terms page
linked. No terms link on the home page.

**What decides it.** Nothing was measured for the scorecard, so the verdict is `provisional` and
the status stays `looked-at`: one host is refused and the other allowed, and the allowed one is
what the four counts below stand on. The part worth having is on the refused host. The robots
line there is a reservation in the sense of `docs/tech/filling-a-kind.md` § 5: ask first. No
address to write to was read.

**What the survey measured.** On the refused host it read the first screen of the home page in
its first pass and 23 articles and a list in its second, before the robots line was read; the
102 counts taken there were withdrawn and nothing of them counts. On the allowed host it read
the titles of the list of weekend routes; the attraction, food and brand pages there are
directories and count for nothing. The Beijing survey of 2026-10-02 counted it on 4 of the 247
entries of `db/catalogue-coverage/expectations/beijing.jsonl` (by type: place 2, activity 1,
event 1). On none of them is the surveyor's own list the only other source.
