# ADR-0180: A curator keeps a place of a crowded city in its list or its shadow

**Date:** 2026-11-02
**Status:** Accepted — decision 3 narrowed by [ADR-0183](0183-a-crowded-city-is-answered-on-its-regions-list-and-a-place-in-its-own-circle.md)

---

## Context

ADR-0172 shows a place unless ten better-known places of its kind and type stand within 10 km.
Fame is read from the place's own item, so the rule misplaces some places a traveller would
place at once. On the development catalogue of 2026-11-02:

- Rome's churches shadow Sant'Agnese in Agone, the church of Piazza Navona, and Borromini's
  Sant'Ivo alla Sapienza, while the Basilica of the Holy Cross in Jerusalem is shown.
- Kyoto's temples shadow Chion-in, one of the city's great temples, as an arrival.
- Berlin's squares shadow eleven arrivals: Frankfurter Tor, Rosa-Luxemburg-Platz, Schloßplatz,
  Kottbusser Tor and Hermannplatz among them.

Two gaps follow from the rule alone:

- **Nothing a curator says changes the order.** A curator can refuse a place or leave it. A
  curator cannot say that a place belongs among the ten, or that a place shown is not worth one
  of them.
- **A shadowed arrival is asked nowhere.** ADR-0172 decision 6 leaves a crowded-out arrival out of
  the review queue. It is unpublished, so it is not in the tail either. About 430 such arrivals
  waited on dev: 301 places of worship, 98 squares and streets and 28 bridges.

The maintainer (2026-11-02): "a single card cannot decide it; one has to see the whole list of
that type around, what goes up, what goes down, what we already have."

## Decision

This narrows ADR-0172 decisions 1 and 6.

**1. A curator's answer is a pin on the membership, and the recount reads it.**
- `experience_kind_memberships.crowding_pin` holds `list` or `shadow`, or nothing. No run writes
  it. Only a curator does, through the membership writer under the place's lock (ADR-0069,
  ADR-0077).
- **List.** The place is never crowded out. It counts as one of the ten above every place of its
  type around it that a curator did not keep in the list.
- **Shadow.** The place is always crowded out. It never counts among the ten, so the next place
  moves up.
- **No pin.** The rule decides as ADR-0172 states.
- **Works and exemptions come first.** A place holding a work a reader is shown (ADR-0173) and a
  type its kind exempts (ADR-0179) take no pin. The writer refuses one with a 409. A refused
  membership's pin is not read.

**2. The rule's reading stays beside the pin.** `crowding_better()` counts what stands above a
membership. It reads the other places' pins and never the membership's own. So for a pinned
place it still says where the rule would put it. The window shows that count beside the pin,
and an answer's log row records it.

**3. A pin is answered in a window over the whole type around a place.**
- The window lists every place of the kind and type within the radius, best known first. Each row
  carries its readers, editions, guide use, score, the rule's count, its standing (in the list, in
  the shadow, or new) and its pin.
- The answers are applied together. *List* and *shadow* on a new arrival also publish it, in the
  publish's own transaction. *Don't take* is a curator's ordinary refusal.
- A pin's change recounts around the place as it commits (`crowding_follows_membership_change`).
  This follows ADR-0172 decision 4: no writer asks for a recount.

**4. A shadowed arrival is asked in a group of its own.** The queue's sections still leave it out
(`arrivalOpenSql`). A read of its own groups the shadowed arrivals by region, kind and type, and
each group opens the window. The queue's response stays as it is.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Answer each arrival on its own card | Whether a place belongs among the ten depends on the others. One card cannot show what goes up and what goes down. |
| Let a list pin add to the ten rather than take one of them | A city's list would then grow with every pin, and the rule's ten would mean nothing in a core a curator worked on. |
| Pin through `curated_fields` beside a run-written column | No run writes the crowding answer, so there is nothing for a claim to protect. The column is the pin, and the curation log says who set it and when. |
| A field on the review queue's response for the groups | The queue is paged by question. A count by region, kind and type is no question of its own, and it would be computed on every page. |
| Read the pins in a scalar function called per candidate | A full recount took 5.7 s on the development catalogue against 2.1 s. As a set-returning function, the count is inlined into the recount's lateral join and costs what it did. |

## Consequences

**Positive:**
- **A traveller's correction reaches every list, map and count at once,** since they read the
  crowded-out set (ADR-0172 decision 5).
  - In Berlin, Kottbusser Tor kept in the list pushes Hackescher Markt, the tenth, out.
  - Nollendorfplatz kept in the shadow lets Frankfurter Tor up.
  - In Rome, Sant'Agnese in Agone kept in the list comes in, and Santa Sabina kept in the shadow
    goes out. San Clemente, the eleventh, stays out, since one seat was given and one taken.
- **Without pins nothing moves.** On the development catalogue the recount crowds out the same 505
  memberships with the same counts as before. A full recount takes 2.0 to 2.3 s against 2.0 s,
  and a recount around Santa Prassede 475 ms against 463 ms.
- **What a curator answered can be read against the rule later** (#863). Each `crowding_answered`
  log row records the rule's count and verdict at the time.

**Negative / Trade-offs:**
- **A pin outlives the neighbourhood it answered.** A run that adds a better-known place, or
  re-scores the city, does not ask about a pin again. A list pin still takes one of the ten.
- **A core can show fewer than ten unpinned places, or more than ten in all.** It shows fewer when
  curators keep places in the list, and more when places hold works.
- **The rule is stated in two functions.** `crowding_better()` holds the count.
  `recount_crowding()` holds the candidate set and the pins.
  `backend/src/controllers/experience/crowdingAnswers.db.test.ts` holds them to Berlin's squares.

## References

- Related ADRs: ADR-0172 (decisions 1 and 6 narrowed), ADR-0173 and ADR-0179 (what takes no pin),
  ADR-0069 and ADR-0077 (the membership writer under the place's lock), ADR-0068 (a trigger owns the
  recount)
- Related docs: `docs/tech/experiences.md` § What a crowded city shows
- Issues: #2282; #2228 (which ten shadow a place, folded into #2282)
