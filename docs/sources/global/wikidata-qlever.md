---
slug: wikidata-qlever
name: Wikidata, through the QLever wikidata mirror
publisher: Wikidata contributors (data); University of Freiburg, Chair of Algorithms and Data Structures (the endpoint)
urls:
  home: https://www.wikidata.org/
  dataset: https://qlever.dev/wikidata
  api: https://qlever.dev/api/wikidata
  terms: https://github.com/ad-freiburg/qlever/wiki/Usage-and-privacy-information-for-the-QLever-SPARQL-endpoints
family: global
kinds: [world-heritage]
tier: world
unit: { level: any, code: none, name: "the world, asked a few dozen areas at a time" }
row:
  identity: "a Wikidata item id (Q-number), stable"
  wikidata_link: itself
  coordinates: all
  languages: [none]
  signal: "what the item is an instance of (P31), that it carries no World Heritage reference of its own (no P757), and whether a class is a kind of settlement through the class tree (P279*)"
terms:
  licence: "CC0 1.0 (Wikidata's data)"
  database_right: waived
  attribution: none
  scraping: not-needed
access:
  mode: api
  format: "SPARQL over QLever's index of a Wikidata dump, JSON results"
  cadence: "the mirror's index is rebuilt from Wikidata's dumps; it trails the live data by days"
  volume: "the component-item search's near rule: the coordinates of the classes a site's resolved components are of, around about 1,300 areas, 25 areas a question; then which of the candidates and of the classes are settlements, through the class tree, up to 400 items or classes a question (#1272)"
  rate: "no published numeric limit; the usage page asks a heavy user to run their own endpoint. This connector asks one question at a time in the process, holds the next back for as long as the last took and never under a second, retries a timeout or a 5xx once, and never retries a refusal"
scorecard:
  date: 2026-10-09
  completeness: 2
  identity: 2
  coordinates: 2
  names: 0
  signal: 2
  terms: 2
  access: 2
  cadence: 1
  total: 13
  verdict: adoptable
status: adopted
issue: 1272
looked_at: 2026-10-09
---

# Wikidata through the QLever wikidata mirror

The near rule of the component-item search (#1272) asks Wikidata for every item of a class standing near a thousand World Heritage components. It finds an item for each component that no item records the UNESCO reference of. The Wikidata Query Service could not answer that question within its limits. On 2026-10-09 a pass paced at the service's own published rate drew 8 server or gateway errors, 3 timeouts and a 429 by its 500th of 1,292 areas, and a fresh run that morning drew a 429 on its first query (#1307). The same question about four areas took 18 s on the query service and 0.43 s on this mirror. The mirror found 27 items where the query service found 25.

This record is for that question and for the one that follows it — which of the candidates, and which of the classes a site may search by, are settlements, asked of the class tree (P31/P279*, `settlementsAmong`) up to 400 items or classes a question, because a list of classes cannot keep up with Wikidata's — and is not a second door to Wikidata at large. The part rule's queries, the classes of resolved components and every sync still ask the query service. The labels of the candidates come from Wikidata's own API (`wbgetentities`). The lasting route for bulk reads of Wikidata is a local subset of the weekly dump (#1312), which would retire this connector too.

**The QLever usage and privacy page** is linked above and was read on 2026-10-09. It is the project's own wiki, written for `qlever.cs.uni-freiburg.de`, the host that now redirects to `qlever.dev`. There are no formal terms of use and no published numeric rate limit. Under *Usage information*: "The current timeout is at least 600s. If you are a heavy user, we encourage you to set up a SPARQL endpoint on your own machine." Under *Privacy information*: "We currently store standard Apache logs (containing IP addresses), which are deleted after a week. We only look at these logs when necessary, for example, when there is a very large number of queries coming from the same IP address."

`https://qlever.dev/robots.txt` answers 404 and `https://qlever.cs.uni-freiburg.de/robots.txt` redirects to it (checked 2026-10-09), so no path is closed (RFC 9309 § 2.3.1). Neither the site's front page nor the QLever documentation states anything further about the public endpoints.

**What the connector does in answer** (`backend/src/services/sync/qleverWikidata.ts`):
- it asks one question at a time across the whole process;
- it holds the next question back for at least as long as the last one took, never under a second;
- it sends the project's `User-Agent` with the bot marker;
- it retries a timeout or a 5xx once and then hands the caller a smaller question to ask;
- it stops at any refusal.

A full pass asks the mirror about 80 questions — 52 for the 1,292 areas of 2026-10-09 and about 30 for the settlements among the candidates and the classes — out of the 334 the pass sends in all, the rest being the labels read from Wikidata's own API and the part and class questions the query service still answers. It is started by an admin from the panel, not a recurring job.

**The data is Wikidata's**, CC0, so nothing is owed in attribution and no database right is asserted. The index trails the live data by the age of the dump it was built from. A component's candidate is a proposal a curator answers (ADR-0046), so a day's lag costs at most one candidate the next pass finds.

**Scorecard notes.**
- **Names: 0.** The connector asks for no labels; the candidates' names come from `wbgetentities`.
- **Cadence: 1.** The mirror trails the live data.
- **Signal: 2.** It is the classes and the missing World Heritage reference the rule reads.
