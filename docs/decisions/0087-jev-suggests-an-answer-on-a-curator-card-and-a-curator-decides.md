# ADR-0087: Jev suggests an answer on a curator's card, and a curator decides

**Date:** 2026-10-08
**Status:** Accepted

---

## Context

The review queue asks curators closed questions about real places: which of two sources' names,
photographs or points a place should show (#1246), and soon whether two rows that stand close
together are one place (#1249). Each question has a short list of answers, and many are easy for
someone who knows the place: Rila Monastery is known as "Rila Monastery", not as "Monastery of
Saint John of Rila". A suggestion on the card would speed the easy ones up and leave the
curator's attention for the hard ones.

Jev, TypeSafe's model for closed decisions (Epic #929), answers exactly that shape. It is given
one `choice` question with its options and returns the option it picks, a probability for each
option and a confidence. On 2026-10-01 it agreed with independent labels on 92 % of 1 000 entries
filed under the catalogue's kinds, and on 99 % where its confidence was 0.9 or more. It is a paid
service: $0.042 per million input tokens and output free, as published on 2026-10-08. A question
about one field of one place costs about 430 tokens. The backend already calls OpenAI for the
world-view import's free-text work (`OPENAI_API_KEY`). No backend code called Jev before #1260.

## Decision

1. **Jev suggests; a curator decides.** Jev's answer is shown on the card beside the options,
   with its confidence. It is never preselected and never applied. Every answer to the queue is
   still a person's.
2. **Optional, by one environment variable.** `JEV_API_KEY` turns it on. Unset, nothing is
   asked, no suggestion is shown and nothing else changes. It is wired the way `OPENAI_API_KEY`
   is: compose, the root and backend `.env.example`, and the integration setup.
3. **Catalogue data only.** Jev is sent the place and the options as the catalogue holds them:
   names, countries, kinds, each source's text, a picture's file name and photographer, a
   coordinate. Nothing about a curator or a traveller is sent. The answer is untrusted: an option
   it was not given, or a confidence that is not a probability, is refused.
4. **One closed question per decision, recorded with what it was about.** A suggestion is stored
   with the views it was asked about, one row per call. It is the card's while those views
   stand, so a card opened again costs nothing. It is asked again once a source sends something
   different. Every call is recorded, since the rows are what the calls cost: an answer about
   views that changed during the call is recorded and never shown, and an answer refused at the
   boundary is recorded with no pick, so the same views are not paid for twice.
5. **What it costs and how often curators agree is the admin's to read.** AI Settings shows the
   calls, their input tokens and cost, and the share of curators' choices that took the
   suggested option. That share is the evidence for whether the suggestion earns its place on a
   card.
6. **One client** (`services/jev/jevClient.ts`), which the merge proposals of #1249 reuse.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Ask OpenAI, already configured, for the suggestion | A chat completion answers in free text and gives no calibrated confidence. The confidence is what tells an easy question from a hard one, and Jev's was measured against the catalogue's own decisions (Epic #929). |
| Apply the suggestion where confidence is high, and ask only below a line | The queue's answers are a curator's (ADR-0025). A line would need its own measurement on curators' choices, which decision 5 is there to collect. |
| Ask Jev for every open question when the queue is read | It would pay for questions nobody opens, and a page of cards would wait on a remote model. Asked when the card opens, the cost follows the curator's attention. |
| No suggestion | The easy questions take a curator's time that the hard ones need. |

## Consequences

**Positive:**
- An easy question shows its likely answer at a glance, and the confidence says how far to trust it.
- The cost is a few thousandths of a cent per question and is visible to the admin.
- Turning it off is unsetting one variable.

**Negative / Trade-offs:**
- A paid external dependency: a deployment that turns it on sends catalogue data to TypeSafe and
  pays per call (the security profile lists the boundary).
- A suggestion can anchor a curator's judgement. It is shown in grey, beside the marks about what
  readers see, and never chosen for them. Agreement is measured rather than assumed.
- Rate limits are TypeSafe's and "adjusting dynamically". A refused call shows no suggestion and
  changes nothing else.

## References

- Related ADRs: ADR-0025 (only a person passes what readers see), ADR-0081 (where Jev first
  measured the catalogue), ADR-0085 (one Wikidata item is one reading), ADR-0086 (merges)
- Issues: #1260, #1246, #1249, Epic #929
