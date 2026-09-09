# ADR-0053: A curator's no is a verdict on an arrival and a mark on a part

**Date:** 2026-09-09
**Status:** Accepted
**Issue:** [#852](https://github.com/uncovering-world/track-your-regions/issues/852)

---

## Context

The per-source curation gate (ADR-0025) holds what a gated source proposes until a person
looks: an object nobody has passed — an *arrival* — and the unread points and works under an
object readers already see — *contents*. Publishing is the yes to both, and until #852 it was
the only answer either had. An arrival nobody wanted stayed `pending` for ever, on every
curator's list; unread contents could be released or left waiting, never turned down.

That was tolerable for a queue of a few dozen questions and stopped being so with the first
live run of the Places of worship source on 2026-09-09: 1 078 arrivals in the review feed at
once, every one of them wanting the same answer. #852 makes a review row a *proposal with two
answers* — accept it or reject it — for every kind, and lets a curator answer many at once.
The seven kinds had two answers each except these two, so the second answer had to be
designed, and the question was where to write it.

Three facts constrain the storage:

- **`admission` has two values and one writer.** `admission = 'refused'` was written only by
  a kind's own rule (ADR-0024, `admission.ts`), with a pin (`curated_fields ? 'admission'`)
  that a curator's *confirm* or *override* leaves and every later run honours. The kept-out
  list is `refused AND pinned`; `override` publishes an arrival from `pending`.
- **The parts hide by one word.** `experience_locations`, `experience_treasures` and
  `treasures` carry `curation_state IN ('pending', 'auto', 'verified')` (ADR-0025 decision 2),
  and every reader-facing read keeps an unread part off the screen with `<> 'pending'` —
  spelled in a dozen statements across the lifecycle fragments, the sync writers, the works
  writer and the catalogue checks. A fourth value would leak through each of them.
- **The audit log's `action` list is closed** (a `CHECK`), and a curator's act cannot be
  recorded at all until it is named there — the insert is in the same transaction as the
  decision.

## Decision

**1. A curator's no to an arrival is written the way a rule's refusal is.** The membership
takes `admission = 'refused'`, `admission_reason = 'kept out by a curator'`, the admission pin,
and the badge cleared, in one transaction under the place's lock. `curation_state` stays
`pending`: nobody passed it, and ADR-0025 decision 4 asks that "our rule said no" and "nobody
has looked" be said as two facts rather than one folded into the other. The row leaves the
queue for the kept-out list at once, every later run honours the answer, and *Put it back* —
the existing `override` — is the way back, publishing the arrival as it always has (ADR-0025
§ 4.5). The log names the act `arrival_refused`, one word apart from `admission_confirmed`,
because a reader scanning a history has to tell "agreed with the rule" from "turned it down
myself".

**2. A curator's no to an unread part is a mark beside its state, never a fourth state.**
`experience_locations` and `experience_treasures` gain `refused_at TIMESTAMPTZ` (NULL = not
refused). A refused part keeps `curation_state = 'pending'`, so every reader hides it by the
word it already reads and no reader changes. What the mark changes is the *question*: "unread
and still asked about" is spelled once — `unreadPointSql` and `unreadLinkSql` in
`waitingCounts.ts`, `curation_state = 'pending' AND refused_at IS NULL` — and composed by the
queue's predicate, its keys, the contents card, the waiting count and the three publish
statements, so a later whole-object publish cannot release what a curator turned down. The
mark sits on the *link* for a work, not on the work: "not this work here" is the link's axis,
and the work stays askable at every other venue that holds it. The link's own `curation_state`
goes to `pending` with the mark: a link is unread on either axis (ADR-0025 decision 2), so one
whose own state is `auto` can be refused here because its *work* is pending — and the work is
one row for every venue, published from whichever venue passes it first. Readers never read the
mark, so a refused link left `auto` would surface the day the work is published elsewhere;
`pending` says what is true — nobody passed this work *here* — and keeps the one reader word
the mark relies on. A refused *point* releases the withdrawal it may have been holding: a gated
source that moves a point writes the new one `pending` and defers the old one's withdrawal onto
it, so readers keep the old pin until the arrival is answered — and only the publish released
that pairing. The refusal releases it the same way, in the same transaction (`missing_since`
on the old row, the pairing cleared), so the old point becomes what it is, a withdrawn point
asking its own question (ADR-0026), rather than a pin the source dropped standing on the map for
ever with no card about it. The other direction holds too: a refused point is still `pending`,
which is exactly what made it eligible to *hold* a later withdrawal (`locationWriter`'s
`arrived` set), and a withdrawal held on a point nothing will ever publish could never be
released — so that set carries `refused_at IS NULL`, the one writer beside the six readers of
the question that composes the mark. **Placement is the other writer.** A pending point is
placed into regions on purpose (ADR-0025 decision 5) because it is about to be published; a
refused one never will be, so placement's insert carries `refused_at IS NULL` too — a region
must not count a place nobody will be shown — and a refusal that reached a point re-places the
object after its commit, through the same `placeAfterRelease` the publish uses, which also
drops the rows of the pin it released. Readers stay untouched: what they hide by is still
`pending`; what changes is what a *region counts*, which was never a reader's read. The log
names the act `contents_refused`, with the counts — the withdrawals released among them — and,
where the caller named them, the ids.

**3. The batch answer re-asks the writer's question, never its own.** `POST
/api/experiences/review/answer` takes a page of rows and one answer and dispatches each row to
the `*UnderLock` function its own card calls — the same statements, the same lock, the same
refusals. A `waiting` row's sub-kinds are read from the membership rather than taken from the
client; the held and conflict writers compare the run the curator saw with the pointer; the
verdict writers take the `expected` block an open row means. Each object is its own act, so
one refusing is one line in the report and the rest are answered.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A fourth `curation_state` value, `refused`, on the part tables | Every reader hides a part by `<> 'pending'`, in a dozen statements the sync writers and catalogue checks spell for themselves. A new word is a leak through each of them until every one is found — and the first one missed puts a refused painting on a museum's wall |
| A curator's refusal of an arrival as a state of its own (`curation_state = 'refused'`) | The same leak one table up, and it would fold the two axes ADR-0025 decision 4 keeps apart: the row *is* refused (a verdict about belonging) and *is* unread (nobody passed it). Writing it on `admission` says both and reuses the pin, the kept-out list and the way back |
| Deleting a refused part | ADR-0022: a row is what a person's viewed record points at, and what a later run would re-insert as new. A mark is one UPDATE to take back; a delete is a run's worth of re-import |
| A refusal that expires, or that a later run clears | The point of the answer is that the next run meets a person's decision rather than asking again. A part the source proposes under a *different* identity is a new row and a new question by itself |
| The batch deciding what each answer does with statements of its own | Two spellings of every verdict, drifting from the day they are written. The `*UnderLock` extraction (#852's first commit) exists so the batch can call what the card calls |
| Rows sent as `"kind:id"` strings | The held and conflict writers need the run the curator saw, or a proposal replaced in between is answered under the wrong run; the key alone does not carry it |

## Consequences

**Positive:**

- Every review row has the same two answers, and a curator answers a run of 1 078 arrivals
  as one decision with one report, rather than 1 078 clicks or none.
- No reader-facing read changes. The refusal of a part is invisible to every visitor exactly
  as the unread part was, and the whole change to what is *offered* lives in two fragments.
- The kept-out list, the pin, the take-back and the run-honours-the-answer property come free
  for a refused arrival, because it is written as the refusal the readers already know.

**Negative / Trade-offs:**

- **A refused part has no screen yet.** Nothing lists refused points or works to a curator, so
  the take-back is a follow-up; the mark is a column, so it is one UPDATE when that screen
  exists. Until then the curation log is where a refused part is found again.
- A refused arrival carries a curator's reason in the log and a fixed reason on the
  membership, and `override` clears the reason as it does for a rule's — the log is the
  record of who and why.
- `unreadPointSql` / `unreadLinkSql` are one more pair of fragments a statement has to compose
  rather than spell; `statementNamesDeclaredColumns.test.ts` catches a literal that names a
  column the schema lacks, not one that spells the predicate without the mark.

## References

- Stands on: [ADR-0024](0024-a-category-may-refuse-what-the-source-still-lists.md) — the
  admission axis and its pin; [ADR-0025](0025-per-source-curation-gate.md) — the gate, the
  three states on four tables, and decision 4's two questions;
  [ADR-0022](0022-locations-are-marked-not-deleted.md) — marked, never deleted; [ADR-0051](0051-the-review-queue-is-one-list-of-dated-questions.md) — the feed the
  batch answers rows of, whose decisions this narrows in no part.
- Related docs: `docs/tech/experiences.md` § Review Queue; `docs/tech/rate-limiting.md` § 5;
  `backend/src/controllers/experience/curatorRefusalController.ts`,
  `reviewAnswerDispatch.ts`, `reviewAnswerController.ts`.
- PR / issue: #852.
