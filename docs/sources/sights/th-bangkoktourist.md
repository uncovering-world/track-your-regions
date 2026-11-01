---
slug: th-bangkoktourist
name: "Bangkok Travel Guide (bangkoktourist.com)"
publisher: "bangkoktourist.com, a team of Bangkok residents; no legal entity named"
urls:
  home: https://www.bangkoktourist.com/
  dataset: none
  api: none
  terms: https://www.bangkoktourist.com/privacy/
family: curator
kinds: [places-of-worship, markets, neighbourhoods, monuments-and-memorials, squares-and-streets, parks-and-gardens, regional-food, notable-works, wellness, festivals-and-events]
tier: regional
unit: { level: city, code: TH, name: Bangkok }
row:
  identity: "the site's page per place (/<slug>/); no number"
  wikidata_link: none
  coordinates: none
  languages: [th]
  signal: "being on its top-ten list of places, on its three-day itinerary or having a page of its own"
terms:
  licence: "none named; the footer reserves all rights (สงวนลิขสิทธิ์) and no terms page is linked"
  database_right: unknown
  attribution: "bangkoktourist.com"
  agent: allowed
  agent_rests_on: "site-access.md, www.bangkoktourist.com, read 2026-11-01: robots.txt closes /go/ only, no terms page, privacy policy silent on automated reading"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "unknown: its pages carry no dates; the footer year is 2026"
  volume: "a top-ten list, a home-page itinerary, and a page per attraction (some twenty listed on the home page) plus two event pages"
  rate: none
scorecard:
  date: 2026-11-01
  completeness: unknown
  identity: 1
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: unknown
  total: unknown
  verdict: provisional
status: looked-at
issue: 2232
looked_at: 2026-11-01
---

# Bangkok Travel Guide (bangkoktourist.com)

A Thai-language guide to Bangkok's sights, "คู่มือท่องเที่ยวกรุงเทพ", written by what its about
page calls a team of Bangkok enthusiasts; no company, organisation or person is named, and it is
not the Bangkok Metropolitan Administration's Tourism Division, whose printed guides share the
name. Looked at on 2026-11-01 because the Bangkok survey read it as the source written from
inside the country, after the Tourism Authority of Thailand's site answered 403 to every page
([the access table](../site-access.md)).

**What it sorts its places into.** A top-ten list of must-visit places (the Grand Palace and Wat
Phra Kaew, Wat Arun, Wat Pho, Khao San Road, Rajadamnern Stadium, Yaowarat, ICONSIAM, Asiatique,
Siam Paragon and the Siam malls, Chatuchak), a three-day, two-night budget itinerary on the home
page, pages on two Chinese festivals (Chinese New Year, the Vegetarian Festival), and a page per
attraction, among them temples a foreign guide rarely names (Wat Pathum Khongkha, Wat Phichaiyat,
the Bang Luang mosque), the Pig Memorial and the Mae Nak shrine. A page is `/<slug>/` with a
text, pictures and directions by rail; the one read for the row, the Chinatown page, carries
streets, dishes and shrines by name and no coordinates.

**Terms ([the access table](../site-access.md), 2026-11-01).** `www.bangkoktourist.com`:
`allowed`. `robots.txt`: `User-agent: *` closes `/go/` only; `ia_archiver` is refused whole.
No terms page is linked; the footer reads "© ลิขสิทธิ์ 2026 bangkoktourist.com. สงวนลิขสิทธิ์.", and
the privacy policy at https://www.bangkoktourist.com/privacy/ covers personal data and cookies
with nothing on automated reading, copying or AI. `/.well-known/tdmrep.json` answers 404.

**What decides it.** Not decided: completeness against the city's canon is measured by the
Bangkok list, so the total is `unknown` and the verdict `provisional`. It is a resident's
selection with the regional tier's usual gaps, no number and no point per place, and in Thai
only. The top-ten list and the itinerary are the editorial cut.

**What the survey measured.** Five pages by fetch, one at a time: the home page, the top-ten
list, the Chinatown page, the about page and the privacy policy. The Bangkok survey of 2026-11-01
counted it on 52 of the 267 entries of `db/catalogue-coverage/expectations/bangkok.jsonl`: 39
places, 2 works, 6 activities, 2 events and 3 dishes. The kinds in the front matter are those
under which the survey filed two or more of the entries it is named on.
