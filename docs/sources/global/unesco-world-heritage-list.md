---
slug: unesco-world-heritage-list
name: UNESCO's World Heritage List, the open dataset whc001
publisher: UNESCO World Heritage Centre, on UNESCO's open-data portal (Opendatasoft, now Huwise)
urls:
  home: https://data.unesco.org/explore/assets/whc001/
  dataset: https://data.unesco.org/explore/assets/whc001/
  api: https://data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/json
  terms: https://www.unesco.org/en/terms-use
family: registry
kinds: [world-heritage]
tier: world
unit: { level: any, code: none, name: "the World Heritage List, every property in every States Party" }
row:
  identity: "the property's number (id_no, 91, 1459) and each component's reference (components_list, 91quater-001)"
  wikidata_link: P757
  coordinates: most
  languages: [en, fr, es, ru, ar, zh]
  signal: "inscription on the World Heritage List, and whether the property is in danger"
terms:
  licence: "CC BY-SA 4.0"
  database_right: share-alike
  attribution: "UNESCO World Heritage Centre, World Heritage List (whc001), CC BY-SA 4.0"
  agent: allowed
  agent_rests_on: "site-access.md, data.unesco.org, read 2026-10-25; the line gives the reason"
  program: allowed
  program_rests_on: "a documented API under its operator's rules (ADR-0148): the whc001 export, CC BY-SA 4.0; the terms' bar on API clients yields to the licence"
  model: "a property's name, offered to Jev when a curator asks which source's name to keep; a component's name, rough point and why it is rough, in the point-hint question (#1913): inference, not the AI training the terms bar (§7(d)), and the licence covers it"
access:
  mode: api
  format: "JSON, Opendatasoft's Explore API v2.1 exports endpoint, with a select of the fields read"
  cadence: "irregular: inscriptions each July, and rewrites of the dataset's fields (the components list became JSON on 2026-10-20)"
  volume: "1,273 records, 3.7 MB with the fields the run selects (24 MB whole), measured 2026-08-21"
  rate: "10,000 calls a day for an anonymous client (x-ratelimit-limit, read 2026-08-21); the run makes one call"
scorecard:
  date: 2026-10-25
  completeness: 2
  identity: 2
  coordinates: 2
  names: 2
  signal: 1
  terms: 1
  access: 2
  cadence: 1
  total: 13
  verdict: hold
status: adopted
issue: 2000
looked_at: 2026-10-25
---

# UNESCO's World Heritage List, the open dataset whc001

The World Heritage List as UNESCO publishes it for programs: one row per property with its
number, names in six languages, category, criteria, States Parties, danger listing, area and
components, each component with its reference and coordinate. The UNESCO run (`experience_sources`
id 1, World Heritage Sites) reads it whole in one call to the exports endpoint
(`backend/src/services/sync/unescoApi.ts`).

**The access.** The portal runs Opendatasoft's Explore API v2.1. Its `robots.txt`, read on
2026-10-25, is the platform's default file:

```text
User-agent: *
Disallow: /api/
Disallow: /explore/dataset/*/download

User-agent: Googlebot
Allow: /api/
Disallow: /api/explore/v2*/exports/
```

The same groups are served line for line by `public.opendatasoft.com`, the vendor's own hub, and
four other Opendatasoft portals. That `*` group does not decide the run's call (ADR-0148
decision 1), for three reasons, all read on 2026-10-25:
- the dataset page's own schema.org markup lists the exports endpoint (`/exports/json`) as a
  `DataDownload` of the dataset;
- the portal's navigation links an API console (`/api-console/explore/v2.1/`);
- Opendatasoft's Explore API documentation (help.opendatasoft.com/apis/ods-explore-v2/, read
  2026-10-25) sends a whole-dataset client to the exports endpoint: "If you need more results,
  please use the /exports endpoint." A public portal needs no key: "you don't need an account or
  an API key".

The run identifies itself (`UNESCO_USER_AGENT`, `userAgent({ bot: true })`), asks only for the
fields it reads, waits on a `429` or a `502` and retries within its budget, and follows no links.
No group names `TrackYourRegionsBot`, and the file carries no usage signal. A change to either
changes this verdict (ADR-0148 decision 5). The run asks the file before its call
(`assertRobotsAllow`), as every bot client does.

The survey's agent is the other half: it may not fetch the dataset's `/api/` paths as pages, and
reads the list through the catalogue's own rows instead (`lookup unesco`, #1981).

**The licence.** The dataset page's markup declares
`"license": "https://creativecommons.org/licenses/by-sa/4.0/"` (read 2026-10-25).

**The terms.** The portal's terms link goes to UNESCO's Terms of Use, last updated 15 September
2026, read from the copy a survey saved on 2026-10-02. They name an "application programming
interface (API) client" among automated systems. §7(c) bars bulk download "by any Automated
System", and §7(e) bars circumventing "robots.txt directives, rate limits or authentication". All
of §7 opens "Except where expressly permitted under Section 5, under an applicable license or
under a specific authorization". §5 adds: "Nothing in these Terms restricts rights expressly
granted by a Creative Commons license." The run rests on that licence carve-out. The terms' one clause on AI use, §7(d), bars "AI
training", which they define as training, fine-tuning or calibrating a system. Offering a
property's name to Jev when a curator asks which source's name to keep, or a component's name and
rough point in the point-hint question (#1913), is inference, not training, and the licence covers
it in any case. The
maintainer decided on 2026-10-25 that the run goes on as it is (#2000). A written confirmation
from UNESCO, at the address §9 gives, would close the remaining doubt. Asking is the maintainer's
call, and has not been made.

**What a no would change.** The run would read the list another way: the World Heritage Site ID
(P757) on Wikidata's items, from the local subset, which the run already reads for pictures and
articles. It would have to keep the same properties and components.

**The scorecard.**
- **Completeness 2.** The list itself, every property.
- **Identity 2.** UNESCO's own number, and a Wikidata item through P757 on nearly every property.
- **Coordinates 2.** A point or components on all but two records of the 2026-10-20 update: 868
  and 1567 came with neither, and the run files them (`UnplaceableRecord`, #1814). The score
  counts the rows the run keeps, each of which has a coordinate, while `row.coordinates` says
  `most` of what the dataset sends.
- **Names 2.** Six languages.
- **Signal 1.** Being inscribed is an editorial cut.
- **Terms 1.** Share-alike.
- **Access 2.** An API.
- **Cadence 1.** Irregular.

The verdict is `hold`, because the terms score 1 for share-alike (`docs/tech/filling-a-kind.md`
§ 6.2, *Hold*; the share-alike question itself is § 5). The run predates the register, and the catalogue stores more than facts: every property's
short description, CC BY-SA text, shown with no credit. #2010 asks what the catalogue owes for it.

**Status.** `adopted`: the UNESCO run reads it (World Heritage Sites, `experience_sources` id 1).
It holds `adopted` beside a `hold` verdict because the run predates the register
(`docs/sources/README.md` § Status). The maintainer decided on 2026-10-25 to answer the
share-alike as ADR-0059 does for OpenStreetMap, and #2010 builds that. This record was written by
#2000, after ADR-0148.
