# ADR-0148: A documented API is used under its operator's rules, and page reading under robots.txt

**Date:** 2026-10-25
**Status:** Accepted
**Issue:** [#2003](https://github.com/uncovering-world/track-your-regions/issues/2003)

---

## Context

The repository had no written rule on what a site's `robots.txt` binds, so tickets and records
read it differently:
- #2000 treated the UNESCO run's one call, to
  `data.unesco.org/api/explore/v2.1/catalog/datasets/whc001/exports/json`, as a possible breach,
  because the portal's `robots.txt` has `User-agent: *` / `Disallow: /api/`;
- #1996 proposed that a program's verdict rests on "the `robots.txt` rules for the catalogue's
  User-Agent or `*`";
- the Wikivoyage lines of `docs/sources/site-access.md` said "closed paths not read" next to
  "through the API", while the Action API sits on `/w/`, which Wikimedia's `robots.txt` closes to
  `*`.

Read as binding every program, `robots.txt` would stop most of what the catalogue already does. The
runs call `query.wikidata.org/sparql`, `/w/api.php` on Wikidata, Commons, Wikipedia and Wikivoyage,
`overpass-api.de/api/` and Nominatim's `/search`, and each of those paths is closed to `*`. The same
operators document those paths for scripts, with their own limits and User-Agent rules.

The research of 2026-10-25
([report](../research/2026-10-25-what-a-sites-robots-txt-binds.md)) found:
- **The standard.** RFC 9309 addresses "automatic clients known as crawlers", and says its rules
  "are not a form of access authorization".
- **Search engines.** Google describes `robots.txt` as managing crawler traffic, and its fetchers
  that act on a user's request ignore it.
- **Client tools.** HTTP and API client libraries do not consult it. Wget does only when it
  downloads recursively, and crawler frameworks do by default.
- **The IETF drafts (AIPREF)** separate what a crawler fetches (Allow/Disallow) from how content
  may be used (`Content-Usage`).
- **API operators** close a path to crawlers and document it for scripts:
  - the Natural History Museum's data portal (a commit of 2026-03-20 saying its `robots.txt` is
    for crawlers and `/api` is allowed for scripts);
  - `api.weather.gov` (`Disallow: /`, documented as an open-data API);
  - CKAN's default file;
  - OpenStreetMap;
  - Wikimedia, whose `robots.txt` comment names the target: bots wandering into dynamic pages.
- **data.unesco.org** serves Opendatasoft's default file, the same on six portals of that platform
  including the vendor's own. It also closes `/static/`, the scripts and styles every browser
  loads.
- **No operator says the contrary of its own API.** No operator, standards body or CDN was found
  that requires a client of its own documented API to obey a `User-agent: *` Disallow. Two texts
  read the other way, and neither is settled (the dissent below).

**The dissent.** Some practitioners hold that any unattended, scheduled fetch is a robot. Some terms
of use fold `robots.txt` into a contract clause: UNESCO's §7(e) bars circumventing "robots.txt
directives" and names an API client among automated systems. Those clauses yield "under an
applicable license", and `whc001` is CC BY-SA 4.0. Wikimedia's Robot policy, read literally, asks
every bot to honour every `robots.txt` directive, while metering the very Action API its
`robots.txt` closes to `*`. The file's own comment says it aims at crawlers wandering into dynamic
pages.

**AI agents.** The live dispute of 2024–2026 is about AI agents reading web pages at a user's
request. Google, OpenAI and Perplexity exempt such fetches. Anthropic commits its agents
(`ClaudeBot`, `Claude-User`) to obey `robots.txt`, and Cloudflare's Verified Bots policy requires
agents to obey it too.

## Decision

**1. A program of the catalogue that calls an endpoint its operator documents for programmatic use
is judged on that operator's rules.** Programmatic use is documented by API documentation, a
published distribution URL (a schema.org `DataDownload`, DCAT), an API console, or a usage policy
that sets limits for the endpoint. The program follows:
- that documentation and its limits;
- the data's licence;
- the terms of use. A terms clause that bars automated or API clients binds the program unless an
  applicable licence, or a written authorisation, covers the use.

The program identifies itself (`userAgent({ bot: true })`), honours `429` and `Retry-After`, uses
the bulk route the operator offers, and follows no links. The Allow/Disallow lines of a
`User-agent: *` group, or of a group naming another client, do not decide such a call. A group
naming the program's own token does (decision 2).

**2. Three robots.txt signals still bind such a program:**
- a group naming its own product token, `TrackYourRegionsBot`;
- a usage signal (`Content-Usage`, `Content-Signal`) that covers the use the program makes;
- a reservation of text-and-data mining, where the program relies on the TDM exception rather than
  a licence (`docs/tech/filling-a-kind.md` § 5).

No run reads `robots.txt` today, so no run yet honours these signals. Building that check is
#2005, owed before a run calls a host whose `robots.txt` names the token, carries a usage
signal, or reserves text-and-data mining where the run relies on the TDM exception.

**3. A program that fetches HTML pages, or an endpoint its operator does not document for scripts,
is a crawler.** It follows the group naming its token, or the `*` group where no group names it
(RFC 9309 § 2.2.1), the terms, the database right and any machine-readable reservation, as
scraping does (`filling-a-kind.md` § 5).

**4. An AI agent reading pages keeps its own rules.** The coverage survey's agent obeys
`robots.txt` and the terms as its ground rules decide them
([`/coverage-survey`](../../.claude/skills/coverage-survey/SKILL.md) § Ground rules), unchanged.
`docs/sources/site-access.md` holds the agent's verdicts, not a program's. When the agent runs the
`lookup` command, that command is a program under decision 1: it calls Wikimedia's Action API with
the bot User-Agent, one request at a time.

**5. A source's record says which half applies.** The record states:
- what the host's `robots.txt` says for the path called;
- why that group does not decide the call (a crawler group, while the operator documents the
  endpoint at a cited page);
- the limits the program keeps.

A `robots.txt` that comes to name `TrackYourRegionsBot`, adds a usage signal, or reserves
text-and-data mining where the program relies on the TDM exception, changes the verdict.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| `robots.txt` binds every program, as it binds the agent | It contradicts RFC 9309's scope, the client tools and every API operator found. It would stop the Wikidata, Wikimedia, OpenStreetMap and UNESCO runs, all against the operators' own documentation. |
| `robots.txt` binds no program at all | A program that fetches pages is a crawler in everything but name, and the dissent's case is exactly that. A group naming the project's token is addressed to it, and a usage signal is meant for any client. |
| Ask every operator before calling its API | Publishing the documentation and the limits is the operator's answer. A question is owed only where the terms bar API clients and no licence covers the use. UNESCO's terms bar API clients, but the dataset's CC BY-SA licence covers the use; #2000 records that, and whether to ask UNESCO for a written confirmation as well. |
| Decide per ticket | That is how #2000 and #1996 came to read the file in opposite ways. |

## Consequences

**Positive:**
- The runs already in place are on a written footing: Wikidata, Commons, Wikipedia, Wikivoyage,
  OpenStreetMap (Overpass, Nominatim, the planet) and UNESCO.
- A source record states why a closed `*` path does not decide its call, with the operator's page
  cited.
- The survey's rules stay as strict as Anthropic's commitment, with no exemption for a fetch the
  user asked for.

**Negative / Trade-offs:**
- An operator that meant its `*` Disallow for API clients can still block the User-Agent or the
  address. The User-Agent names a contact, so that is a conversation and not a silent ban.
- Terms that fold `robots.txt` into a contract clause are read clause by clause. For UNESCO the run
  rests on the licence carve-out, and #2000 records it.
- Until #2005 lands, a group naming `TrackYourRegionsBot` would go unread. No host names it on
  2026-10-25.

## References

- Research: [2026-10-25 — What a site's robots.txt binds](../research/2026-10-25-what-a-sites-robots-txt-binds.md)
- Related ADRs: ADR-0048 (a source is a record before it is code), ADR-0134 (OpenStreetMap read
  from the planet)
- Related docs: `docs/sources/site-access.md`, `docs/sources/README.md` § The record,
  `docs/tech/filling-a-kind.md` § 5
- Issues: #2003, #2000, #1996, #1308, #2005
