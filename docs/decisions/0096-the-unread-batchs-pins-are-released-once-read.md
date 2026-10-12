# ADR-0096: The pins of the unread batch of 2026-09-14 are released once a curator has read them

**Date:** 2026-10-12
**Status:** Accepted

---

## Context

On 2026-09-14 between 16:33:51 and 16:33:55 UTC, one batch answer in the review feed overrode 119 refusals and pinned each of them (#906). ADR-0067 made a batch answer pin nothing from then on. Its last consequence kept those 119 pinned "through #626 … never by SQL": the general way to hand a claim back was to return them to the rule's verdict.

Four weeks later #626 has not been built, and the 119 still stand on the map against their kind's rule:

- the Egyptian Museum of Berlin as an art museum 11 m from the Neues Museum that houses it;
- the Palace Museum beside the Forbidden City;
- the archaeological museums of Olympia, Delphi and Naples as art museums;
- the Bocca della Verità and the Pietà as public art.

The maintainer has said the batch was an answer nobody read card by card. On 2026-10-12 a curator read the whole list, grouped by the rule's reason (#1365). Two groups were kept:

- **Two art museums** refused because their famous works cannot be seen: the Isabella Stewart Gardner Museum and the Louvre Abu Dhabi.
- **Six public artworks** one sitelink below the world tier's line: the equestrian statue of Gattamelata, the Fountain of Cybele, the Flame of Liberty, the Mano del Desierto, the Victory Arch and the Warsaw Uprising Monument.

## Decision

1. **Once, the 111 pins not kept are released through the membership writer** (narrows ADR-0067's consequence "they return to the rule's verdict through #626, never by SQL"). `releaseAdmissionPin` (`membershipWriter.ts`) writes the rule's verdict in each pin's place:
   - the membership is refused with the reason the rule gave at the time;
   - the claim on `admission` comes off;
   - the refusal is marked answered, since a curator has now read it;
   - the must-see flag is cleared.

   One `admission_pin_released` row in the curation log names the batch. The next run of the source applies its rule as to any unpinned row: if the rule now admits the place, it is admitted.
2. **The 8 pins kept are a person's decision.** They stay pinned, and an `admission_overridden` row says they were kept from that batch once read.
3. **The release is a one-time script, not a feature** (`backend/src/scripts/releaseBatchPins.ts`, `npm --prefix backend run pins:release-batch`). It reads the batch from the log and follows each row through `experience_merges` to the place that carries it today. It writes each place under its lock, in its own transaction, and writes nothing without `--write`. The general hand-back of a claim stays #626.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Wait for #626 | The 119 would stay wrong on the map, and a reader would keep seeing them, for as long as the general hand-back is not built. That hand-back answers a different question, any claim at any time. This is one answer nobody read. |
| Release the pins and leave the refusals open | Every next run would ask about 111 rows a curator has just read as a list, as cards again. |
| A migration in SQL | `experience_kind_memberships` is written by its writer modules only (ADR-0077 decision 4), and the release is a curator's act with a log row per place. |

## Consequences

**Positive:**
- The Egyptian Museum of Berlin leaves the art-museum kind, and the Neues Museum stands alone on its door, Nefertiti with it. The archaeological museums and the works in churches leave the kinds that refused them.
- What happened to each place is in its own history, with the rule's reason and the batch named.

**Negative / Trade-offs:**
- Memorials and mausoleums refused by the public-art rule (Anıtkabir, Neue Wache, Walhalla, Yad Vashem) leave that kind and belong to no kind until one takes them.

## References

- Related ADRs: ADR-0067 (its consequence on the 119 pins narrowed), ADR-0077 (the writer modules)
- Issue: #1365; the batch #906; the general hand-back #626
