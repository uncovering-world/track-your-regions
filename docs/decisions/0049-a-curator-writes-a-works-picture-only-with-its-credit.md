# ADR-0049: A curator writes a work's picture only with its credit

**Status**: Accepted
**Date**: 2026-09-06
**Issue**: [#731](https://github.com/uncovering-world/track-your-regions/issues/731)

## Context

[ADR-0040](0040-a-work-names-every-one-of-its-makers.md) decision 6 gave a curator a way to
correct a work's attribution and deliberately withheld one thing: `image_url` is claimable
on `treasures` but was not writable through
`PATCH /api/experiences/:id/works/:treasureId/edit`. The reason it gave is right and still
is — a hosted picture carries a credit ([ADR-0043](0043-a-picture-we-show-is-one-we-may-show.md)),
the credit beside a work is `metadata.imageCredit` fetched from Commons for the file the
*source* offered, and writing a URL without answering for whose photograph it is would
print one photographer's name under another's work.

What that reasoning did not settle is whether the answering could be done. Two facts, both
already true when 0040 was written, say it can:

- `editExperience` has resolved a credit for an object's picture since #557: it calls
  `creditForOneImage` outside the transaction and writes `image_url` and
  `metadata.imageCredit` in one statement, so no row ever holds one photograph under
  another photographer's name.
- `treasureWriter`'s upsert already keeps a work's **own** `metadata` whenever
  `curated_fields ? 'image_url'` — the claim that protects a curator's picture protects
  the credit beside it, without a second key.

So the machinery existed on both sides of the work and only a writer was missing. Meanwhile
issue #731 put the correction on a screen, where the gap is not academic: a curator looking at a
work whose picture is wrong has the file in front of them and the endpoint refuses it, and
"the picture is corrected somewhere else" is not somewhere that exists.

## Decision

**A curator may write a work's picture, and the credit is written with it — never without.**

`PATCH /api/experiences/:id/works/:treasureId/edit` takes `imageUrl` alongside `name`,
`artists` and `year`. The endpoint resolves the credit itself:

1. `imageUrl` is bounded by `safeImageUrlSchema`, the same field the object's edit takes: a
   Wikimedia Commons file or an `/images/` path on this origin, normalised to the spelling
   the drawing side reads. `''` clears the picture.
2. `creditForOneImage` is called **before the transaction opens** — a lock held across a
   request to somebody else's server is held for as long as they take.
3. `image_url` and `metadata.imageCredit` are written in one statement, so the two are
   never separately visible. Clearing the picture writes a `null` credit rather than
   leaving the old one.
4. The claim is `image_url` alone. A credit key would be one nothing reads, since the run
   already honours the picture's, and one more thing for `accept-source` to release.
5. The reply carries the credit that was resolved, because it can be `null` — Commons may
   name nobody, or may not answer inside the five seconds — and a screen that assumed a
   name would show a picture as credited to nobody without saying that is what happened.

**The credit is never in the request body.** It belongs to the file; a client that could
name one would be a client that could credit a photograph to anybody.

This narrows decision 6 of ADR-0040 and leaves the rest of it standing.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave the picture out, as 0040 decided | The reason was about the credit, not about the picture, and the credit can be answered for. Leaving it out sends a curator holding the right file to a screen that does not exist. |
| Take the credit in the body beside the URL | A client that can name a photographer can credit a photograph to anybody, which is the licence obligation inverted rather than met. |
| Resolve the credit inside the transaction | It is a request to somebody else's server; the row lock would be held for as long as Commons takes to answer. |
| Fetch the credit after the commit, in a second write | There would be a moment — and, if the second write failed, permanently — in which the row held one photograph under another photographer's name. That is the one thing this may not do. |
| Claim `metadata.imageCredit` separately, as an experience does | On a work the picture's claim already protects the metadata (`treasureWriter`), so the key would be read by nothing and released by nobody. |

## Consequences

**Positive:**

- A curator correcting a work corrects all of it, from the screen where they are looking at
  it, rather than three fields there and the picture nowhere.
- The licence obligation is met by construction rather than by discipline: there is no path
  through this endpoint that writes a photograph without answering for who took it.
- The reach is ADR-0025 decision 2's, unchanged: a work is passed once, globally, so a
  picture corrected from one museum is the picture every museum holding it carries.

**Negative / Trade-offs:**

- A curator's Save now waits on Commons, bounded at five seconds. A picture whose credit
  request times out is stored with none, and the screen says so rather than implying a
  credit exists.
- One more writer of `image_url` to keep to the host rule (`isDisplayablePictureUrl`), which
  `urlSafety.test.ts` pins on both stacks.
