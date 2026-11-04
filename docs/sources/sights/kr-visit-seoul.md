---
slug: kr-visit-seoul
name: "Visit Seoul"
publisher: "Seoul Tourism Organization (STO)"
urls:
  home: https://english.visitseoul.net/
  dataset: none
  api: none
  terms: https://www.sto.or.kr/english/privacy
family: tourism-board
kinds: [parks-and-gardens, neighbourhoods, markets, viewpoints, palaces-and-residences]
tier: regional
unit: { level: city, code: KR, name: Seoul }
row:
  identity: "the site's page per place (/attractions/<Name>/ENP<number>); the ENP number is the site's own"
  wikidata_link: none
  coordinates: unknown
  languages: [en, ko, ja, zh, ru, ms]
  signal: "the first page of a category listing sorted by the site's own recommendation, and the places its home page features"
terms:
  licence: "none named; the footer reads \"© 2026 Seoul Tourism Organization\" and links a privacy statement only"
  database_right: unknown
  attribution: "Seoul Tourism Organization (Visit Seoul)"
  agent: allowed
  agent_rests_on: "site-access.md, english.visitseoul.net, read 2026-11-04: robots.txt closes /member/, /admin/ and /search* only, no terms page linked, no usage signal"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "unknown: the home page carries current seasonal features (autumn 2026)"
  volume: "category listings of eight places a page (Attractions runs to 44 pages), a page per place, themed courses and articles"
  rate: none
scorecard:
  date: 2026-11-04
  completeness: unknown
  identity: 1
  coordinates: unknown
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: unknown
  total: unknown
  verdict: provisional
status: looked-at
issue: 2325
looked_at: 2026-11-04
---

# Visit Seoul

The official tourism site of the city of Seoul, published by the Seoul Tourism Organization, a
body of the Seoul Metropolitan Government, in English, Korean and five other languages. Looked at
on 2026-11-04 because the Seoul survey read it as the source written from inside the country
([the access table](../site-access.md)).

**What it sorts its places into.** Category listings — Attractions (filtered by landmark,
palaces, historical sites, galleries and museums), Nature, Entertainment, Shopping and
Restaurants — of eight places a page, sorted by default by the site's own recommendation, so the
first page of each is its editorial cut; a page per place under an `ENP` number; themed courses
("Must Visit Places", which on the day were itineraries such as a Seongsu course and a K-pop
course rather than single places); and articles on the home page (Bukhansan, Salgoji-gil, Naksan
Park, a night walk from Haebangchon to Gyeongnidan). The later pages of a listing are a directory
of every attraction and are not counted.

**Terms ([the access table](../site-access.md), 2026-11-04).** `english.visitseoul.net`:
`allowed`. `robots.txt`: one `User-agent: *` group closing `/member/`, `/admin/` and `/search*`,
the same file to the fetch tool and to an ordinary client. No terms page is linked; the footer
links the STO's privacy statement at https://www.sto.or.kr/english/privacy and nothing on
automated reading, copying or AI. `/.well-known/tdmrep.json` answers 404.

**What decides it.** Not decided: completeness against the city's canon is measured by the Seoul
list, so the total is `unknown` and the verdict `provisional`. The recommended first pages lean
to what is new or popular (Starfield Library, the Banpo Bridge fountain, the K-pop agencies'
buildings) beside the palaces.

**What the survey measured.** Six pages by fetch, one at a time: the home page, the Must Visit
Places page, and the first pages of Attractions, Nature, Entertainment and Shopping. The Seoul
survey of 2026-11-04 counted it on 30 of the 165 entries of
`db/catalogue-coverage/expectations/seoul.jsonl`: 29 places and 1 activity. The kinds in the
front matter are those under which the survey filed two or more of the entries it is named on.
