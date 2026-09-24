# ADR-0067: Accepting a refusal keeps it, and a batch answer pins nothing

**Date:** 2026-09-24
**Status:** Accepted
**Issue:** [#906](https://github.com/uncovering-world/track-your-regions/issues/906)
**Narrows:** [ADR-0053](0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md) decision 3

---

## Context

ADR-0053 made every review row a proposal with two answers, and let a curator answer many
rows at once. Its dispatch table (`reviewAnswerDispatch.ts`) read a *refused* row's answers
this way: *accept* put the row back (the admission card's `override`), and *reject* kept it
out (`confirm`). Both answers pinned `admission` in the membership's `curated_fields`, so every
later run kept them.

On 2026-09-14 one batch answer showed what that reading does. A curator chose *Accept the
proposed changes* over a selection that included refusal cards, and 119 refused rows came back:

- 25 in Art Museums, among them the Egyptian Museum of Berlin, which the rule had refused as
  "folded into Neues Museum — housed in it, 11 m away";
- 94 in Public Art, among them three concentration camps and *Fallen Astronaut*, whose
  coordinate is on the Moon.

Every one of them was pinned, so the next run could not refuse it again.

The product review of 2026-09-15 found the reading wrong in principle. **A refusal card
proposes a refusal.** Accepting what a run proposed therefore means accepting the refusal.
Under the old table, a curator who said yes to everything a run proposed was saying no to every
refusal in the same click, and the selection bar gave no sign that the two differed.

The pin compounds it. A pin is a claim that outlives the rule: a person looked at this one row
and said why. A batch answer is a person looking at a selection, not at a row.

## Decision

**1. On a refusal row, *accept* keeps the row out and *reject* puts it back.** The batch
arm calls `answerAdmissionUnderLock` with `confirm` for *accept* and `override` for *reject*.
The words under the batch buttons (`answerWords.ts`) follow the same reading:

- the row *proposes to keep this object out, as our rule decided*;
- *accept* reads "The rule was right — keep it out";
- *reject* reads "The rule was wrong — put it back until the next run".

The single-row card keeps its two explicit buttons, which name their consequence rather than a
verb.

**2. A batch answer pins nothing.** `answerAdmissionUnderLock` takes `pin`, which is true for
the card and false for the batch. Neither batch answer claims `admission`:

- **A put-back** admits the row for now. The next run applies the rule again, and if the row
  still fails it, the refusal comes back as a question.
- **A confirmation** closes the question without a claim. It sets
  `experience_kind_memberships.admission_answered_at`, and every later run applies the rule as
  it would to any unpinned row.

Only the card claims `admission`, because there a person read one row and could write why.

**3. "Answered" is a pin or the mark.** `admissionAnsweredSql` (`db/membership.ts`) is
`admission` in `curated_fields`, or `admission_answered_at IS NOT NULL`.

- An open refusal is `refused AND NOT answered` (`refusedOpenSql`).
- The kept-out list is `refused AND answered`, so a batch-confirmed refusal has the same way
  back as a pinned one.
- A run that refuses a row it had admitted clears the mark (`markRefused`, `markNotAdmitted`),
  and so does every writer that admits one. A refusal that comes back after the row was
  admitted is a new question. A refusal that stands stays answered.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the table and fix only the words | The words would say what the click does, and a batch *accept* would still undo every refusal in the selection. The product review's objection is to what accept means, not to how it is labelled |
| A batch confirmation that pins | It closes the question, and it also makes every later run keep a verdict that nobody gave to this row. Where the rule later changes its mind, the row stays out on the strength of a selection |
| A batch confirmation that writes nothing | The question would stay open, so the same card would be asked on the next page and after every run. The mark is the least that says "answered" without saying "for ever" |
| Excluding refusal rows from a batch | A batch of a thousand arrivals and a handful of refusals is the ordinary shape of a run's feed. Forcing the refusals out one at a time costs the curator the batch without changing what an answer means |

## Consequences

**Positive:**

- *Accept the proposed changes* over a run's feed does what it says: it publishes the arrivals
  and keeps the refusals the rule made.
- A batch answer cannot make a row permanent. The rule stays the authority for every row
  nobody read on its own.
- The kept-out list and its way back are unchanged for the curator. Rows that a batch
  confirmed join it.

**Negative / Trade-offs:**

- **A put-back by batch does not last.** Every run the rule still refuses brings the row back
  as a question, and that is the point of it. A curator who means the row to stay answers its
  card.
- **The 119 rows the 2026-09-14 batch pinned stay pinned.** Handing a claim back is
  [#626](https://github.com/uncovering-world/track-your-regions/issues/626), and they return to
  the rule's verdict through it, never by SQL.
