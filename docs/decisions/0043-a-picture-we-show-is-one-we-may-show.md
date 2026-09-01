# ADR-0043: A picture we show is one we may show

**Date:** 2026-09-01
**Status:** Accepted

---

## Context

The catalogue shows a photograph on nearly every card, and until this decision
four in five of them were the World Heritage Centre's own. Measured on the live
dev database on 2026-09-01: 1260 of the 1591 experience pictures pointed at
`whc.unesco.org/document/<id>`, 331 at Wikimedia Commons; all 1324 pictures of
works pointed at Commons. One of the 1591 carried a credit.

Issue #557 was opened about those 1260 answering 403, then re-measured twice as the
portal changed its behaviour: the pictures loaded, then the thumbnail proxy
loaded them, and what remained was a free third-party resizer (`wsrv.nl`) on
the reader's path with no agreement behind it, and a sync that stored whatever
URL the source called an image. The route being weighed was where to resize the
pictures.

Reading the source's terms changed the question. The World Heritage Centre's
[terms](https://whc.unesco.org/en/disclaimer/), verbatim:

> All photographs and other elements of the UNESCO World Heritage Centre website
> are protected by international treaties on intellectual property and other
> applicable laws. The elements it displays may not be copied or retransmitted
> by any means without explicit authorisation from the World Heritage Centre or
> the copyright holders.
>
> Do not incorporate any content from this site into your site (e.g., by
> in-lining, framing or creating other browser or border environments around
> UNESCO/WHC content). You may only link to, not replicate content.

And of the photographs specifically: "Not property of UNESCO, property of third
parties, copyright holders, who authorize the UNESCO World Heritage Centre to
display and distribute them. Any use of photographs requires a separate request
for authorization".

So every route under consideration was on the wrong side of those terms.
Hotlinking is the in-lining the linking policy names; a resizing proxy makes a
copy and retransmits it; a variant stored at sync time is a copy. The one thing
the terms invite — a link to the property's own page — the catalogue already
holds on every row, as `metadata.website`.

Wikimedia Commons is the opposite case: its files are published under licences
written to be reused, asking the one thing `ImageCreditLine` already does — that
the author is named where the picture appears. And Wikidata states a Commons
picture (P18, "image") for World Heritage properties keyed by the same id the
catalogue is keyed by (P757, "World Heritage Site ID"). Measured the same day:
1131 of the 1260 by the site's own number, 1206 once a later numbering of the
same property is read (`166rev` is the Sydney Opera House, `292bis` Cologne
Cathedral, whose `292` is not the best-ranked statement), 1220 — 96.8 % — once
the lowest-numbered component of a serial property stands in for it. Of the 40
left, 38 have a Wikidata item, 16 a Commons category, 17 a part with a picture:
pools a person can choose from, not statements a run can act on.
`Category:Wudang Mountains` opens with a portrait of a person; Openverse
answers "Deer Stone Monuments" with a cemetery in New Orleans and licenses
Victoria Falls `by-nc-nd`.

## Decision

1. **The catalogue stores and shows only pictures it is licensed to show.** A
   picture is a file on a host whose terms permit reuse with attribution —
   today Wikimedia Commons, as `DISPLAYABLE_PICTURE_HOSTS` in
   `backend/src/types/urlSafety.ts` and `TRUSTED_IMAGE_DOMAINS` in
   `frontend/src/utils/imageUrl.ts`, pinned to each other by a test, naming a
   picture file — or, for a person, an `/images/…` path on our own origin, the
   one local shape the drawing side maps. The World Heritage Centre's
   photographs are linked to, by
   the property page every row already carries, and never in-lined, proxied or
   copied.

2. **A World Heritage property's picture comes from Commons through Wikidata,
   matched by the property's own id and by nothing looser.** The site's number
   first, then a later numbering of the same property, then its lowest-numbered
   component — UNESCO's own ordering of a serial property's parts, not a query
   planner's — and the choice is deterministic at every step, because on a gated
   category a picture that changed between runs is a proposal somebody has to
   answer. No keyword search over an aggregator, no file picked out of a
   category: the remainder is a curator's decision, and the product says which
   objects have none rather than guessing one.

3. **Whatever writes `image_url` holds the line, at the writer, and there are
   two lines.** A run writes the column through no request schema at all, which
   is how 1260 rows came to carry a picture nobody had checked. So the rule is
   applied where the value is written: the sync upsert for the three experience
   collectors, the works writer and the picture repairs hold the run's rule
   (`isCommonsPictureUrl` — a Commons picture file and nothing else, since no
   run writes a path of ours); the curator's edit and publishing a held
   proposal hold the person's (`isDisplayablePictureUrl`, which adds the
   `/images/…` path). A refused picture takes its credit with it. A stored URL
   says which host it names and, on Commons, which kind of file; that is the
   evidence a run needs before it stores one.

4. **Repairing what is stored is an operator's action, not a run's proposal.**
   UNESCO is a gated category, so a run offering a Commons picture for a visible
   row files a held proposal; 1260 rows carrying a picture the product may not
   show are not 1260 questions for a curator. The admin panel's *Fix pictures*
   writes now — a Commons picture with its credit where Wikidata states one, and
   nothing where it does not — and never touches a picture a curator owns.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Our own resizing endpoint (`sharp` is a dependency) with a disk cache | Every copy it makes and serves is what the terms forbid; it also adds a public endpoint whose SSRF surface, cache and rate-limit budget the reader path would inherit. |
| A sized variant stored at sync time | The same copy, made earlier and kept longer, plus a backfill and a redistribution question the terms answer with "no". |
| Keep `wsrv.nl` and record the dependency in an ADR | Leaves the reader path on a free service with no agreement that answered one URL three ways in three weeks — and it is still in-lining. |
| Ask the World Heritage Centre for written authorisation | Worth asking, and not something a pull request can do; tracked as a human-led follow-up (#746). Their photographs could return as a second source if it is granted. |
| Fill the remainder from a Commons category, the property's parts, or a licence-filtered aggregator | Measured: a category's first file can be a stranger's portrait, a Wikidata part list has no order to choose by, and an aggregator answers the wrong place under non-commercial and no-derivative terms. Candidates for a person, not for a run — tracked as a follow-up (#745). |

## Consequences

**Positive:**
- 1220 of the 1260 World Heritage cards keep a picture, and every one of them
  is credited for the first time — the catalogue's own `picture-with-nobody-credited`
  assertion counted 2911 uncredited pictures on 2026-08-24.
- No third-party resizer on the reader's path: Commons serves its own sizes
  through `Special:FilePath?width=`, and the only branch that reached `wsrv.nl`
  had nothing left to route.
- The best-rank trap fixed for the picture is fixed for the article too: 366 of
  1272 rows had no Wikipedia link for the same reason, and the one query that
  now answers both reads every rank.
- A source that starts calling something else an image is refused at the
  writer, loudly in the log, rather than stored.

**Negative / Trade-offs:**
- 40 World Heritage cards show no picture. Honest, and the link to the
  property's page stands, but a reader notices a card with none.
- A component's photograph standing in for a serial property is a picture of
  one part of it. The report says which part answered; a curator can replace it.
- A curator can no longer store a picture from an arbitrary host. They could
  before, and the rendering side silently drew nothing for it; the refusal is
  now said out loud at the point of decision.
- A run's Wikidata query grew from one column to two and reads seven thousand
  rows; measured at 6.7 s and 1.8 MB, once per run.

## References

- Related ADRs: ADR-0025 (a gated source proposes rather than writes),
  ADR-0037 (a visible field is held), ADR-0040 (an order nobody chose is not a
  claim — the reason the picture choice is deterministic)
- Related docs: `docs/tech/experiences.md` § Pictures, `CLAUDE.md` § Experience
  Images, `docs/tech/data-assertions.md` (picture-with-nobody-credited)
- PR / issue: #557
