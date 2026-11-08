# Outside services: the register (#1308)

Every outside service the backend, the browser or a repository script calls, with the rules its
operator publishes, the code that calls it, and whether that code keeps them. Check a service here
before adding a call to it, and add its line before the call lands.

**How a call is judged.** [ADR-0148](../decisions/0148-a-documented-api-is-used-under-its-operators-rules-and-page-reading-under-robots-txt.md)
sets the rule, and #2003 adds to it:
- A documented API is used under its operator's rules: rate, parallelism, identification, caching,
  attribution, bulk use. A `User-agent: *` group in the host's `robots.txt` is addressed to
  crawlers and does not decide a documented API's use.
- A group naming `TrackYourRegionsBot`, or a usage signal (`Content-Signal`, `Content-Usage`), is
  binding. `services/robots/robotsSignals.ts` `assertRobotsAllow` reads both before a program's
  call.
- A program fetching a site's pages is a crawler, and follows the site's `robots.txt`.

Every outbound User-Agent is built in `backend/src/config/userAgent.ts` (`userAgent()`; `bot: true`
for a program, `linkCheckUserAgent()` for the website check). The exceptions are named below. The
sites a catalogue-coverage *survey* reads are a separate register: `docs/sources/site-access.md`.

**Which route.** A bulk read comes from a public dump, and a live service answers only small,
interactive or fresh questions (ADR-0101, Epic #1312). Each service below says which route the
product takes and why.

Every policy page was read on **2026-11-04** unless a line says otherwise. Rules are paraphrased;
the policy page is the authority.

## Summary

| Service | Route | Complies | Open |
|---|---|---|---|
| Wikidata Query Service | live, small; bulk from the subset | yes (#1307) | — |
| Wikimedia Action API (Wikidata, Commons, Wikipedia, Wikivoyage) | live, small | yes, within one process | — |
| Commons thumbnails (`Special:FilePath`) | browser | yes | — |
| dumps.wikimedia.org | dump | yes | — |
| maps.wikimedia.org geoshapes | none since #2084 | — | — |
| Nominatim | live, interactive | yes | — |
| Overpass API and its mirrors | live, fallback | yes | — |
| QLever (OSM planet) | live, small batches | yes | — |
| tile.openstreetmap.org | browser | **no** (the app depends on it) | #651 |
| CARTO basemap style | browser | **no** (no key) | #651 |
| fonts.openmaptiles.org | browser | no terms published | — |
| tiles.maps.eox.at (EOxCloudless) | browser, on a curator's switch | yes (non-commercial, credited) | — |
| planet.openstreetmap.org | dump | yes | — |
| data.unesco.org (`whc001`) | live, one export a run | yes | — |
| Jev (TypeSafe) | live, keyed | yes | — |
| OpenAI | live, keyed, admin only | unverified: the usage policies are unread | a person reads them |
| Place websites (the review card's check) | live, per card | **gap** | #2354 |
| Have I Been Pwned (Pwned Passwords) | live, per registration | yes | — |
| Google and Apple sign-in | OAuth | owed before deploy | #1177 |
| SMTP provider | per deployment | not chosen | — |
| LiteLLM price list (raw.githubusercontent.com) | one file, by an admin | yes | — |
| GADM (geodata.ucdavis.edu) | one download, by hand | owed before deploy | #1175 |

## Wikimedia

**For every Wikimedia host.**
- *Identification:* the [User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)
  asks for a client name, a version and a contact, which `userAgent()` sends, with `bot` in
  `TrackYourRegionsBot` for automated traffic. Complies.
- *`robots.txt`:* no Wikimedia host has a group naming our token or a usage signal. The `Disallow: /w/`
  of the wikis' `*` group is addressed to crawlers; the Action API is documented for scripts.
- *Compression:* the [robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy) asks for
  gzip. The runtime's `fetch` sends `Accept-Encoding: gzip` by default; nothing sets it by hand.

**Wikidata Query Service** (`query.wikidata.org/sparql`).
- *Rules* ([user manual § Query limits](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual)):
  - 60 s of processing time per minute per client;
  - 30 failing queries a minute;
  - 5 parallel queries per address;
  - a 60 s deadline;
  - a 429 with `Retry-After` is to be honoured, and a client that keeps sending after one can be banned.
- *Code:* `sync/wikidataUtils.ts` `sparqlQuery` → `inTurn`, POST, bot UA, a 55 s server timeout.
  Every query in the process takes one turn, and the next starts after the last one's duration
  (#1307). A curator's image suggestion (`geocodeController.ts`) has its own short client and skips
  the layer on a 429.
- *Route:* bulk questions read the local subset (ADR-0101, ADR-0119); live is the fallback.
- *Complies.* The hold a 429 puts on other runs is capped at three minutes
  (`SPARQL_BACKOFF_CEILING_MS`).

**Wikimedia Action API** (`www.wikidata.org`, `commons.wikimedia.org`, `<lang>.wikipedia.org`,
`en.wikivoyage.org`, `/w/api.php`).
- *Rules* ([robot policy](https://wikitech.wikimedia.org/wiki/Robot_policy),
  [rate limits](https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits),
  [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)):
  - an unauthenticated automated client sends one request at a time, under 5 a second, and pauses
    5 s after any request that took over a second;
  - 200 requests a minute for a bot that identifies itself;
  - batches where the API offers them;
  - `maxlag` on work nobody waits on;
  - a read sent as POST carries `Promise-Non-Write-API-Action: true`;
  - wait at least 5 s after a 429 that names no `Retry-After`.
- *Code:*
  - Wikidata: `sync/componentItemQueries.ts` (`wbgetentities`, 50 ids, through `askWikipediaOnce`),
    `worldViewImport/pointMatcher.ts` `fetchWikidataP625Batch`, `geocodeController.ts`
    (`wbsearchentities`, a curator's click) and `scripts/catalogueCoverageLookup.ts` `apiGet`.
  - Wikipedia: `sync/wikipediaCategories.ts` `askWikipediaOnce` → `postWikipedia` (categories,
    articles, extracts), `sync/visit/visitReading.ts` `articleLeads` and `articleLead`, and
    `services/wikipediaCoordinate.ts`.
  - Commons: `sync/imageCredit.ts` (`extmetadata`, 50 titles a call), `sync/visit/commonsPhotos.ts`,
    `pictureClass/pictureClasses.ts`, `sync/commonsNearby.ts`, `worldViewImport/geoshapeCache.ts`
    (a Commons `.map` file) and `services/pictureFetch.ts`.
  - Wikivoyage: `wikivoyageExtract/fetcher.ts` (the AI *suggest children* review),
    `worldViewImport/pointMatcher.ts` `fetchWikitextForPage`, `wvImportMapshapeController.ts`,
    `wvImportMatchMarkers.ts` and the coverage `lookup`. The bulk extraction reads the dump (#2089).
- *Complies.* Every caller sends through one turn for the process (`services/wikimediaApi.ts`
  `actionApiFetch`, #2352):
  - one request at a time;
  - a quarter of a second between quick answers, and 5 s after one that took over a second;
  - a 429's or 503's `Retry-After`, or 5 s where it names none, holds every caller back;
  - a POST read carries `Promise-Non-Write-API-Action: true`;
  - `maxlag` goes only where the caller reads its refusal (a 200 with an `error` of `maxlag`) and
    can wait it out: the shared MediaWiki transport when its wait budget covers the first wait a
    refusal asks for (a run, not a curator's Save or card) and the coverage `lookup`; the picture
    credits, the Commons map files and the import's point matcher do not send it yet;
  - the turn is held until the answer's body has arrived, which the pause after a slow answer counts;
  - a request's timeout starts when its turn is given, not while it waits for it (`timeoutMs`), and a
    caller's abort stops its wait for the turn;
  - the import's live reads, which have no retry of their own, ask once more after the hold
    (`retryHeld`).

  Identification, batching and the callers' own retries are as before (`sourceRetry.ts`). The turn
  is per process: the coverage `lookup` runs as a process of its own and keeps its own.
- *What reaches a model:* English Wikipedia leads read from the `extracts` API (`articleLeads`,
  1,500 characters) are sent to Jev for a visit reading (#1996) and for a kind reading (#2342). The
  text is CC BY-SA. The read is
  flagged `modelInput`, so a site's `ai-input=no` signal would stop it, and enwiki states none.

**Commons thumbnails** (`commons.wikimedia.org/wiki/Special:FilePath/…?width=N`, drawn by the
reader's browser, `frontend/src/utils/imageUrl.ts` `toThumbnailUrl`).
- *Rules:* [reusing content](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)
  calls hotlinking possible but not recommended, and asks for the author and the licence beside the
  picture. [Common thumbnail sizes](https://www.mediawiki.org/wiki/Common_thumbnail_sizes) lists
  the steps the cache keeps.
- *Code:* every shown picture carries its credit (`ImageCreditLine`, CLAUDE.md § Experience Images).
- *Complies.* Three widths are not cache steps (300 in `MapImagePickerDialog`, 720 in
  `HoverPreviewCard`, 800 in `GapAnalysisDialog`); `Special:FilePath` rounds them up to a step, so
  the bytes are those of the next size.

**dumps.wikimedia.org.**
- *Rules* (its front page): the User-Agent policy is enforced, downloads are rate-limited and capped
  at 3 connections per address, and a client that evades the limits can be blocked. The front page
  calls the XML dumps deprecated and names [MediaWiki Content File
  Exports](https://wikitech.wikimedia.org/wiki/MediaWiki_Content_File_Exports) their replacement.
  `robots.txt` answers 404.
- *End dates of what the catalogue reads* ([Legacy content dumps
  sunset](https://wikitech.wikimedia.org/wiki/Legacy_content_dumps_sunset), read 2026-11-07):
  - the legacy XML dumps the sunset names stop after January 2027: current pages, full history and
    the stub files. The catalogue reads none of them;
  - `pages-articles` XML is not among them, and the sunset page says any change to it will be
    announced separately. The catalogue does not read it: English Wikivoyage's articles come from
    the monthly content export (`wikivoyage-pages`);
  - the SQL table dumps, the Wikidata JSON dumps and the pageview files have no end date; the
    sunset page says SQL, RDF and JSON dumps do not change.
- *Code:* `services/dumps/fetch.ts` (`downloadTo` with ranged parts, bot UA with the purpose
  *public dump builds*, `HOST_CONNECTIONS = 3`, no retry loop), the descriptors in `dumps/catalog.ts`,
  and `dumps/newestOnHost.ts` (once a day per dump).
- *Where the cap is kept:* in the dump worker, the one process that asks the host anything. Its
  builds and its daily check of the newest dumps share the one count `fetch.ts` keeps, and the
  backend reads what the worker learnt (`workbench.dump_newest_on_host`) and opens no connection
  to the host (#2353).
- *Complies.*

**maps.wikimedia.org geoshapes.** The [Maps Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Maps_Terms_of_Use)
(read 2026-10-26) allow no third-party service outside the Wikimedia projects. No call remains:
#2084, #2085 and #2089 removed them, and migration 182 deleted the stored shapes.

## OpenStreetMap and the map

**Nominatim** (`nominatim.openstreetmap.org`, `/search` and `/reverse`).
- *Rules* ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)):
  - at most one request a second, and 4 a minute for a script that runs long or on a schedule;
  - one thread on one machine for bulk work;
  - an identifying User-Agent;
  - results cached, since repeating a query can get a client blocked;
  - attribution, ODbL;
  - no auto-complete over the API and no systematic queries.
- *robots.txt* closes `/search` and `/reverse` to `*`, which the policy page, documenting them for
  programs, decides instead.
- *Code:* `services/nominatim.ts` is the one client (`searchNominatim`, `reverseNominatim`,
  `inTurn`): one turn for the process at 1.1 s, answers cached 24 h, no retry on a 429 or 403.
  - The location picker and the add dialog search on Enter or a button only (the decision of
    2026-10-09).
  - The import's geocode match runs per region on an admin's click.
  - Wherever a result is shown it is credited "© OpenStreetMap contributors": the location
    picker's search list and the add dialog's *Found* line (`LookupOutcome`).
- *Complies.* There is no switch to turn the service off without a deploy.

**Overpass API** (`overpass-api.de`, then `maps.mail.ru`, then `overpass.private.coffee`;
`services/sync/osm/overpassOsm.ts` `OVERPASS_INSTANCES`).
- *Rules:*
  - [the commons page](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html): about
    10,000 requests and 1 GB a day, a few slots per address, `[timeout:]` and `[maxsize:]`
    declared, and heavy users run their own instance;
  - [the wiki's list of instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances):
    overpass-api.de divides those numbers by 100 for regular use, asks for an identifying
    User-Agent and no parallel scripts, and a 30 s pause after a 429;
  - private.coffee's own terms: few simultaneous requests, a meaningful User-Agent, notice before
    large operations, attribution.
- *Code:* used when `OSM_READER=overpass` or as the mirror's fallback (ADR-0134, `oneDoorPerRun.ts`),
  and by the card's *Ask OpenStreetMap by name* (`pointNamesakes.ts`):
  - one request at a time for the process, whichever asker sends it, and a 5 s pause after it
    (`overpassAsker`, its module-level turn): a curator's click during a run waits its turn, at most
    30 s, and is then answered that OpenStreetMap is busy (`turnWaitMs`, `OverpassBusyError`);
  - every query declares its `[timeout:]` and `[maxsize:]` (`OVERPASS_QUERY_TIMEOUT_S`, `OVERPASS_ENUMERATION_TIMEOUT_S` and `OVERPASS_QUERY_MAXSIZE_B` in `overpassOsm.ts`, `ASK_TIMEOUT_S` in `pointNamesakes.ts`);
  - 30 s after a 429, `Retry-After` honoured, bot UA, POST, a day's cache.
- *Complies.*

**QLever** (`qlever.dev/api/osm-planet`, `services/sync/osm/qleverOsm.ts`, the default OSM reader).
- *Rules* ([usage information](https://github.com/ad-freiburg/qlever/wiki/Usage-and-privacy-information-for-the-QLever-SPARQL-endpoints)):
  no formal limit, heavy users asked to run their own, addresses logged a week. `robots.txt` answers
  404. Its source record is `docs/sources/global/openstreetmap-qlever.md`.
- *Code:* batches of 100 with a pause, bot UA, a day's cache.
- *Complies.*

**tile.openstreetmap.org** (the raster source in `frontend/src/constants/mapStyles.ts`, and
`LocationPicker`'s own style).
- *Rules* ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/)):
  - HTTPS and a valid Referer;
  - honour the cache headers;
  - attribution clearly on the map;
  - no prefetching or bulk use;
  - no headless bots that pan or zoom.

  The [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines) ask
  for the credit visible without interaction and linked to the copyright page.
- *Credit:* every map that draws the tiles uses one source, `OSM_RASTER_SOURCE` in
  `frontend/src/constants/mapStyles.ts`, which carries `OSM_ATTRIBUTION` (linked to the copyright
  page), and keeps its attribution control on: in full on Discover and the location picker, and at
  MapLibre's responsive default on the react-map-gl maps, which folds the credit behind its ⓘ on a
  map 640 px wide or less after the first drag (#2350; `mapStyles.test.ts` holds that only the
  shared source names the tiles and that no map turns the control off). Every map on the shared
  styles names the credit in its control from its creation (`OSM_ATTRIBUTION_CONTROL`, #2364), so
  it is in the corner before the tiles load and their arrival does not widen the corner under the
  reader; MapLibre drops the source's copy as a duplicate.
- *Headless runs:* none asks it. The smoke and Lighthouse lanes, and `perf:local`, launch Chrome
  with the tile hosts unresolvable (`frontend/tests/unservedBasemap.mjs`, #2351), so a tile
  request fails on the machine.
- ***Does not comply***: the policy does not let an app depend on this server at all, which is
  #651's question.

**CARTO's Positron style** (`basemaps.cartocdn.com/gl/positron-gl-style/style.json`, drawn by the
admin and editor maps that name it: `CoverageMapPreview`, `GapAnalysis`'s `COVERAGE_MAP_STYLE`,
`OverlapResolutionDialog`, `SmartFlattenPreviewDialog`, `SmartSimplifyDialog`,
`DivisionPreviewDialog`).
- *Rules* ([basemap terms](https://carto.com/legal/basemap-terms/), last updated 2026-09-29): free
  use needs a CARTO-issued key, keyless tiles are watermarked, and the free tier allows 5 M requests
  a month for non-commercial use, with no proxying or caching.
- ***Does not comply***: no key is sent. The style credits OpenStreetMap and CARTO itself. Recorded
  on #651, which chooses the basemap.

**fonts.openmaptiles.org** (the glyphs of `MAP_STYLE` and `CvMatchMap.tsx`). The host publishes no
terms and no limits, and describes itself as the glyph backend for open map styles.

**tiles.maps.eox.at** (`SATELLITE_MAP_STYLE` in `frontend/src/constants/mapStyles.ts`, the point
dialog's satellite view, #2204, ADR-0186).
- *Rules* ([EOxCloudless](https://cloudless.eox.at), read 2026-11-08): the 2018 to 2025 mosaics are
  CC BY-NC-SA 4.0, free to use with the service endpoints as long as the licence's conditions are
  followed; commercial use is a paid licence. The credit names EOX IT Services GmbH and the
  modified Copernicus Sentinel data. No key, no published rate limit; `robots.txt` answers 400.
- *Credit:* `EOX_ATTRIBUTION`, on the source, shown by the map's attribution control while the
  imagery is drawn.
- *Use:* tiles up to zoom 14 (the mosaic's native resolution), asked for only after a curator
  presses *Satellite* in an open dialog; nothing is cached or stored. No headless run presses it.
- *Complies*, while the product stays non-commercial (#769).

**planet.openstreetmap.org** (`dumps/catalog.ts` `OSM_PLANET`, the weekly planet and the daily
diffs, `dumps/osm/planetCurrent.ts`).
- *Rules:* [the planet page](https://planet.openstreetmap.org/) and [the wiki](https://wiki.openstreetmap.org/wiki/Planet.osm):
  ODbL, no browser downloads, no stated limit on connections.
- *robots.txt:* allows `wget` and disallows everything else for `*`. It is addressed to crawlers;
  the page documents the files for programs.
- *Code:* bot UA, file names worked out by date, not by walking the listings, md5 checked, up to 8
  ranged connections (our own choice).
- *Complies.*

## Other services

**data.unesco.org** (the World Heritage dataset `whc001`, `services/sync/unescoApi.ts`).
- *Code:* one export per run (`/api/explore/v2.1/catalog/datasets/whc001/exports/json`, only the
  fields the run reads, `REQUESTED` in `unescoApi.ts`), bot UA, `Retry-After`, the robots check. No picture is fetched and
  whc.unesco.org is only linked.
- *Rules:*
  - the Explore v2 export is documented for programs, anonymous, about 10,000 calls a day;
  - the [terms of use](https://www.unesco.org/en/terms-use), updated 2026-09-15, bar automated
    bulk download, AI training and circumventing `robots.txt` (§ 7), except where a Creative Commons
    licence grants the right (§ 5); the dataset is CC BY-SA 4.0.
- *robots.txt* closes `/api/` to `*` and the exports path to Googlebot too; no group names our token.
- *Complies* under ADR-0148: the run rests on the licence, and the maintainer's decision on #2000 is
  that it continues. Its source record is `docs/sources/global/unesco-world-heritage-list.md`.
  Descriptions are credited (ADR-0149).

**Jev** (`api.typesafe.ai/v1/systemone`, `services/jev/jevClient.ts`, keyed).
- *Sent:* catalogue data — names, countries, kinds, each source's values, a picture's file name and
  credit, coordinates, an OSM tag — and up to 1,500 characters of an English Wikipedia lead for a
  visit reading and a kind reading, the kind reading with the catalogue's kinds and the coverage
  register's planned place kinds and their definitions. No user's data.
- *Rules:* the [Master Customer Agreement](https://typesafe.ai/legal/mca) and the acceptable use
  policy, updated 2026-09-23:
  - the customer holds the rights to what it sends;
  - no training on customer data without consent;
  - output is evaluated independently;
  - no reselling or distilling.

  No public rate limit; one retry on a 429 or 529.
- *Complies*: Wikidata is CC0 and Wikipedia CC BY-SA, and a curator decides on every reading
  (ADR-0087). The run path sends `userAgent()` without the bot marker; the API is keyed.

**OpenAI** (the `openai` SDK, `api.openai.com`; `services/ai/openaiShared.ts`,
`services/ai/chatCompletion.ts`, `openaiVisionMatch.ts`, `wvImportAIController.ts`; every route is
admin only).
- *Sent:* region and division names and paths, Wikivoyage wikitext, learned rules, an admin's place
  description, map images. No user's data.
- *Rules:*
  - [your data](https://developers.openai.com/api/docs/guides/your-data): API data is not used for
    training by default, abuse-monitoring logs are kept up to 30 days, and the Responses API stores
    state 30 days unless `store` is false;
  - the usage policies page refused our fetch on 2026-11-04 and is to be read by a person.
- *Unverified* until a person reads the usage policies; nothing read so far is broken. The SDK sends its own User-Agent, an exception to `userAgent.ts`; the
  web-search calls do not set `store: false`.

**Place websites** (the review card's website check, `services/websiteCheck/checkWebsite.ts`, #2165).
- *Code:*
  - HEAD, then GET when HEAD fails, headers only, up to 5 redirects within 10 s;
  - every hop's address public;
  - no cookie or Referer;
  - `linkCheckUserAgent()`, which names the project and its site;
  - at most 6 sites a card, each cached 24 h.
- ***Gap***: it reads no `robots.txt`, where ADR-0148 decision 3 treats a program fetching a site as a
  crawler, and it keeps no pace per host (#2354).

**Have I Been Pwned, Pwned Passwords** (`api.pwnedpasswords.com/range/<prefix>`,
`authService.ts` `checkBreachedPassword`).
- *Rules* ([API v3](https://haveibeenpwned.com/API/v3)): an honest User-Agent, no key and no rate
  limit for the range API, optional `Add-Padding`.
- *Code:* only the first 5 hex characters of the SHA-1 leave the server, with `Add-Padding` (a padded
  line, counted 0, is no breach), under a 3 s timeout (`BREACH_CHECK_TIMEOUT_MS`), and the check fails
  open on a timeout, a refusal or an error, so it never holds a registration or a password change.
- *Complies.*

**Google and Apple sign-in** (`auth/strategies/google.ts`, `apple.ts`).
- *Code:* minimal scopes (profile and email; name and email), used for login only.
- *Rules:* the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
  asks for a published privacy policy, which the product does not have yet. That is owed before
  public sign-in (#1177).

**SMTP** (`services/emailService.ts`, the verification email). The provider is a deployment's
choice, and its terms join this register when one is chosen. With no SMTP configured, the
development server prints the verification link instead.

**LiteLLM's price list** (`raw.githubusercontent.com`, `services/ai/pricingService.ts`, an admin's
*Update pricing*). One file, `userAgent({ purpose: 'model pricing update' })`, a 30 s timeout.

**GADM** (`geodata.ucdavis.edu`, `scripts/db-cli.sh` `download_gadm`, run once by hand with curl's
own User-Agent). The [licence](https://gadm.org/license.html) allows non-commercial use and bars
redistribution without permission. Serving its boundaries from a public host needs that permission,
owed before deployment (#1175, #769).

**Links only.** Google Maps and Apple Maps (`frontend/src/utils/mapsLink.ts`) and whc.unesco.org
pages are linked, never fetched. `cv-python` calls nothing outside; the frontend loads no font CDN
and no analytics.
