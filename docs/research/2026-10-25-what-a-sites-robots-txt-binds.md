# What a site's robots.txt binds: crawlers, API clients and AI agents (2026-10-25)

The research #2003 asked for, after #2000 asked whether the UNESCO run may call
`data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/json`, a path the portal's
`robots.txt` closes to `User-agent: *`. The question: what does a site's `robots.txt` restrict, is
it established practice that it binds a scheduled program calling a documented public API, and
what do the standards, the operators and the practitioners say? Sections (a)–(d) read the
authorities, the agreement between them, a recommended split, and the sites `site-access.md`
holds. The last section reads what practitioners write.

**Method.** Every quote is under 15 words. A quote marked
*(fetch tool)* came through a page-fetching summariser, which quotes from the page. A quote marked
*(read directly)* comes from the raw file, fetched with curl and the neutral User-Agent
`robots-research/1.0`. No request header carried a personal name or e-mail address. No URL under
`data.unesco.org/api/` or `/explore/dataset/*/download` was fetched, and no page of a host
`docs/sources/site-access.md` refuses was read. One request to the portal's terms link was
redirected to `www.unesco.org/en/terms-use`, a refused host, and answered `403 Forbidden` with no
content. UNESCO's terms are quoted from the copy a coverage survey saved on 2026-10-02, which says
"Last update: 15 September 2026".

**What it does not show.** No operator was asked. The reading of Opendatasoft's default file is an
inference from the file, and no court has ruled on whether a licence carve-out in terms of use
reaches the access method.

---

## (a) What each authority says

### 1. RFC 9309, the Robots Exclusion Protocol (IETF, Proposed Standard, September 2022)

- **Scope.** The Abstract says the protocol lets service owners control access to their content "by automatic clients known as crawlers." Source: https://datatracker.ietf.org/doc/html/rfc9309 *(fetch tool)*. §1 defines crawlers as automated clients that "recursively traverse links", such as search engines building an index. It names a browser as a different kind of client. The rules are written as obligations on crawlers: "Crawlers set their own name, which is called a product token" (§2.2.1).
- **Status of the rules.** §1 says: "These rules are not a form of access authorization." §3 adds that REP "is not a substitute for valid content security measures."
- **Other clients.** The RFC says nothing about clients that are not crawlers, API clients included. It neither extends the rules to them nor exempts them. It addresses crawlers and only defines crawlers.
- **Reading.** The RFC covers automated clients that discover URLs by following links. A scheduled job that calls one fixed, documented endpoint is outside its stated scope. It is also not clearly excluded, because the RFC's general wording is "automatic clients".

### 2. Google Search Central

- **Purpose.** robots.txt is used to "manage crawler traffic to your site". It "is not a mechanism for keeping a web page out of Google". Source: https://developers.google.com/search/docs/crawling-indexing/robots/intro *(fetch tool)*. Google also notes that some crawlers may not support the rules: compliance is voluntary.
- **User-triggered fetchers.** "Because the fetch was requested by a user, these fetchers generally ignore robots.txt rules." Source: https://developers.google.com/search/docs/crawling-indexing/google-user-triggered-fetchers *(fetch tool)*. The fetchers named include Feedfetcher, Google Site Verifier, Google Read Aloud, Gemini Notebook (formerly Google-NotebookLM), Google-Agent and Google Publisher Center. Google says the list "is not exhaustive".
- **Reading.** The largest crawler operator ties robots.txt to *crawling*: discovering and fetching content on its own initiative for indexing. It openly exempts fetches made at a user's request, its own AI agent (Google-Agent) among them. A feed reader polling one known feed URL is Google's own example of a client robots.txt does not govern. That case is close to a scheduled job polling one known export URL.

### 3. Opendatasoft (now Huwise) and data.unesco.org

- **The robots.txt is the platform's default template, not a decision by UNESCO.** Fetched directly today, the `robots.txt` files of `data.unesco.org`, `public.opendatasoft.com` (the vendor's own public hub), `data.opendatasoft.com`, `opendata.paris.fr`, `data.economie.gouv.fr` and `data.iledefrance.fr` hold the same groups line for line. Each has `User-agent: *` with `Disallow: /api/` and `Disallow: /static/`, then `User-agent: Googlebot` with `Allow: /api/` and `Disallow: /api/explore/v2*/exports/`. Only the `Sitemap` line and two trailing Googlebot lines differ. One Opendatasoft-hosted portal, `opendata.agenceore.fr`, replaces the template with `Allow: /` and a `Content-Signal` line, which shows the template is configurable per portal. *(read directly)*
- **Why it exists.** No Opendatasoft or Huwise document explaining the template could be found. Searches of help.opendatasoft.com, userguide.huwise.com and the open web returned nothing. The file shows its own purpose, though:
  - It disallows `/static/`, which holds the JavaScript and CSS that every browser visit to the portal loads.
  - It lets Googlebot into `/api/`, which the portal's JavaScript pages call to render, but keeps it out of `/exports/`, the heavy whole-dataset downloads.

  That shape fits crawl-budget and index management: keep search engines from following API and download links into an endless URL space, while letting Google render the pages. It does not fit a ban on API clients, since the same vendor documents those clients (next point). This is an inference from the file. No published statement says it.
- **The Explore API is documented for programmatic use, anonymous use included.** From https://help.opendatasoft.com/apis/ods-explore-v2/ (now served as Huwise's documentation), *(read directly)*:
  - Getting Started fetches records from a public portal: "you don't need an account or an API key."
  - The page states that the exports endpoint has no limitations, unlike the records endpoint. The records endpoint's `limit` parameter says: "If you need more results, please use the /exports endpoint."
  - Authenticated users "benefit from extended quotas for API calls", so anonymous callers get the base quota. Every endpoint documents a `429 Too many requests` answer.
  - No published per-day number was found in the docs. The repo's own measurement (comment in `backend/src/services/sync/unescoApi.ts`, read 2026-08-21) records the portal's headers: `x-ratelimit-limit: 10000` calls a day, anonymous.
- **The portal invites the call the project makes.**
  - The portal's main navigation has an "API" entry linking to `https://data.unesco.org/api-console/explore/v2.1/`. That path is not under `/api/`.
  - The dataset page `https://data.unesco.org/explore/assets/whc001/` (where `/explore/dataset/whc001/information/` redirects) carries schema.org `Dataset` markup with `"license": "https://creativecommons.org/licenses/by-sa/4.0/"`.
  - That markup also has a `distribution` list of `DataDownload` entries whose `contentUrl` values are `.../datasets/whc001/exports/csv`, `/exports/json`, `/exports/xlsx` and `/exports/geojson`. The JSON one is the endpoint `unescoApi.ts` calls, which adds a `select` parameter naming the fields it reads. *(read directly)*
- **UNESCO's Terms of Use are stricter than robots.txt, and they name API clients.** The portal's "Terms and conditions" link redirects to `www.unesco.org/en/terms-use`. The terms apply to every "Site", defined as "any … website, platform, database, portal … subdomain". From the 2026-10-02 copy:
  - "Automated System" means any robot, crawler, scraper, bot, script, "application programming interface (API) client" or other automated means.
  - §7(c) prohibits bulk download "by any Automated System", except ordinary search indexing and real-time AI retrieval as §5 permits.
  - §7(e) prohibits circumventing "robots.txt directives, rate limits or authentication".
  - §8 reserves TDM and automated extraction, "in machine-readable form" including "robots.txt files and content signals".
  - All of §7 opens "Except where expressly permitted under Section 5, under an applicable license or under a specific authorization". §5 says: "Nothing in these Terms restricts rights expressly granted by a Creative Commons license." Source: https://www.unesco.org/en/terms-use *(read from the saved copy)*.
  - §5 also permits "retrieval of individual Materials by an Artificial Intelligence System" to answer a specific user query. It requires naming UNESCO with a link, keeping nothing beyond the response, and no bulk extraction. It would allow an agent's single-page reading of `whc.unesco.org` and `ich.unesco.org`, but both hosts' `robots.txt` now names `ClaudeBot` under `Disallow: /`, so `site-access.md` refuses them (2026-10-24 and 2026-10-25): the survey's ground rules refuse a site whose `robots.txt` disallows any Anthropic agent by name, not only the one that fetches.
  - §9 says use beyond §5 or a licence "requires prior written authorisation" and gives a contact address for requests.

### 4. Practice, standards bodies and law

- **HTTP and API client libraries do not consult robots.txt. Crawler frameworks do.**
  - GNU Wget, the classic downloader, honours robots.txt only in recursive mode: "Because of that, Wget honors RES when downloading recursively." The reason given is that recursion "can download large parts of the site without the user's intervention." Source: https://www.gnu.org/software/wget/manual/html_node/Robot-Exclusion.html *(fetch tool)*.
  - Scrapy, a crawler framework, turns the check on by default: "If enabled, Scrapy will respect robots.txt policies." Source: https://docs.scrapy.org/en/latest/topics/settings.html *(fetch tool)*.
  - The R packages `polite` and `robotstxt` are built for scraping. `robotstxt` describes itself as a "'Webbot'/'Spider'/'Crawler' Permissions Checker" (https://github.com/ropensci/robotstxt, *read directly*).
  - The READMEs of `requests` (Python HTTP), `ckanapi` (CKAN client) and `sodapy` (Socrata client), and Opendatasoft's own `ods-cookbook` of API recipes, do not mention robots.txt (grep for "robots", 0 hits each). This is the documentation's silence, not an audit of their source code.
- **W3C, Data on the Web Best Practices (Recommendation, 2017).** Best Practice 23, "Make data available through an API", gives as its intended outcome that developers "will have programmatic access to the data for use in their own applications." Source: https://www.w3.org/TR/dwbp/ *(read directly)*. The document never mentions robots.txt. Its model is that publishing an API is the invitation for programmatic clients.
- **Other open-data portals scope their robots.txt narrowly** *(read directly)*. NYC Open Data (Socrata) disallows only `/api/odata/` and `/api/collocate*`. data.gouv.fr disallows a few CSV and redirect API paths. data.europa.eu disallows only RSS feeds. catalog.data.gov disallows nothing for `*`. So a blanket `Disallow: /api/` is a platform choice, not a sector norm.
- **No authoritative guidance was found** from the W3C, IETF, Open Data Institute or a data.gov-type portal that *extends* robots.txt to API clients. None was found that explicitly *exempts* them either. The silence is the finding.
- **IETF AIPREF.**
  - draft-ietf-aipref-attach-05 (19 August 2026) adds a `Content-Usage` rule to robots.txt and an HTTP header. It separates the two functions: "Acquisition relies on Allow/Disallow rules; usage preference relies on Content-Usage rules." Source: https://datatracker.ietf.org/doc/draft-ietf-aipref-attach/ *(fetch tool)*. Its §2 says any client may use preferences attached to a response, not only crawlers.
  - draft-ietf-aipref-vocab-08 (14 September 2026) says "Preferences are not a security mechanism" and defines `train-ai`, `ai-use` and `search`. Source: https://datatracker.ietf.org/doc/draft-ietf-aipref-vocab/. Both are drafts. The vocabulary draft's own banner says its contents do not yet reflect working-group consensus.
  - Upshot: the IETF direction is that Allow/Disallow governs what a crawler fetches, while a separate, client-neutral signal says how fetched content may be used.
- **US law.**
  - In *Ziff Davis v. OpenAI* (S.D.N.Y., 15 December 2025), Judge Stein dismissed the DMCA §1201 claim and held that robots.txt directives "are merely requests", not a technological measure that controls access. Source: https://blog.ericgoldman.org/archives/2025/12/are-robots-txt-instructions-legally-binding-ziff-davis-v-openai.htm *(fetch tool; quoting the opinion as reported)*.
  - Goldman stresses the ruling only decides §1201. Contract (terms of service), trespass to chattels and CFAA theories remain open.
- **EU law.**
  - DSM Directive 2019/790 art. 4(3) makes the commercial TDM exception subject to the rightholder not having reserved it "in an appropriate manner, such as machine-readable means" for online content. Source: https://www.legislation.gov.uk/eudr/2019/790/article/4 *(fetch tool, opening words only)*.
  - In *Kneschke v. LAION*, the Hanseatic Higher Regional Court (OLG Hamburg, 5 U 104/24, reported 11 December 2025) held that a reservation written only in natural language did not prevent the mining. Source: https://heise.de/-11111575 *(fetch tool)*. It did not rule on robots.txt. A further appeal to the BGH was admitted.
  - The EU GPAI Code of Practice (copyright chapter) commits AI-model signatories to honour robots.txt (RFC 9309) as a TDM reservation *when they crawl*. This is per secondary summaries; the Code itself was not read here.
  - Net: in the EU, robots.txt is increasingly treated as a machine-readable *TDM reservation* for crawling and training. That bears on whether an exception is available. It does not bear on use the rightholder has *licensed*: CC BY-SA 4.0 licenses reproduction and sui generis database rights outright, so no exception is needed.
- **Anthropic's own commitment** (relevant to the survey half): "Anthropic's Bots respect "do not crawl" signals by honoring industry standard directives in robots.txt." This covers Claude-User, the user-directed retriever. Source: https://support.claude.com/en/articles/8896518 *(fetch tool)*. Unlike Google, Anthropic makes no exemption for user-triggered fetches.

### 5. Wikimedia: a site whose robots.txt and API rules differ

- **robots.txt.** `en.wikipedia.org/robots.txt`, served identically for `en.wikivoyage.org`, `commons.wikimedia.org` and `www.wikidata.org`, has a `User-agent: *` group with `Disallow: /w/` and `Disallow: /api/`. The only exceptions are `Allow: /w/api.php?action=mobileview&`, `/w/load.php?`, `/api/rest_v1/?doc` and the REST sitemap. So `/w/api.php`, the Action API, is closed to `*`. Its comment explains the intent: "Friendly, low-speed bots are welcome viewing article pages, but not dynamically-generated pages please." *(read directly)*
- **API rules.**
  - API:Etiquette says: "API requests to Wikimedia wikis must include a meaningful User-Agent header." It asks for serial requests and `maxlag`, and never mentions robots.txt. Source: https://www.mediawiki.org/wiki/API:Etiquette *(fetch tool)*.
  - The User-Agent policy addresses "scripts (bots)" calling `api.php`. It asks them to consider including "bot", and warns that clients without an informative User-Agent "may be blocked without notice". Source: https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy *(fetch tool)*.
  - The Wikitech Robot policy (last edited 16 March 2026) gives numbers for unauthenticated Action API clients: concurrency 1, under 5 requests a second. Source: https://wikitech.wikimedia.org/wiki/Robot_policy *(fetch tool)*. The same policy's general rules also say to honour every directive in robots.txt. Read literally, that robots.txt closes the very `/w/api.php` the API rules then meter. The only coherent reading is the one the robots.txt comment gives: the Disallow lines are aimed at crawlers wandering into dynamic pages, and the API sections govern API clients.
- **WDQS and OSM have the same pattern.**
  - `query.wikidata.org/robots.txt` has `Disallow: /sparql`. The WDQS User Manual nevertheless documents that same endpoint for programmatic queries, with limits (60 s runtime, `429` throttling, 5 parallel queries per IP) and a User-Agent requirement. Source: https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual.
  - `overpass-api.de/robots.txt` has `Disallow: /api/`, but its documentation sets about 10,000 requests and 1 GB a day per user. Source: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html.
  - `nominatim.openstreetmap.org/robots.txt` disallows `/search`, `/reverse` and `/lookup`. The OSMF policy says "We are in principle happy for the public API to be used" at 1 request a second at most, with an identifying User-Agent. Source: https://operations.osmfoundation.org/policies/nominatim/.

---

## (b) Where the sources agree and disagree

**They agree on these points.**

1. robots.txt is a voluntary convention for **crawlers**, not access control. The RFC, Google, the IETF drafts and the SDNY court all say so.
2. Its purpose is **managing crawl traffic and indexing**: Google's documentation, the Wikimedia comment, and Wget's recursive-only rule.
3. Client tooling bears this out: **downloaders and HTTP or API client libraries do not consult it. Crawler frameworks and scraping kits do.**
4. Publishers who run public APIs govern those APIs with **their own documentation, quotas and User-Agent rules**, and routinely leave a blanket `Disallow` over the same paths for `*`. This holds for Wikimedia (Action API, WDQS), OSM (Overpass, Nominatim) and Opendatasoft (exports). The project already depends on each of these.

**They disagree, or leave things open, on these.**

1. **RFC 9309's wording.** "Automatic clients known as crawlers" defines crawlers by recursion, but it does not *exclude* other automated clients. A strict reader can say that any unattended program is an "automatic client".
2. **Wikimedia's Robot policy** says to honour every robots.txt directive while also metering the API that robots.txt closes. It is internally inconsistent if read literally.
3. **User-triggered agents.** Google exempts them from robots.txt. Anthropic does not.
4. **Terms of service can turn robots.txt into a contract term.** UNESCO's §7(e) forbids circumventing "robots.txt directives" and names "API client" among Automated Systems. Ziff Davis treats ignoring robots.txt as not "circumvention", but only for the DMCA. A contract would be read on its own words. The UNESCO terms also yield to "an applicable license", and the dataset carries CC BY-SA 4.0 with its export URLs published as the distribution. These two clauses point in opposite directions. Whether the licence carve-out reaches the *access method* (an automated client on `/api/`) or only the *use* of the material is not settled by any source found.
5. **In the EU**, robots.txt may count as a machine-readable TDM reservation. That matters only where the project relies on the TDM exception, not where it holds a licence.

---

## (c) Recommended policy split

### Scheduled programmatic runs against a documented API (sync jobs, dump builds, the `lookup` command)

**Rule.** A run may call an endpoint when **all** of the following hold:

1. **The operator documents the endpoint for programmatic use.** This means API documentation, a published distribution URL (schema.org `DataDownload`, DCAT), an API console, or a usage policy that sets limits for it. Example: data.unesco.org's `exports/json`, declared on the dataset's own page.
2. **The data's licence or the terms permit the use the project makes.** This is checked per source in `docs/sources/`, as today.
3. **The terms do not bar automated or API clients**, or, if they do, an applicable licence or a written authorisation expressly covers the use.
4. **The run keeps the operator's published limits.** It identifies itself (`TrackYourRegionsBot/<version> (contact)`, as `userAgent({ bot: true })` already does), honours `429` and `Retry-After`, uses the bulk route the operator prefers, and calls a fixed, small set of URLs with no link-following.

A run that fetches HTML pages, or calls an endpoint the operator does not document for scripts, meets none of this and is a crawler: it follows the `robots.txt` group naming its token, or `*` where none does.

Under this rule, robots.txt Allow/Disallow lines in a `User-agent: *` group, or a group naming another client, do **not** decide whether a documented API is used. They are written for crawlers, and every operator in the evidence governs its API separately. Three robots.txt signals **must** be honoured under this rule. No run reads `robots.txt` today, so honouring them needs a check of its own:

- a group naming the project's own product token, `TrackYourRegionsBot` (that is addressed to us);
- a `Content-Usage` (AIPREF) or `Content-Signal` usage preference that covers the project's use;
- a TDM reservation where the project relies on the TDM exception rather than a licence.

**Reasoning.**

- It matches the RFC's stated scope, Google's practice, Wget, the IETF's acquisition-versus-usage split and W3C DWBP's invitation model.
- It is the only rule consistent with what the project already does. The sync clients call `query.wikidata.org/sparql`, `*/w/api.php` on Wikidata, Commons, Wikipedia and Wikivoyage, `overpass-api.de/api/interpreter` and `nominatim.openstreetmap.org/search`, and every one of those paths is disallowed to `*`. Reading robots.txt as binding API clients would stop nearly every source run, Wikidata first. The present practice has never been written down.

**Record.** Each source's register record (`docs/sources/…`) states what its robots.txt says for the endpoint, why it does not decide (it is a crawler group, and the operator documents the API at a cited clause), and the limits kept. When a robots.txt names our token, adds a usage signal, or reserves TDM where the run relies on the exception, that is a change of verdict.

**Residual risk.**

- **Operational.** An operator who did mean the Disallow for API clients can block the User-Agent or IP. The bot User-Agent with a contact makes that a conversation rather than a silent ban.
- **Contractual, where terms fold robots.txt into a binding clause.** UNESCO §7(e) does this. For **UNESCO specifically**, the case for the current run is strong but not airtight:
  - the dataset is CC BY-SA 4.0;
  - the publisher's own markup offers the export endpoint as the dataset's download;
  - the platform's documentation sends whole-dataset clients to `/exports`;
  - one call per run sits far inside the 10,000-call daily quota;
  - §5 and §7 yield to an applicable licence.

  The counter-reading is that §7(c) and §7(e) govern the access method regardless of the licence. **Recommendation: keep the run, which rests on the licence carve-out, and close the gap by writing to UNESCO at the §9 address.** Ask for confirmation that scheduled anonymous export of `whc001` under its CC BY-SA licence is welcome, and record the answer in the source's register record. If UNESCO says no, the run moves to the fallback, the World Heritage list through Wikidata P757 ("World Heritage Site ID", already read for pictures).
- **EU TDM.** It is negligible where the project holds a licence. Where it relies only on the exception, it treats a robots.txt Disallow or `ai-train=no` as a reservation, as `docs/tech/filling-a-kind.md` § 5 already does for Museumsportal Berlin.

### An AI agent reading web pages (coverage surveys)

**Rule.** Keep today's ground rules unchanged: robots.txt decides whether a page is read, together with the terms.

**Reasoning.**

- An agent that searches, follows links and fetches pages it chose is, functionally, a crawler. That is RFC 9309's core case.
- Anthropic, whose fetcher the survey uses, commits its agents to honour robots.txt with no user-triggered exemption.
- Many publishers' terms (`site-access.md`) bar AI use outright.
- The survey reads a few pages per site, so refusals cost little. A survey also needs several independent sources, not any particular one.

**One clarification to write down.** When the agent runs the project's `lookup` command (Wikivoyage, Wikidata), that is the *programmatic* half. It is a fixed API endpoint with a bot User-Agent, under Wikimedia's API rules. The Wikivoyage lines in `site-access.md` should therefore say that `/w/` is closed to crawlers and that the Action API is read under API:Etiquette and the Robot policy's API rules. Today they say "closed paths not read" next to "through the API", but the API itself sits on the closed path `/w/`.

**Residual risk.** Low. Some readable material is forgone, which is the cost the ground rules already accept.

---

## (d) The host table: refusals and restrictions that rest on robots.txt

"Rests on robots.txt" means the line's *What decides it* cites `robots.txt`, whether disallowed or unreachable. Hosts refused on terms, a 403 or a challenge are left out. "Terms also bar" marks lines where the terms would refuse the site anyway, so robots.txt is not the *only* ground. "API" means a public, documented API for the content the survey wanted, as far as could be established without fetching refused hosts.

### Refused

| Host | robots.txt ground | Terms also bar? | Documented API the project reads or could read | Does the documentation invite programmatic use? | What the proposed policy changes |
|---|---|---|---|---|---|
| `www.broadsheet.com.au` | disallows Anthropic agents | yes (automated access, mining, AI) | none known | — | nothing |
| `www.cntraveler.com` | disallows Anthropic agents | terms not read | none known (Condé Nast publishes no content API) | — | nothing |
| `www.culture.ru` | robots.txt unreachable | not read | possibly a Ministry of Culture open-data portal, not verified | not verified | nothing for page reading. If a documented open-data API exists, it is judged as a source on its own documentation and terms |
| `daily.afisha.ru` | disallows every agent | not read | none known | — | nothing |
| `discover.moscow` | disallows `anthropic-ai` | not read | none known | — | nothing |
| `elpais.com` | disallows Anthropic agents | not read | none known | — | nothing |
| `english.visitbeijing.com.cn` | disallows every agent | no terms page | none known | — | nothing |
| `lahabana.com` | robots.txt unreachable | not read | none known | — | nothing |
| `www.lonelyplanet.de` | disallows Anthropic agents | yes (mining, AI) | none | — | nothing |
| `www.marcopolo.de` | disallows Anthropic agents | silent | none | — | nothing; robots.txt alone decides, and stays deciding for page reading |
| `www.mos.ru` | disallows `anthropic-ai` | not read | Moscow's open-data portal (`data.mos.ru`, a different host) is widely reported to offer an API; not verified here | not verified | nothing for `www.mos.ru`. `data.mos.ru` could be judged as a source under the programmatic rule |
| `russia.travel` | robots.txt unreachable | not read | none known | — | nothing |
| `russpass.ru` | disallows `anthropic-ai` | not read | none known | — | nothing |
| `www.smh.com.au` | disallows Anthropic agents | not read | none | — | nothing |
| `theculturetrip.com` | disallows Anthropic agents | not read | none | — | nothing |
| `travel.kompas.com` | disallows Anthropic agents | yes (automated access, mining, AI) | none | — | nothing |
| `www.traveler.es` | disallows Anthropic agents | not read | none | — | nothing |
| `www.traveller.com.au` | redirects to `www.smh.com.au/traveller`, which disallows Anthropic agents | not read | none | — | nothing |
| `www.unesco.org` | disallows Anthropic agents | no: the terms *permit* single-page AI retrieval, so robots.txt alone refuses | UNESCO's data is offered through `data.unesco.org`, which the project already reads (`whc001` export) | yes: the dataset page declares the export URLs as its downloads, the portal links an API console, and the Huwise docs send whole-dataset clients to `/exports` | nothing for the agent's page reading. It confirms the UNESCO sync on the programmatic side, subject to the terms caveat in (c) |
| `zanzibartourism.go.tz` | robots.txt unreachable | not read | none known | — | nothing |
| `whc.unesco.org` | disallows Anthropic agents (`ClaudeBot` under `Disallow: /`, 2026-10-24) | yes (mining, automated access, AI use, save §5's single-page retrieval) | the World Heritage data comes through `data.unesco.org`'s `whc001` export, which the UNESCO run reads | yes (see `www.unesco.org` above) | nothing for page reading. The survey reads the list off the run's rows (`lookup unesco`) |
| `ich.unesco.org` | disallows Anthropic agents (`ClaudeBot` under `Disallow: /`, 2026-10-25) | yes (as `whc.unesco.org`) | none known | — | nothing |

### Allowed with "closed paths not read"

These lines restrict a site only by robots.txt. The guide sites in this group have no public content API: `www.101viajes.com`, `www.afisha.ru`, `www.australia.com`, `www.chinahighlights.com`, `elcomercio.pe`, `www.insightguides.com`, `www.iwanowski.de`, `www.japan-guide.com`, `www.japan.travel`, `lastsecond.ir`, `www.nationalparks.nsw.gov.au`, `samokatus.ru`, `www.the-village.ru`, `www.travel365.it`, `www.tutu.ru`, `um.mos.ru`, `www.visitberlin.de`, `web.cusco.gob.pe` and `www.roughguides.com`. Nothing changes for them.

One entry in this group needs a word.

- **The Wikivoyage editions** (`de`, `en`, `fa`, `hi`, `id`, `it`, `ru`, `zh`) are read through the MediaWiki Action API by `scripts/catalogue-coverage.sh lookup` (`backend/src/scripts/catalogueCoverageLookup.ts`, `https://en.wikivoyage.org/w/api.php`). API:Etiquette, the User-Agent policy and the Robot policy's Action API rules all invite programmatic use. **Change:** reword the condition. `/w/` is closed to crawlers, and the Action API is read under Wikimedia's API rules, one request at a time. The verdict is unchanged; the stated reason becomes accurate.

### How the sync clients name themselves (`backend/src/config/userAgent.ts`)

`userAgent({ bot, purpose })` builds `<client>/<version> (<contact>[; purpose])`. The client is `TrackYourRegionsBot` when `bot: true` and `TrackYourRegions` otherwise. The version comes from `backend/package.json`. The contact is `USER_AGENT_CONTACT`, or by default `https://uncovering.world; info@uncovering.world`, which is the project's address, not a person's. The text is sanitised to header-safe Latin-1. The callers that set `bot: true` are:

- `unescoApi.ts` (`UNESCO_USER_AGENT`, no purpose)
- `wikidataUtils.ts` (`WIKIDATA_USER_AGENT`)
- `osm/qleverOsm.ts`
- `osm/overpassOsm.ts`
- `worldViewImport/geoshapeCache.ts`, `geoshapeComposite.ts`, `geocodeMatcher.ts` (Nominatim) and `pointMatcher.ts`
- `wikivoyageExtract/fetcher.ts` (purpose "region hierarchy extraction")
- `scripts/catalogueCoverageLookup.ts` (purpose "catalogue coverage survey")
- `dumps/fetch.ts` (purpose "public dump builds")

Interactive or admin calls (geocode, picture credits, image proxy, auth) send `TrackYourRegions/<version>` without the marker.

Under the proposed policy, the product token a site would name in robots.txt to address the runs is **`TrackYourRegionsBot`**. RFC 9309 §2.2.1 allows letters, `_` and `-`, so the token is valid. The runs would need a small check that honours a group naming that token, a `Content-Usage` signal where present, and a TDM reservation where a run relies on the exception. No such check exists today: no sync client reads robots.txt at all.

---

## (e) What practitioners write

The same day. The question: what do practitioners write about whether robots.txt applies to programmatic clients of a documented public API, as opposed to crawlers? The authorities in (a) are not repeated here.

**How this was read.** Before any page was read, its host's robots.txt was fetched with curl and the neutral User-Agent `robots-research/1.0`, and checked for a `*` group and for any Anthropic group. Pages were then read with the fetch tool *(fetch tool)* or with curl *(read directly)*. Hacker News threads were read through the HN Algolia API (`hn.algolia.com/api/v1/items/<id>`). That host serves no robots.txt (404). GitHub material was read through `gh api`. No request header carried a personal name or e-mail address. Nothing was fetched from the forbidden hosts.

**Not read, and why.**
- **Stack Overflow, Webmasters, Software Engineering SE.** To a non-browser client, these hosts answer `/robots.txt` with HTTP 418 and `User-agent: *` / `Disallow: /`, plus `Content-signal: search=no, ai-train=no`. No answer there was read.
- **Two blogs: the post behind HN 40690898 (`rknight.me`) and `wired.com`.** Both robots.txt files name `Claude-User`, so neither was read. They are known here only through the HN thread.
- **`robotstxt.org/faq/what.html`.** It answered the fetch tool with a 403. The block was not worked around.
- **`data.nhm.ac.uk/about/download`.** Same: a 403 to the fetch tool, not worked around. Its text was read instead from the portal's public source on GitHub (item 7c).

**No Opendatasoft/Huwise or Socrata community answer on the question was found.** This repeats the earlier search's null result.

The entries are ranked by weight. A party's own documentation or its own commit counts most, then standards and CDN bodies, then publishers' measurements, then anonymous comments.

### Tier 1: operators of the clients in the AI-fetcher debate

1. **OpenAI, "Overview of OpenAI Crawlers"** (https://developers.openai.com/docs/gptbot). The page carries no date. ppc.land reports that ChatGPT-User was removed from the robots.txt clause on 9 December 2025 (https://ppc.land/openai-revises-chatgpt-crawler-documentation-with-significant-policy-changes/). *(fetch tool)*
   - **Who:** an AI operator, writing about its own fetchers.
   - **Position:** user-initiated fetches by ChatGPT-User fall outside robots.txt. OAI-SearchBot and GPTBot obey it.
   - **Quote:** "Because these actions are initiated by a user, robots.txt rules may not apply."
2. **Perplexity, bot documentation** (https://docs.perplexity.ai/guides/bots, undated). *(fetch tool)*
   - **Who:** an AI operator.
   - **Position:** PerplexityBot (its index crawler) obeys robots.txt. Perplexity-User (its user-triggered fetcher) generally does not.
   - **Quote:** "Since a user requested the fetch, this fetcher generally ignores robots.txt rules."
3. **Perplexity, "Agents or Bots? Making Sense of AI on the Open Web"** (https://www.perplexity.ai/hub/blog/agents-or-bots-making-sense-of-ai-on-the-open-web, 4 August 2025). *(fetch tool)*
   - **Who:** the same operator, answering Cloudflare.
   - **Position:** a user-driven agent fetches only what a person asked for, so it is not a bot. The post leans on Google's user-triggered fetchers and does not commit to honouring robots.txt.
   - **Quote:** "This is the fundamental difference between a user agent and a bot."
4. **Anthropic, the help-centre article on its crawlers** (https://support.claude.com/en/articles/8896518, dated 7 April 2026; already cited in (a)4). *(fetch tool)*
   - **Who:** an AI operator.
   - **Position:** every Anthropic bot honours robots.txt. Site owners can refuse Claude-User, the user-initiated fetcher, by naming it. There is no exemption for user-triggered fetches.
   - **Quote:** "control which sites can be accessed through these user-initiated requests."

### Tier 1: the CDN that arbitrates bot traffic

5. **Cloudflare blog, "Perplexity is using stealth, undeclared crawlers to evade website no-crawl directives"** (https://blog.cloudflare.com/perplexity-is-using-stealth-undeclared-crawlers-to-evade-website-no-crawl-directives/, 4 August 2025). *(fetch tool)*
   - **Who:** Cloudflare's bot-management team.
   - **Position:** a user-triggered fetcher that reads a site whose robots.txt refuses it breaks the norms of RFC 9309. The post holds up ChatGPT-User as the good example, before OpenAI changed its documentation.
   - **Quote:** "ChatGPT-User fetched the robots file and stopped crawling when it was disallowed."
6. **Cloudflare, Verified Bots policy** (https://developers.cloudflare.com/bots/concepts/bot/verified-bots/policy/, last updated 8 October 2026). *(fetch tool)*
   - **Who:** the CDN's published admission rule.
   - **Position:** to be listed as verified, any bot or agent must obey robots.txt. That includes the policy's "Agent" class: user-directed agents visiting a page for a person.
   - Since 1 July 2026, signed agents are folded into the same category, marked "Intermediary" (https://developers.cloudflare.com/bots/concepts/bot/signed-agents/).
   - The policy says nothing about API clients.
   - **Quote:** "it obeys robots.txt and crawl directives, maintains reasonable request rates".
7. **Cloudflare blog, "The age of agents: cryptographically recognizing agent traffic"** (https://blog.cloudflare.com/signed-agents/, 28 August 2025). *(fetch tool)*
   - **Who:** Cloudflare.
   - **Position:** an agent is a new class of client, unlike a single-purpose crawler. The post does not discuss robots.txt; that rule arrives through the policy in item 6.
   - **Quote:** "directed by an end user instead of a single company".

### Tier 1: operators of documented APIs, in their own words and files

8. **The Natural History Museum's data portal** (CKAN), commit `b59c1bd` "ui: clarify that the robots.txt is for crawlers" (https://github.com/NaturalHistoryMuseum/ckanext-nhm/commit/b59c1bd7b56bfcbdbfd526d518a49b79fcce208e, 20 March 2026). *(read directly via gh)*
   - **Who:** the portal's own developers, editing their API guidelines.
   - **Change:** the guideline to respect the robots.txt gained the words "for crawling". The same list asks for under 5 requests a second, caching and an identifying User-Agent.
   - **Position:** a Disallow on `/api` in the portal's robots.txt targets crawlers, not scripts using the API.
   - **Quote (commit message):** "It lists /api, which is obviously allowed for scripts".
   - This is the plainest operator statement of the earlier report's rule that was found.
9. **The US National Weather Service, `api.weather.gov`.** *(read directly)*
   - The host's robots.txt is just `User-agent: *` / `Disallow: /`.
   - The documentation (https://www.weather.gov/documentation/services-web-api, *fetch tool*) presents the same host as open data free for any use, with rate limits. It never mentions robots.txt.
   - **Position, read from the operator's practice:** robots.txt keeps crawlers off the API host, while the documentation governs the clients it invites. Read literally, robots.txt would leave the API with no users.
   - **Quote (documentation):** "A User Agent is required to identify your application."
   - An HN submission on 30 June 2026 pointed at the file and drew no discussion (HN 48732489).
10. **CKAN's default robots.txt and its rationale.**
    - The template (`ckan/templates/home/robots.txt`, read through `gh api`; demo.ckan.org serves it) has `User-agent: *` with `Disallow: /api/` and `Crawl-Delay: 10`.
    - CKAN documents its Action API for scripts.
    - In issue ckan/ckan#3076 (31 May 2016, https://github.com/ckan/ckan/issues/3076), the issue's author objected that the API demo window's links drew robots into running database queries.
    - **Position:** the Disallow on `/api/` exists to stop link-following robots, not API clients.
    - **Quote:** "should not encourage robots to make queries against the database".
    - This is the same platform pattern as Opendatasoft's template in (a)3, with the reason written down this time.
11. **A UK technologist's blog, a post telling scrapers to use the API rather than the HTML** (https://shkspr.mobi/blog/2025/12/stop-crawling-my-html-you-dickheads-use-the-api/, 14 December 2025; HN 46265579, 128 points). *(fetch tool)*
    - **Who:** the operator of the site, writing about scrapers of it.
    - **Position:** automated readers should take the WordPress JSON API, the feeds and the sitemap, not the HTML.
    - The same site's robots.txt has `Disallow: /blog/wp-json/` for `*` *(read directly)*. So the operator closes the API path to crawlers while inviting programs to use it.
    - **Quote:** "just pull the data straight from the API".
12. **A Hacker News moderator** (HN comment 21617639, 24 November 2019).
    - **Who:** the site's operator.
    - **Position:** robots.txt's 30-second crawl delay governs reading the site. Anyone who needs more should use the separate, documented Firebase API.
    - **Quote:** "If you need more than that, you should use the Firebase-based API".
13. **OpenStreetMap's website robots.txt** (`www.openstreetmap.org/robots.txt`). *(read directly)*
    - It disallows `/api/` for `*`.
    - Its header comments send bulk readers to planet.openstreetmap.org.
    - **Quote:** "We encourage you to use these instead of scraping our site."
    - Overpass and Nominatim are covered in (a)5. This is the same pattern on OSM's main site.
14. **MetaBrainz, "We can't have nice things because of AI scrapers"** (https://blog.metabrainz.org/2025/12/11/we-cant-have-nice-things-because-of-ai-scrapers/, 11 December 2025). *(fetch tool)*
    - **Who:** a member of the MusicBrainz operator's team.
    - **Complaint:** scrapers ignore robots.txt and skip the bulk dumps.
    - **Response:** the operator now requires an `Authorization` token on API endpoints such as `/metadata/lookup`.
    - **Position:** the operator governs the API with its own tokens and leaves robots.txt to crawlers.
    - **Quote:** "require the caller to send an Authorization token".
15. **Facebook's CTO at the time, on HN** (comment 1440154, 17 June 2010, in the thread on a researcher's crawl of Facebook profiles).
    - **What he said:** an open robots.txt next to a separate, stricter agreement was a mistake. Facebook would allowlist search engines in robots.txt and send developers to its API platform policy.
    - **Position:** robots.txt should state the crawling rule honestly, and API use is governed by the platform's own terms.
    - **Quote:** "bad for us to stray from Internet standards and conventions".
    - `graph.facebook.com/robots.txt` today is `User-agent: *` / `Disallow: /` *(read directly)*.
16. **Robots.txt on other API hosts, sampled 2026-10-25** *(read directly)*.
    - `api.x.com` and `api.twitter.com` allow Googlebot and Bingbot and disallow `/` to everyone else.
    - `api.spotify.com` opens only `/v1/` to named search bots.
    - `api.inaturalist.org` disallows query URLs (`/*?`).
    - `api.github.com`, `api.crossref.org`, `api.semanticscholar.org`, `collectionapi.metmuseum.org` and `api.nasa.gov` serve no robots.txt.
    - `api.openalex.org` allows everything.
    - **Reading:** where an API host has a robots.txt at all, it is written for search engines. None of these files is a statement about the API's own clients.

### Tier 2: standards and search-engine people

17. **Google Search Central, "Robots Refresher: robots.txt — a flexible way to control how machines explore your website"** (https://developers.google.com/search/blog/2025/03/robotstxt-flexible-way-to-control, 7 March 2025). *(read directly)*
    - **Who:** two members of Google's Search Relations team.
    - **Position:** robots.txt is a crawler convention, supported by crawler operators such as search engines, site-owner tools and services. It does not address API clients.
    - **Quote:** "tell all bots (also known as crawlers, robots, spiders)".
18. **Google Search Central office hours, as summarised by Lumar** (https://lumar.io/office-hours/disallow, 22 June 2022). *(fetch tool)*
    - **Who:** a Google Search advocate.
    - **Position:** disallowing API URLs or API subdomains is a crawl-budget tool for Googlebot. It is fine to do when the pages render without them.
    - **Quote (Lumar's heading):** "Don't block API requests if they load important content".
19. **IAB, RFC 9969, "Report from the IAB Workshop on AI-CONTROL"** (https://www.rfc-editor.org/rfc/rfc9969.txt, May 2026; the workshop sat in September 2024). *(read directly)*
    - **Who:** the IETF's architecture board, reporting its participants' views.
    - **Position:** it treats robots.txt as a crawl-time signal bound to location, and names the gap between crawl time and inference time as the core problem.
    - It says nothing about API clients. Enforcement and identifying crawlers were left out of scope.
    - **Quote:** "Statements of preference are apparent at crawl time".
20. **Internet Archive blog, "Robots.txt meant for search engines don't work well for web archives"** (https://blog.archive.org/2017/04/17/robots-txt-meant-for-search-engines-dont-work-well-for-web-archives/, 17 April 2017). *(fetch tool)*
    - **Who:** the director of the Wayback Machine.
    - **Position:** robots.txt was written for search-engine crawlers. A different kind of automated client, an archive, should not be ruled by it.
    - **Quote (title):** "Robots.txt meant for search engines don't work well for web archives".

### Tier 3: publishers' measurements

21. **TollBit, the post on Google-Agent and robots.txt** (https://tollbit.com/blog/google-agent-robots-txt/, 8 April 2026, *fetch tool*). Its H1 2026 State of the Bots findings are reported by ppc.land (https://ppc.land/15-of-ai-page-fetchers-in-europe-reached-disallowed-urls-tollbit-finds/, 15 August 2026, *fetch tool*).
    - **Who:** a publisher-monetisation company.
    - **Position:** a user-triggered fetcher's exemption is a problem for publishers. TollBit counts every request to a disallowed URL as a bypass, whatever the vendor's documentation says.
    - **Finding:** about 15% of identified AI page fetchers reached disallowed URLs on European sites. 9% of European sites disallow Claude-User.
    - **Quote:** "It's also one that should make publishers uncomfortable."

### Tier 4: developers and anonymous commenters

22. **A GitHub issue in a small sports-data project** (NextOneTwoLabs/collegedash#99, 15 September 2026, https://github.com/NextOneTwoLabs/collegedash/issues/99).
    - **The case:** the project's rule says it honours robots.txt, yet it calls Wikipedia's `/api/` and `/w/api.php`. The issue frames the same two options as (a)5.
    - **The resolution:** the owner chose to exempt those paths as "Wikimedia's intended programmatic interfaces", and asked for the exception to be written down.
    - **Position:** a documented API follows its own etiquette, provided the exception is written down.
    - Low weight, but it is the same question this project faces, reached independently.
23. **Hacker News, majority view.** Anonymous comments, 2020–2025, read through the Algolia API.
    - **Position:** robots.txt governs crawlers. Single, user-requested or API requests are something else.
    - The longest of them uses the Wget recursive-only behaviour cited in (a)4 (comment 40691649, 15 June 2024, on Perplexity's user agent).
    - Others:
      - 45942854 (16 November 2025): when each page load maps one-to-one to a user's request, the client is not a robot.
      - 45068696 (29 August 2025): the feed reader and git client as non-robots.
      - 41626987 (23 September 2024).
    - The one closest to this project, comment 22526160 (9 March 2020), is about software that reads only public APIs.
    - **Quote:** "These APIs are there specifically for automated use."
24. **Hacker News, the dissent.** Anonymous comments.
    - **Comment 40699952** (16 June 2024): any unattended, scheduled retrieval is a robot, even of one URL. Its author ran exactly such a job, with the site owner's permission. **Quote:** "Recursiveness is not required to make a web robot."
    - **Comment 44796854** (5 August 2025): robots.txt has always been used to exclude specific automated clients, whether they fetch one page or many.
    - **Comments 44790525 and 40694191:** every scraper should obey, "even for summarization requests".
    - **Comment 3111331** (14 October 2011): Google's own terms then required compliance with robots.txt on its domains. That is the same contract move as UNESCO's §7(e) in (a)3.

### Where the consensus lies

- **Documented APIs are mostly outside the dispute.** No operator, standards body or CDN found says, of its own API, that a client of it is bound by a crawler-oriented `User-agent: *` Disallow. Two texts read the other way, and neither is settled: terms that fold `robots.txt` into a contract clause and name an API client (UNESCO's §7(e)), and the literal words of Wikimedia's Robot policy. Cloudflare-managed files present their content signals as a condition of access for any client, but that condition covers the usage signals, not the Allow/Disallow lines.
- **Operators who publish APIs say the opposite, in words and in their files.** Several disallow their own API paths, or whole API hosts, for `*` while documenting the same endpoints for scripts, with User-Agent, rate-limit and token rules:
  - NHM (explicitly);
  - the NWS (`Disallow: /` on the API host itself);
  - CKAN (with the reason written down);
  - a blogger asking scrapers to use his API;
  - HN;
  - OpenStreetMap;
  - Wikimedia, per (a)5.
- **The 2024–2026 controversy is about something else: an AI agent reading web pages at a user's request.**
  - Google, OpenAI (since December 2025) and Perplexity exempt such fetches.
  - Anthropic holds them to robots.txt.
  - Cloudflare makes obeying robots.txt a condition of verified status for agents too.
  - Publishers count any such fetch as a bypass.
- **Both sides of the AI-fetcher dispute agree on one point.** robots.txt is about *crawling* or *page reading*, and an operator's API documentation governs its API. The dissent below does not share it.

### The main dissent

- **The argument.** "Robot" means any unattended client, not just a recursive one. A scheduled job fetching one URL is therefore a robot, and a robots.txt Disallow on that URL should stop it (HN 40699952). Some say robots.txt has always been used to exclude named automated clients, whatever they fetch (HN 44796854).
- **The institutional versions.**
  - Cloudflare's Verified Bots policy applies robots.txt to every bot or agent it lists.
  - Terms of use, such as UNESCO's §7(e) or Google's 2011 terms, can make robots.txt a contract term for every automated client.
- **What the dissent's own example shows.** It is about a *page*, not an endpoint the operator documents for scripts. None of the dissenting sources considers the case of an operator that both disallows a path and documents it as an API.

### Does this change the earlier recommendation?

**No.** The split in (c) stands:
- Scheduled runs against a documented API follow the API's documentation, licence, terms and limits, not robots.txt's general section.
- They still obey a group naming `TrackYourRegionsBot`, any usage signal, and a TDM reservation where they rely on the exception.
- An AI agent's page reading keeps obeying robots.txt. Anthropic's commitment and Cloudflare's policy agree with this, and it sits on the stricter side of the live dispute.

The practitioner record supports the split and sharpens three points:

1. **Make the boundary explicit.** The dissent's best case, an unattended scheduled fetch, is answered only by condition 1 of the rule: the operator documents the endpoint for programmatic use. The rule should therefore also say what happens otherwise:
   - a scheduled run that fetches an HTML page, or an endpoint the operator does not document for scripts, is a crawler: it follows the group naming its token, or the `*` group where none does.
   - (c) now states this.
2. **Cite operator statements in the register records.**
   - The NHM commit and the NWS pairing (`Disallow: /` on a documented open-data API host) are the clearest published examples of an operator closing an API path to crawlers while inviting scripts.
   - They are worth citing in `docs/sources/` beside the Wikimedia, OSM and Opendatasoft records when a record explains why a `*` Disallow does not decide.
3. **Usage signals now arrive as access conditions.**
   - Cloudflare-managed robots.txt files open with "As a condition of accessing this website, you agree to abide by", followed by the content signals. They also declare `Content-Signal` lines as an EU Article 4 reservation. `data.nhm.ac.uk` serves one, *read directly*.
   - A `Content-Signal` therefore claims to bind any client, API clients included. This makes the honouring check in (c) a real need rather than an option.
   - A separate point from item 6: Cloudflare's Verified Bots policy applies only if the project ever asks Cloudflare to list `TrackYourRegionsBot` as verified. Listing would require obeying robots.txt in full, as a condition Cloudflare sets rather than an obligation that already holds.
