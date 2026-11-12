# ADR-0201: A dedication two language models read alike from a place's lead is written without a curator's yes

**Date:** 2026-11-12
**Status:** Accepted
**Issue:** [#2472](https://github.com/uncovering-world/track-your-regions/issues/2472), research [#2435](https://github.com/uncovering-world/track-your-regions/issues/2435)

---

## Context

A monument's *Commemorates* line is read in six steps from Wikidata's statements and English
Wikipedia's categories (#2144, #2404, #2412). Some monuments state their dedication only in their
article's lead. The Shaheed Minar in Dhaka was "established to commemorate those killed during the
Bengali language movement". The Jallianwala Bagh is a memorial to the massacre of 1919. Neither
carries a statement or a category that says so, and neither card had a line.

The research for #2435 read 64 such places from #2404's unread sample and judged every answer by
hand (`docs/research/2026-11-12-dedications-stated-in-a-lead.md`). No single rule held: each way
alone was wrong on 11 places or more. Two ways that agreed, the first typed link after the
dedicating phrase and a dated label search, named 14 right and none wrong. The key phrase and year
of that search had been picked by hand, so the 14 held only for hand-picked input.

#2472 measured the same 64 places with generative models. Each model read the whole lead with
every link marked, and answered in a fixed JSON shape. The answer was constrained to the lead's own
link titles or "none". A *typed* answer was kept only where the linked item is a human (Q5), an
occurrence (Q1190554) or a group of people (Q16334295, Q41710, Q13417114, Q8436):

| Way | Right | Wrong |
|---|---|---|
| A and B agree (#2435) | 14 | 0 |
| Claude Haiku 5.5, one run, typed | 26 / 24 (two runs) | 1 / 0 |
| Claude Haiku 5.5, two runs agree, typed | 23 | 0 |
| gpt-5-mini, one run, typed | 28 / 29 (two runs) | 3 / 2 |
| Haiku and gpt-5-mini agree | 31 | 2 |
| Haiku and gpt-5-mini agree, typed | 24 | 0 |

The type check removes a country named for its independence (Ghana), a topic, a place and a
class. What it lets through is a human or a group that is not the subject: the sculptor of Mother
Armenia and Brigham Young for the Eagle Gate, each from one model only. Two runs of one model
differ on 7 to 11 of the 64 places. A call costs about 1,400 input and 400 output tokens for Haiku,
and 800 and 800 for gpt-5-mini.

That measurement read rendered leads, in the article's own language where the extraction took it.
The step reads the wikitext of the English lead, its links marked the same way. Asked again on that
input, the 58 places with an English article gave 16 typed answers both models agreed on: 14 right,
one arguable (the Russian Monument in Sofia, whose lead says its inscription commemorates Alexander
II) and one wrong (the Capas National Shrine, raised for the prisoners who died at Camp O'Donnell,
named the Allies of World War II).

On the catalogue itself (2026-11-13), the step was run on the 136 published places of the two
kinds that had an English article and no Commemorates line. Both models agreed on 37, and 30
passed the type check. Of those 30, 28 were right or coarser: the Siegessäule's Second Schleswig
War, the Gateway of India's George V, the Narva Triumphal Arch's French invasion of Russia. Two
were wrong: the Victims of Acts of Terror Memorial named *Terrorism*, and the Monument to the
Conquerors of Space the *Soviet people*.

The backend's generative model was OpenAI, through one AI layer that picks the model per feature
and logs what each call costs (ADR-0016). Jev, TypeSafe's model for closed decisions, suggests
answers on a curator's card and never applies one (ADR-0087).

## Decision

1. **A seventh step, last.** For a place of Public art or Monuments & memorials that no earlier step
   names a dedication for, the run reads the lead of the place's English Wikipedia article and asks
   two models, each on its own, which of the lead's links names whom or what the place was raised
   to commemorate. The step runs after a war is narrowed, and its value is stored as every step's
   is (`via: 'lead'`).
2. **Two providers must agree.** Claude Haiku (Anthropic) and an OpenAI model (gpt-5-mini by
   default, `lead_dedication` in AI Settings) are both asked. Anthropic becomes a second
   generative-model provider beside ADR-0016's OpenAI, its calls logged and priced in the same
   usage log. An answer is taken only where both name the same linked
   article. Neither model alone is trusted to write catalogue data.
3. **The answer is one of the lead's own links.** The JSON shape lists the lead's link titles and
   "none" as the only answers, and the backend refuses any other answer whatever the shape
   promised. A model cannot name an item the article does not link.
4. **Typed.** The agreed title is resolved to its item as a category's title is. The item is taken
   only where the run's reading of Wikidata calls it a human, an occurrence or a group of people
   (`dedicatedTo`).
5. **Written without a curator's yes, and a curator's claim still wins.** The pass writes the line
   as it writes any step's, with no suggestion waiting on a curator first. It then takes the run's
   path as every step's value does: an arriving place carries it, and a change to a place visitors
   already see is held for a curator wherever the source holds its changes, the review card saying
   which step read it. A curator's correction of *Commemorates* is a claim no run undoes. This
   differs from ADR-0087, where Jev's answer is only a suggestion beside a curator's question. There,
   the answer is a single model's pick among options a source gave, measured against curators'
   choices. Here, two independent providers agreeing and a type check measured 24 right and none
   wrong on rendered leads, and 14 right, one arguable and one wrong on the English wikitext the
   step reads. About 160 places a pass have no line, and answering each on a card would be manual work
   on all of them for a reading that rarely errs. A place's line is read on its card and is a
   curator's to correct at any time.
6. **Kept per revision.** Each model's answer is kept with the revision of the lead it read
   (`workbench.lead_dedication_readings`). A model is asked again only once the lead has changed, so
   a reading does not flip between passes on a model's own variance, and an unchanged lead costs
   nothing.
7. **Optional keys.** `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` turn it on together. With either
   unset, no lead is read and nothing else changes. They are wired as `JEV_API_KEY` is.
8. **Catalogue data only.** A model is sent the place's name and its lead, fenced as data under the
   repository's untrusted-data rule. Nothing about a user is sent. The lead is read with the
   model-input flag, so a site's `ai-input=no` signal refuses it (ADR-0148).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A suggestion on the card, as Jev's (ADR-0087) | The maintainer's call: about 160 places would each wait on a curator for a reading measured at 14 right, one arguable and one wrong on the step's own input (24 right and none wrong on rendered leads). The line is correctable afterwards like any step's. |
| One provider, two runs agreeing | Two Haiku runs measured 23 right and none wrong on rendered leads, close to the pair's 24. A model agreeing with itself is no independent check, and its errors repeat across runs. |
| The typed link and a dated label search agreeing (#2435's way B) | 14 right and none wrong, with the phrase and year picked by hand. An extraction of its own is a second model call with no measured precision. |
| One model, typed | Haiku's two runs were wrong on 1 and 0; gpt-5-mini's on 3 and 2. Either alone writes some wrong dedications every pass. |
| Ask on every pass | Two runs of one model differ on about a tenth of the places. Lines would flip between passes and every flip would reach the review queue. |

## Consequences

**Positive:**
- A monument whose dedication only its lead states gets a line: the Shaheed Minar commemorates the
  Bengali language movement, and the Arch of Trajan in Benevento Trajan.
- The two models must agree, which removed every wrong answer on rendered leads; on the step's own
  input one wrong answer remained (the Capas National Shrine named the Allies of World War II), and a
  curator corrects such a line on the card.
- An unchanged lead is never asked about again, so the line is stable and the cost follows edits.

**Negative / Trade-offs:**
- A second paid provider, and a deployment that wants the step needs both keys. The calls go to
  `ai_usage_log` under `lead_dedication`, so the admin sees what they cost.
- Zero wrong in 64 still allows a few wrong lines in the population. The rule is measured again
  main against the branch on the development catalogue before merge, every changed place judged.
- Wikidata's subset keeps few items only a lead names. A subject the subset does not type is
  refused, which loses some right answers rather than writing a wrong one.
- The models can change under the same name. A changed OpenAI model in AI Settings is a new
  cache key and asks every lead again; a change behind a name is not seen.

## References

- Related ADRs: ADR-0016 (OpenAI), ADR-0087 (Jev suggests), ADR-0124 (workbench tier), ADR-0148 (outside services)
- Related docs: `docs/tech/experiences.md` § Whom or what a place commemorates, `docs/tech/external-services.md`
- Issue: #2472; research #2435
