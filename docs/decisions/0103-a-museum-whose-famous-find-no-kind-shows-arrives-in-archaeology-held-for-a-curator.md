# ADR-0103: A museum whose famous find no kind shows arrives in Archaeology held for a curator

**Date:** 2026-10-13
**Status:** Accepted

---

## Context

ADR-0058 admits a museum to Archaeology for what it is, never for one find (decision 2), and leaves a museum of another nature to "its museum's kind" (decision 1). It records the cost: the Venus of Willendorf and Lucy reach no kind until natural history is one, and the Lion man and the Shigir Idol reach none until local history is one. A month on, neither kind exists or is scheduled. The cost has also turned out wider than the four objects named.

The Archaeology run on the development catalogue (2026-10-13) refuses 18 museums that hold a find above the finds' line, because they are no archaeology museum by category or class. Three of them are held by another kind, which shows the find on the museum's card there: the Uffizi, the Bargello and the National Gallery of Art. No kind holds the other fifteen:

- The National Museum of Anthropology in Manila.
- The Natural History Museum in Vienna, with the Venus of Willendorf.
- The Viking Ship Museum in Oslo.
- The Potteries Museum & Art Gallery, with the Staffordshire Hoard.
- The Moravian Museum, with the Venus of Dolní Věstonice.
- The Museum für Urgeschichte und Eiszeitkunst in Blaubeuren.
- The Museum of History and Archaeology of the Middle Urals, with the Shigir Idol.
- The Drents Museum, the Musée de l'Homme, the Kunstkamera, the Slovak National Museum and others.

For a traveller these finds are reasons to make the trip. The catalogue check `work-no-offered-place-holds` (#1444) lists them as works no offered place holds.

The product review chose to take such a museum, but through a curator. "A famous find alone admits the wrong museums" (ADR-0058, Context) is still true of a local-history museum with one regional treasure, and only a person can tell the Viking Ship Museum in Oslo from a town museum with one regional hoard.

## Decision

1. **A famous find no other kind shows makes a question, not a refusal.** A museum with no archaeological nature (no `Archaeological museums in …` category, no class under `archaeological museum`, no department category) that holds a find above the finds' line arrives in Archaeology **held**. It carries the run's question for a curator, naming the most famous find: "…but it holds 1 famous find (Venus of Willendorf) no other kind shows; take it for that find?" The source's gate (ADR-0025) holds the arrival, as it holds the Hermitage's department question. Its nature is recorded as `find`, and `admitted_for` names the find whatever the museum's own fame, because the find is what brought it.
2. **Only for a find no other kind shows.** A find is shown when a reader can see it: the find is published, and its link is published and live at a place another source offers. The Venus de' Medici is on the Uffizi's art-museum card, and the Franks Casket on the Bargello's. A museum whose every famous find is shown is refused as before, and the refusal says the finds are shown by another kind. The run reads the shown finds once (`worksShownByOtherSources`). The finds are asked about, not the museum, because a kind that holds a museum need not show its find: a membership waiting on its curator shows nothing, and an art kind's work rule may never collect an ancient statue. A place only Archaeology offers is not counted, or the next run would refuse the museum a curator took for its find.
3. **Natural history is no longer a veto; it is a reason.** A natural-history museum with no archaeological signal of its own is a museum of no nature that says it is a natural history museum. It is refused as one when it holds no famous find or another kind shows each one, and it is held under decision 1 otherwise. ADR-0058 decision 2's veto is narrowed to that. The archaeological-park veto stands.
4. **No fold lands on such a museum.** A museum held for a find has no archaeological nature, so `foldsOntoAdmitted` still folds nothing onto it. An archaeological collection is never taken out of the catalogue by a fold onto a museum a curator may yet refuse.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep refusing until natural-history and local-history kinds exist | Neither kind is scheduled, and the Oseberg ship and the Staffordshire Hoard stay on no card meanwhile. |
| Admit such a museum without a curator | That is the rule ADR-0058 rejected: a local-history museum with one regional treasure would enter as an archaeology museum on the run's word alone. |
| Hold every museum with a famous find, whether or not another kind shows it | The Uffizi and the Bargello would ask a curator about the Venus de' Medici and the Franks Casket, which a traveller already sees on their cards. These are questions with no loss behind them, and there will be more as the art kinds grow. |
| Ask only whether another kind holds the museum | A kind can hold a museum without showing its find. A membership waiting on its curator shows nothing, and an art kind's work rule may never collect an ancient statue. Either way the museum would be refused here and the find would be on no card. |
| Hand the find to a museum of another kind (ADR-0102) | A hand-over needs a kind that admits the venue. These fifteen museums are in none, which is why their finds are lost. |

## Consequences

**Positive:**
- The Venus of Willendorf, the Shigir Idol, the Staffordshire Hoard and the Viking ships reach a card through a curator's yes, with no new kind built first.
- The question names the find, so a curator decides on the reason the museum is there rather than on its class.

**Negative / Trade-offs:**
- A curator answers one more kind of question per run until each such museum is decided. On the development catalogue that is fifteen arrivals at once.
- A museum taken this way stays an archaeology museum after a natural-history or local-history kind exists. Moving it is that kind's decision.
- If another kind admits the museum later, the next Archaeology run refuses it as shown there. That refusal takes the same path as any refusal of a row the source held, including a curator's pin on it.

## Amendments

- 2026-10-13, before acceptance: decision 2 asks whether another kind shows the *find* rather than whether it holds the *museum*. The review found that a held museum need not show its find.

## References

- Narrows: ADR-0058 decisions 1 and 2
- Related ADRs: ADR-0025 (the gate), ADR-0102 (hand-over between kinds)
- Related docs: `docs/tech/experiences.md` § Archaeology
- Issues: #1444
