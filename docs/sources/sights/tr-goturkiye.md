---
slug: tr-goturkiye
name: "GoTürkiye"
publisher: "Türkiye Tourism Promotion and Development Agency (TGA)"
urls:
  home: https://goturkiye.com/
  dataset: none
  api: none
  terms: none
family: tourism-board
kinds: [unknown]
tier: none
unit: { level: country, code: TR, name: "Türkiye" }
row:
  identity: unknown
  wikidata_link: unknown
  coordinates: unknown
  languages: [unknown]
  signal: "being named on one of its Istanbul pages (the survey's reading)"
terms:
  licence: "unknown: no terms page linked"
  database_right: unknown
  attribution: unknown
  scraping: reserved
access:
  mode: scrape
  format: html
  cadence: unknown
  volume: unknown
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: unknown
  identity: unknown
  coordinates: unknown
  names: unknown
  signal: 1
  terms: unknown
  access: unknown
  cadence: 0
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# GoTürkiye

The national tourism portal. Looked at on 2026-10-02 because the Istanbul survey read it as one
of its two sources from public bodies inside the country.

**Terms ([the access table](../site-access.md), 2026-10-02).** `goturkiye.com`: `refused`
(answered a 403 challenge page when it was read). `robots.txt`: allows Anthropic agents by name
(Comment above the AI groups: "# AI Bot Erişimi" (AI bot access); GPTBot, ChatGPT-User,
ClaudeBot, PerplexityBot and Google-Extended each have `Allow: /`. `*` disallows login, /admin/
and /api/). Signal: robots.txt comment above the AI groups: "# AI Bot Erişimi" (AI bot access).
Terms: no terms page linked. The footer links a privacy text and a cookie policy only; the fetch
tool read the privacy text: data protection only. This record's own two requests on 2026-10-02,
the home page and `robots.txt` with `curl`, were answered 403 with a challenge page ("Just a
moment...") as well.

**What decides it.** Nothing of it is read today: the access table refuses the host because it
answered the surveys' fetch with a 403 challenge page, and reading it with another client is a
workaround the access rules rule out. No terms were read, so the terms are `unknown`, the
verdict `provisional` and the status `looked-at`: the refusal is of one day's reading, not of a
licence. At another reading `robots.txt` was served and named `ClaudeBot` with `Allow: /` under
the comment "AI Bot Erişimi" (AI bot access), so a reading that is served the pages judges the
site again.

**What the survey measured.** The Istanbul survey's first pass read nine pages by fetch and
named it on 61 entries. The counts were withdrawn when the host was found answering 403 with a
challenge page. Nothing of it counts, and this record carries no figure. The surveys withdrew,
by region: Istanbul: 61 counts.
