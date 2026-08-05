# Slice A — the bench content — SPEC + PLAN

**Status:** specified, not implemented. Local working document, never committed.
**Wider context:** `review-queue-redesign.md`. **Depends on:** slice F (#500) for the two new
item kinds, though A is implementable without it and degrades to the two existing kinds.

UI and one endpoint's payload. **No schema change.**

---

# SPECIFICATION

## 1. What is wrong today, from working the screen

These come from curating four real conflicts during the slice-5 live run (UNESCO run 41:
Aksum, Berlin Modernism Housing Estates, Garamba National Park, Getbol), not from review.

1. **The screen asks for a decision and withholds what the decision rests on.**
   `describe()` (`ReviewQueue.tsx:298`) cuts every value at 120 characters. Aksum's conflict
   was 200 characters of curator text against 511 of source text; nothing on the page could
   compare them. No diff, no way to expand.
2. **Acceptance is all-or-nothing per object.** `accept.mutate(proposed.map(f => f.field))`
   (:266) sends every proposed field. If the source improved the description and damaged the
   name, there is no way to take one. **The API already accepts a field list** — only the UI
   cannot express it.
3. **The object itself is absent.** No image, no coordinates, no link to the source page. To
   judge whether the source's description is better, the curator cannot look at the thing.
4. **No provenance.** The run and its time appear only *after* acting, in the outcome alert.
   Who claimed the field and when is never shown — and the button says "my edit" even when
   another curator made it.

## 2. What it becomes

### 2.1 Per-field rows, not per-object cards

Each conflicted field renders its own row: field label, both values **in full**, a word-level
diff, and its own pair of actions. Object-level "accept all" / "keep all" stay as a
convenience for the common case where every field goes the same way.

`describe()` is deleted. Long values are shown, not summarised — that is the whole point of
the screen. The diff carries the reading load that truncation was standing in for.

Fields the endpoint reports as `acceptable: false` (`location`, the country arrays,
`metadata`) keep their existing note that accepting releases the claim and the next run
applies the value.

Where slice F has landed, a field may carry both `held: true` and `curatedConflict: true`.
They are different sentences to a curator and must read differently:
*"the source proposes this and is waiting for you"* versus *"the source disagrees with what
you wrote"*.

### 2.2 Object context

A compact header block above the fields:

- thumbnail from `image_url`;
- coordinates, with a link that opens the object on the map;
- the source page — **`metadata.website`**, and Wikipedia — **`metadata.wikipediaUrl`**.
  These are metadata keys, **not** columns; there is no `website_url` column and an earlier
  draft of the wider spec said there was. `metadata.wikidataQid` gives a Wikidata link for
  the two Wikidata-derived sources;
- region breadcrumb from `experience_regions`.

Every one of these is user-facing external data and must be escaped and, for the links,
scheme-checked (`http:`/`https:` only). A source-supplied `javascript:` URL rendered into an
anchor is stored XSS.

### 2.3 Provenance

**No new storage** — all of it is already in `experience_curation_log` and the changeset:

- which run proposed this, and when — `sync_log_id` on the queue item plus the log's
  `completed_at`;
- who claimed the field and when — the most recent `edited` entry whose `details` names the
  field;
- previous decisions on the same field — `accepted_source` entries, and `kept_mine` once
  slice B exists.

The queue endpoint gains these as read-only fields. The button label stops saying "my edit"
and names the curator instead.

## 3. Out of scope

- The master–detail layout and the drainable queue — slice B. A stays inside the existing
  card list so the two slices do not collide in one file.
- Cross-item patterns ("this same proposal appears in N other objects"). Considered and
  dropped: it needs a grouping model nothing else here has.

---

# PLAN

Branch `feat/review-bench-content`. Six commits.

## Task A1 — a word-level diff, without a dependency

**Files:** create `frontend/src/utils/wordDiff.ts` and `wordDiff.test.ts`.

The project has **no diff library** (checked: nothing in either `package.json`). Adding one
would need an ADR — "choosing a library" is on the ADR list in `CLAUDE.md` — and would widen
the supply-chain surface that `npm audit`, Semgrep and Trivy all watch. A word-level LCS over
values of this size is about fifty lines. Write it.

If a reviewer would rather have `jsdiff`, that is a legitimate call, but it is an ADR and a
dependency review, not a drive-by import.

- [ ] **A1.1** — tests first: identical strings produce one unchanged run; a replaced word
  produces removed-then-added; leading and trailing whitespace is preserved in the tokens; an
  empty old value produces one added run; 5000-word inputs finish (guard the complexity — LCS
  is O(n·m), so cap tokens and fall back to a whole-value replace beyond the cap, and test
  that fallback).
- [ ] **A1.2** — implement: tokenise on whitespace boundaries keeping the separators, LCS,
  emit `Array<{ type: 'same' | 'added' | 'removed'; text: string }>`.
- [ ] **A1.3** — commit. `front: Add a word-level diff for comparing curator and source text.`

## Task A2 — the endpoint carries what a decision needs

**Files:** modify `backend/src/controllers/experience/lifecycleController.ts` (`getReviewQueue`
at :68).

- [ ] **A2.1** — add to both existing selects (and to slice F's two, if that has landed):
  `e.image_url`, `ST_X(e.location) AS lon`, `ST_Y(e.location) AS lat`,
  `e.metadata->>'website' AS website`, `e.metadata->>'wikipediaUrl' AS wikipedia_url`,
  `e.metadata->>'wikidataQid' AS wikidata_qid`, and the run's `l.completed_at AS proposed_at`.
- [ ] **A2.2** — region breadcrumb. One correlated subquery returning the region names for the
  object, ordered root-first. Do **not** add a second round trip per item — the queue renders
  25 at a time. If the recursive walk is awkward inline, add a small helper next to
  `CURATOR_SCOPED_REGIONS_CTE`, which already knows how to walk the region tree.
- [ ] **A2.3** — provenance. A lateral join onto `experience_curation_log` for the most recent
  `edited` entry naming each field, plus any prior `accepted_source` on this object. Return as
  a jsonb array on the item; do not build a second endpoint for it — a card that has to fetch
  its own provenance turns 25 cards into 26 requests.
- [ ] **A2.4** — the curator's name comes from `users`, and the response must carry the
  display name only. No email, no id beyond what the UI needs. (`docs/security/SECURITY.md` —
  never widen a payload with personal data because it was one join away.)
- [ ] **A2.5** — tests: the payload carries the new fields; an object with no curation log
  returns an empty provenance array rather than null; an object with no regions returns an
  empty breadcrumb.
- [ ] **A2.6** — commit. `back: Give the review queue what a decision actually rests on.`

## Task A3 — FieldDiff

**Files:** create `frontend/src/components/curation/FieldDiff.tsx` + test.

- [ ] **A3.1** — renders one field: label, the two values in full, the word diff, and its own
  Accept / Keep pair. Long values scroll inside their own container rather than stretching the
  card.
- [ ] **A3.2** — the two sentences from § 2.1, chosen by the field's flags: `held` without
  `curatedConflict` reads "the source proposes this"; `curatedConflict` reads "the source
  disagrees with your edit"; both true reads as the disagreement, because that is the part
  needing a judgement.
- [ ] **A3.3** — `acceptable: false` keeps its existing note verbatim; do not reword it. The
  wording was argued over in #487 and says something precise about releasing the claim.
- [ ] **A3.4** — per-field accept calls the existing endpoint with a one-element array. This
  is the whole of finding 2 — the API has always accepted it.
- [ ] **A3.5** — commit. `front: Show each disputed field in full, with a diff and its own actions.`

## Task A4 — ObjectContext

**Files:** create `frontend/src/components/curation/ObjectContext.tsx` + test.

- [ ] **A4.1** — **read `docs/tech/shared-frontend-patterns.md` and list
  `frontend/src/components/shared/` first.** A thumbnail-and-links row may already exist;
  `CoverageMapPreview` in `components/admin/` is the precedent for a small map preview. Reuse
  before creating is a project rule.
- [ ] **A4.2** — thumbnail, coordinates, breadcrumb, and the external links.
- [ ] **A4.3** — scheme-check every external URL before rendering it as an anchor: allow
  `http:` and `https:`, drop anything else. These values come from a third-party source, and
  the failure mode is stored XSS. Add `rel="noopener noreferrer"` and `target="_blank"`.
- [ ] **A4.4** — the map link goes to the object's region rather than opening a second map
  instance; check how `ExperienceList` builds its map links and match it.
- [ ] **A4.5** — commit. `front: Put the object itself on the review screen.`

## Task A5 — ProvenanceTrail

**Files:** create `frontend/src/components/curation/ProvenanceTrail.tsx` + test.

- [ ] **A5.1** — "Proposed by run 41, 4 August 14:12", "Claimed by <name>, 2 August", "You
  accepted the source on this field on 1 August".
- [ ] **A5.2** — the button label stops saying "my edit". It names the curator, and says
  "your edit" only when the ids match. Getting this wrong is how the screen currently lies to
  a curator about who wrote something.
- [ ] **A5.3** — commit. `front: Say who claimed a field and which run is proposing.`

## Task A6 — wire it up and delete `describe()`

**Files:** modify `frontend/src/components/curation/ReviewQueue.tsx` and its test.

- [ ] **A6.1** — `ConflictCard` composes `ObjectContext`, the `FieldDiff` rows and
  `ProvenanceTrail`. `MissingCard` gets `ObjectContext` and `ProvenanceTrail` too — "is this
  place gone" is exactly the question a picture and a source link help answer.
- [ ] **A6.2** — delete `describe()` and its call sites. It is the finding, not a helper.
- [ ] **A6.3** — object-level "accept all" / "keep all" remain, above the field rows.
- [ ] **A6.4** — `ReviewQueue.tsx` is 302 lines and this adds to it. The guideline is ~500,
  and slice B splits the file properly. If A pushes past ~450, pull `ConflictCard` and
  `MissingCard` into their own file now rather than leaving B a bigger job.
- [ ] **A6.5** — update `ReviewQueue.test.tsx` (264 lines): the truncation assertions go, the
  per-field assertions arrive.
- [ ] **A6.6** — docs: `docs/tech/experiences.md` § Review Queue describes what the screen
  shows; update it. `docs/vision/vision.md` — this is a curator-facing change.
- [ ] **A6.7** — commit. `front: Compose the review card from field, context and provenance.`
  and `Document what the review screen shows.`

## Verification

Automated tests cannot tell whether the screen is usable. Reproduce the four objects from the
live run — Aksum is the one with 200 characters against 511 — and check that a decision can be
made from the screen alone, without opening the database or the UNESCO site in another tab.
That was the actual failure.
