# Slice E — notifications — SPEC + PLAN

**Status:** curator half specified and ready; **reader half blocked on one decision** (§ 3).
Local working document, never committed.
**Wider context:** `review-queue-redesign.md`. **Depends on:** slice F (#500) for what counts
as waiting work, and slice 4 (merged) for what a reader has already been shown.

Nikolay's framing, recorded verbatim because the second half is easy to lose:

> "надо куратору кидать нотификейшн в правом нижнем углу когда есть что-то на курирование.
> И тот же механизм нотификации я бы сделал для пользователей когда появились новые
> экспириенсы, которые он ещё не видел"

One mechanism, two audiences.

---

# SPECIFICATION

## 1. The chain this closes

**sync → assignment → the right curator is told there is work → they can decide it.**

Assignment closed in slice C (PR #495). *Being told* does not exist at all: a curator learns
there is work by opening `/review` and looking. This is the last link.

## 2. The curator toast

A toast, bottom-right, when there is work in this curator's scope.

**Counted through the same scope filter as the queue itself** — `curatorUnrestrictedScopeExists`
OR the region intersection (`lifecycleController.ts:77-83`). A count that ignores scope shows
a region curator work they cannot open, and there is no way for them to discover why. This is
not an implementation detail to get right later; notification and scoping are one feature.

Measured, so the shape is not guessed (fixtures on the live database, an unassigned UNESCO
site):

| role | of 3 open conflicts | an unassigned experience |
|---|---|---|
| admin | 3 | can see |
| category curator (UNESCO) | 3 | **can see** |
| region curator (Africa) | 2 | **cannot see** |
| global curator | 3 | can see |

**Blocking kinds only.** After slice F the queue carries `arrival`, `held`, `conflict` and
`missing` — work somebody is waiting on — beside a backlog of 1603 `auto` rows nobody has
checked. A toast that counts the backlog says "1603" on the first day and is ignored forever
after. Count the four; leave the backlog to the screen.

## 3. The reader toast — **the open decision**

The data exists and needs no new storage. `user_new_badge_views` records exactly what a reader
has been shown, so "new and unseen" is `is_new` with no impression row for that user. The chip
and the toast are the same question at different granularity.

What is **not** decided is what makes a new experience *relevant*. A reader tracking Europe
does not want a toast about 25 arrivals in Asia.

Candidates, with what each costs:

| scope | storage | what it says |
|---|---|---|
| **regions the reader has visited**, descendant-aware | none — `user_visited_regions` and `user_visited_experiences` → `experience_regions` both exist | "somewhere you have been has something new" |
| the region currently open | none | not really a notification — the list is already on screen |
| an explicit follow | a new table and a UI to manage it | the most precise, and the most to build |

**Recommendation: the first, using both visit tables.** Measured on the dev database today:
`user_visited_regions` has **0** rows and `user_visited_experiences` has **3**, across 4
users. So the direct-region half would notify nobody, and the indirect half — regions
containing an experience the reader visited — is the only one that would fire at all. That is
an argument for including both from the start, not for deferring one.

Descendant-aware: a reader who visited France should hear about an arrival in Paris. A reader
who visited Paris should not hear about Lyon. `getExperiencesByRegion` already does
descendant-aware filtering for `includeChildren`; reuse that shape rather than inventing one.

**This must be settled before the reader half gets built.** The curator half does not depend
on it and can ship first.

## 4. One mechanism

Both audiences get the same component and the same delivery: a poll on a modest interval while
the app is open, and a toast that can be dismissed and does not return for the same items.

Not WebSockets. There is no server push anywhere in this codebase, the interval that matters
here is minutes, and adding a transport for one feature would be an ADR of its own.

"Does not return for the same items" is the part that decides whether this is useful or
irritating:

- **curators** — dismissal is per (curator, highest item id seen). A new item raises it again;
  the same items do not.
- **readers** — `user_new_badge_views` already answers it. Showing the toast records the
  impressions, so the same arrivals never toast twice. Note the consequence: the chip and the
  toast then share one impression record, so a toast the reader never looked at still spends
  their week. Decide deliberately — the alternative is a separate impression table for toasts,
  which is real storage for a small gain.

## 5. Out of scope

- Email or push. In-app only.
- A notification centre or history. One toast, dismissible.

---

# PLAN

Branch `feat/curation-notifications` for the curator half. The reader half waits on § 3 and
gets its own branch.

## Task E1 — the count endpoint

**Files:** modify `backend/src/controllers/experience/lifecycleController.ts`,
`backend/src/routes/experienceRoutes.ts`.

- [ ] **E1.1** — `GET /api/experiences/review/count`, `requireAuth` + `requireCurator`.
  Returns `{ arrivals, held, conflicts, missing, total, latestItemId }`.
- [ ] **E1.2** — **reuse the queue's scope filter verbatim.** Extract it from `getReviewQueue`
  into a named helper both call, rather than copying the expression. A copy is how the two
  drift, and a drifted count is a curator seeing a number they cannot act on.
- [ ] **E1.3** — count blocking kinds only. Add a comment saying that the `auto` backlog is
  deliberately excluded and why (1603 on day one) — the omission will otherwise read as a bug.
- [ ] **E1.4** — `latestItemId` is what dismissal is measured against: the highest `id` among
  the counted items.
- [ ] **E1.5** — this endpoint is polled. Keep it to counts — no joins for names, no `proposed`
  aggregation. Check the plan against `EXPLAIN` on the live database if it is not obviously
  index-covered.
- [ ] **E1.6** — tests: a region curator's count excludes an unassigned experience; an admin's
  does not; the backlog is excluded; the count matches what the queue returns for the same
  user.
- [ ] **E1.7** — commit. `back: Count the review work in a curator's own scope.`

## Task E2 — the toast

**Files:** create `frontend/src/components/shared/NotificationToast.tsx` (or extend what is
there); modify the app shell.

- [ ] **E2.1** — **read `docs/tech/shared-frontend-patterns.md` and list
  `frontend/src/components/shared/` first.** MUI `Snackbar` is almost certainly already used
  somewhere; a second notification mechanism beside an existing one is the thing this project
  explicitly warns against.
- [ ] **E2.2** — poll with TanStack Query while a curator is signed in. Interval in minutes,
  not seconds; `refetchOnWindowFocus` is the useful half of this, not the timer.
- [ ] **E2.3** — dismissal state per curator, keyed on `latestItemId`, in `localStorage`. Not
  server-side: it is a UI preference, it is worthless across devices, and a table for it would
  need its own migration and cleanup.
- [ ] **E2.4** — the toast names the work and links to `/review` with the right filter applied.
  "3 objects waiting for approval" is actionable; "you have notifications" is not.
- [ ] **E2.5** — do not poll for anonymous readers or non-curators. Check the role before the
  query is enabled, not inside it.
- [ ] **E2.6** — tests: renders on a non-zero count; stays dismissed until `latestItemId`
  rises; never mounts for a non-curator.
- [ ] **E2.7** — commit. `front: Tell a curator when there is something waiting.`

## Task E3 — docs

- [ ] **E3.1** — `docs/tech/experiences.md`: the count endpoint and its scope rule.
- [ ] **E3.2** — `docs/vision/vision.md`: curators are told rather than having to look.
- [ ] **E3.3** — commit. `Document how a curator learns there is work.`

## Task E4 — the reader half — **DO NOT START until § 3 is answered**

Sketch only, so the shape is not re-derived when the answer arrives:

- `GET /api/experiences/new/count` — `is_new` (which after slice F means `published_at` inside
  the window) AND no `user_new_badge_views` row for this reader AND inside the relevance scope
  chosen in § 3.
- The same toast component, different copy and a link to the region rather than to `/review`.
- Showing it records the impressions, which is what stops it repeating — with the consequence
  named in § 4 accepted deliberately, or a separate impression table added if it is not.
- Anonymous readers get nothing: there is nobody to remember, which is the same reason
  `isNewSql` gives anonymous readers the category window alone.

## Verification

The curator half is only useful if the number is one a curator can act on. Sign in as the
region curator from § 2's table, confirm the toast says 2 and not 3, and confirm that opening
it lands on exactly those two.
