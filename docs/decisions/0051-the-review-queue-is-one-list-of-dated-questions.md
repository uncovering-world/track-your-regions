# ADR-0051: The review queue is one list of dated questions, filtered and set aside per curator

**Date:** 2026-09-07
**Status:** Accepted
**Issue:** [#805](https://github.com/uncovering-world/track-your-regions/issues/805)

---

## Context

The review page's left half is the list of everything a run could not decide. It is answered by
seven statements in `reviewQueueController.ts` — missing, refused, conflicts, arrivals, held,
contents, withdrawn — plus two lists that are not open questions at all (`keptOut`,
`answeredWithdrawals`), each statement with its own `LIMIT`/`OFFSET` and its own `ORDER BY`, and
rendered under five fixed headings in a fixed order. #576 tabulated seven of those orderings and
found "newest first" true of three: `e.missing_since` for missing, `el.missing_since` for the
withdrawn points, `e.state_decided_at` for the rows a curator kept out — and the last of those is
*our decision's* date, not the question's. The others are insertion order (`e.id` for refused and
for contents, `q.id` for conflicts) or a run's id with no timestamp on it
(`e.first_seen_sync_log_id` for arrivals, `q.sync_log_id` for held). So "what came in since
yesterday" is a question the page cannot answer at all.

Measured over the queue's own predicates on the development catalogue on 2026-09-07, admin scope:
about 1 630 open questions — 1 451 held, 52 arrivals, 118 refused, 11 contents, 1 conflict, and
nothing withdrawn or missing. **1 255 of the held rows come from UNESCO run 98 of 5 September**,
every one of them proposing the same field, `metadata.criteria`. Against that stands the whole history
of answers: 27 published, 11 refusals confirmed, 3 source values accepted, 2 overrides, 1
declined. The list is a week of runs sitting on top of a curator who has answered forty-odd
questions in total, and the fixed order decides for them what they look at.

What that costs on the ground, in the sessions the queue exists for:

- **The 52 public-art arrivals of run 93 are on the last page of the gated group.** The three
  gated kinds are one group ordered by `sync_log_id DESC`, and run 98 > run 97 > run 93, so the
  rows a curator can actually publish sit behind 1 451 held ones.
- **Finding one object is scrolling and hoping.** The Memorial to the Murdered Jews of Europe
  (experience 11586) arrived on 4 September and is on the third page of arrivals. There is no
  search.
- **A rule's refusals do not group by their reason.** 118 rows over two sources and half a dozen
  recurring reasons ("inside St. Peter's Basilica: a work of a place of worship", "17 sitelinks:
  below the world tier's line"), ordered by object id.
- **28 objects sit in no region at all** — placement failed or never ran — so any region control
  has to have somewhere to put them or it hides them from everyone.

Under all of it there is one fact the seven statements never use: **every open question was asked
by a run**, and a run has `completed_at` (`experience_sync_logs`). The scope model is unchanged —
`curator_assignments` with `scope_type` global | category | region — and so is what a question
means and how it is answered (ADR-0025, ADR-0037, ADR-0038). This decision is about how a curator
reaches, orders and puts down a question, not about the question.

## Decision

**1. A question is dated by the run that asked it.** One sort key across every kind: the
`completed_at` of the run that put the question in the list, read through the pointer each kind
already has.

| Kind | The run that asked |
|---|---|
| held | the run the membership's `pending_change_sync_log_id` names |
| arrival | the run that first saw the row (`e.first_seen_sync_log_id`) |
| contents | the newest pending part's first-seen run, falling back to the object's |
| conflict | the **newest** changeset row carrying the claim (`ch.sync_log_id`) |
| withdrawn | the run that marked the points (`MAX(el.missing_since)`) |
| missing | the run that stopped finding it (`e.missing_since`) |
| refused | the run that first saw the row (`e.first_seen_sync_log_id`), whoever took the refusal; the membership's `updated_at` only where the row names no arrival run, or names one that never completed — 0 of the 118 |

Refused is the one kind that dates loosely, and the looseness is not the fallback: a refusal is
written on the membership, which has no run pointer, so **the date is the object's arrival rather
than the refusal's**. Where a later run took the refusal the row sits at its arrival's place —
older, in a newest-first list, than the act that put it there. It is dated by a fact that does not
move rather than left out of the order, and it is the kind whose age matters least — nothing about
a refusal changes until somebody answers it.

**2. The queue is one list, paged by keyset across the kinds, in two complete orders.** A
lightweight *keys* query — a `UNION ALL` of the seven kinds' `WHERE` clauses selecting only
`(kind, experience_id, asked_at, source_id, sync_log_id)` — is ordered and paged by keyset on
`(asked_at, kind_rank, experience_id)`; the existing per-kind statements then *hydrate* the page
with `e.id = ANY($ids)` instead of a `LIMIT`/`OFFSET` of their own, and the page is assembled in
the keys' order. **Newest first is the default**, grouped under day headings; the class-first
order is kept as a toggle, newest first inside each class, with the class named on every row so a
scrolled list still says which question it asks. Both are complete orders, which answers all three
of #576's wishes. The three gated kinds stay one row per object, dated by the newest of the three,
so an object is one question in either order, and a row's key stays `kind:experienceId` — stable
across refetches, which is what a deep link and a set-aside both need.

**3. Filters and their counts are answered server-side, under the filter.** Source, question kind,
region (including an **unplaced** bucket for the 28 rows in no region), run, and a search by object
name are predicates on the keys query; the facet counts are a second aggregate over that same
union, each chip carrying the number of rows it would leave. The endpoint therefore states counts
it has actually counted, and "the first N of this kind, and there may be more" stops being the
only thing the page can say. Counting in the client is not open to it: the client holds one page.

**4. A curator sets a *run's batch* aside, and the set-aside is stored per curator.** A new table
`curator_queue_set_aside(user_id, sync_log_id, created_at)`: the batch drops out of that curator's
default list, a chip says how many batches are set aside and brings them back, and nobody else's
queue changes. The unit is the run because the run is the batch — "UNESCO, 5 Sep, 1 255 open" is
one decision not yet taken, not 1 255 of them. It is self-expiring in effect rather than by a job:
the row names a run, and a run with no open rows left is not offered as a chip and hides nothing.
This is what stops run 98's `metadata.criteria` proposals burying everything else while nobody has
decided what to do with them.

**5. The list state is the page's address.** Order, search, filter set and selected row are query
parameters, built and parsed through the one address module:

```
/review?q=…&sort=date&source=3&kind=arrival&run=93&region=6737&row=arrival:11586
```

This is [ADR-0034](0034-a-place-has-an-address.md) applied, not extended — view state the visitor
set deliberately is a query parameter — and it gives the working set three things for free: a deep
link opens the same list on the same row, Back undoes a filter, and a bookmark is a saved filter.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the seven statements and add a sort switch to each | Sorting within a kind is still seven lists with seven "show more"s. It cannot put run 93's arrivals above run 98's held rows, which is the session that is broken, and a date order across kinds is a different read shape rather than a changed `ORDER BY` (#576 says so) |
| A materialised queue table, one row per open question, maintained by the runs | A second source of truth for what the seven predicates already say, and every writer that answers or re-proposes a question — publish, decline-held, accept-source, a point's verdict, the next run — would have to keep it in step. The predicates are the definition of an open question; a stale copy of them is a queue that offers cards that are not there |
| Offsets kept, with the union paged by `LIMIT`/`OFFSET` | Answering a row shifts every later row by one, so a curator working the list from the top skips one per answer. Keyset paging is what a list that shrinks while it is read needs |
| Set-aside in the browser (`localStorage`) | The point is that the batch stays out of the way *tomorrow* and on the curator's other machine. Browser storage survives neither, and it is per browser rather than per person |
| Set-aside per object, like a "done" on a row | 1 255 clicks to put run 98's criteria proposals aside, and it invites a curator to dismiss questions one at a time without answering them — which is the state the queue is meant to drain, not accumulate |
| Set-aside shared across curators | A shared "not now" hides rows from a curator who never chose it, and the scopes already differ per curator. Per curator is the honest owner of "what I am not working on" |
| Facet counts computed in the client over the page | The client holds one page of a 1 630-row queue; every count it printed would be a count of the page |
| A heading per run rather than per day in the date order | Truer, and unreadable: UNESCO run 98 and public-art run 97 finished eleven hours apart on 5 September and would raise two headings over what a curator thinks of as one day |

## Consequences

**Positive:**

- The four sessions the queue exists for are each one control: "a run just finished — what did it
  ask for my scope" is the run chip; "publish the arrivals I trust" is kind + source, now reachable
  rather than on the last page; "work through what a rule refused" is kind + source, ordered; "find
  this one object" is the search box.
- One order across the whole list, so "what came in since yesterday" is answerable for the first
  time, and the class-first order that a curator works a run of one question by is still there.
- The counts the page prints are counted, under the filter the curator set.
- The keys union carries none of the per-row weight — no jsonb laterals, no works, no context —
  and pages before hydration, where the current endpoint runs seven heavy statements whole and
  pages after its aggregates. The read is expected to get cheaper rather than dearer; the measured
  number belongs in the implementing PR.

**Negative / Trade-offs:**

- **`GET /api/experiences/review/queue` changes shape.** It gains `order`, `facets` and
  `paging.cursor` / `nextCursor`, and the seven `<kind>Offset` parameters go. `keptOutOffset` and
  `answeredWithdrawalsOffset` **stay**: those two lists are not open questions, carry no `asked_at`
  and are not in the union, so they keep their own statement and their own paging. The frontend is
  the only client, and it changes with it.
- **A new table**, `curator_queue_set_aside(user_id, sync_log_id, created_at)`, with the schema
  and migration that implies, and one more thing a curator can leave in a state they forget about
  — mitigated by the count chip, which is always on screen while anything is set aside.
- **A refusal is dated by the object's arrival, not by the refusal.** The membership carries no run
  pointer, so every refused row takes its arrival run's `completed_at`, and `updated_at` is reached
  only where the row names no arrival run, or names one that never completed — 0 of the 118 today,
  on either count. Where a *later* run took the refusal, the row therefore sits older than the act
  in a newest-first list: 96 of the 118 are dated more than a
  day before the membership was last touched, the Warsaw Uprising Monument, the Veiled Christ and
  the Giants of Mont'e Prama among them, all three arriving on 26 July and last touched on
  31 August. What the trade buys is a date that does not move — an unrelated upsert cannot walk a
  refusal up the list. Named rather than hidden; a run pointer on the refusal would fix it and is a
  change to what a refusal records, not to this list.
- The keys query re-states seven predicates that the hydrating statements state again, so a change
  to what makes a question open has two places to land in the same endpoint. They stay in one
  module for that reason, and the facet counts read the union rather than re-deriving it.
- A set-aside is invisible to other curators and to the admin's view of the same rows, so two
  curators can put the same run aside separately and neither learns the other did.

## References

- Applies: [ADR-0034](0034-a-place-has-an-address.md) — the list's state is view state a curator
  set deliberately, so it is a query parameter, and ids are canonical in it.
- Stands on: [ADR-0025](0025-per-source-curation-gate.md) — the gate that makes an arrival and a
  held proposal a question; [ADR-0037](0037-a-part-field-readers-see-is-held-like-the-objects.md)
  and [ADR-0038](0038-a-held-proposal-is-answered-per-field.md) — a held object is one card however
  many fields and parts it holds, which is why the gated kinds are one row per object;
  [ADR-0020](0020-experience-lifecycle-and-run-changeset.md) and
  [ADR-0026](0026-a-run-records-what-a-container-holds.md) — the changeset per run, which is where
  a question's run, and therefore its date, comes from.
- Related docs: `docs/tech/experiences.md` § Review Queue; `docs/tech/addresses.md`;
  `backend/src/controllers/experience/reviewQueueController.ts`.
- PR / issue: #805; the epic whose three wishes it answers: #576. A curator's home, which is where
  they arrive from: #614; the admin's activity feed over the same rows: #611.
