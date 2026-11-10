# ADR-0193: Public art files its works under eight types, and a retype passes the gate

**Date:** 2026-11-10
**Status:** Accepted
**Issue:** [#2279](https://github.com/uncovering-world/track-your-regions/issues/2279)
**Narrows:** [ADR-0135](0135-a-type-its-kind-has-no-word-for-passes-the-gate.md) decision 2

---

## Context

A kind's types are what a traveller filters by inside it (ADR-0045, #1253). Public art had four:
`sculpture`, `fountain`, `street-art` and `clock` (`PUBLIC_ART_TYPES` in `@tyr/shared/placeTypes`).
On the development catalogue on 2026-11-10, 476 of the 588 works Public art admits were
`sculpture`. That one word covered Christ the Redeemer, the Tian Tan Buddha, the Bronze Horseman,
the Spiral Jetty, Cadillac Ranch, the Big Merino and Cloud Gate. A traveller looking for the great
religious statues of a country, for equestrian statues, or for the oversized roadside figures of
Australia and North America could not filter for them. A curator going through Public art's
arrivals saw one word for all of them.

The same reading found works the old rule had filed under the wrong type. Manneken Pis, the
Merlion and the Lindwurmbrunnen were filed as sculptures, though each is a fountain. The Corpus
Clock, the World Clock on Alexanderplatz and the Brno astronomical clock were filed as sculptures,
though each is a clock.

ADR-0135 decision 2 held every type moved inside a kind's vocabulary as a question for a curator.
A new vocabulary moves 130 works inside it at once, and every answer would be "yes": the work is
the same either way, and only the filter it answers to changes.

## Decision

**1. Public art's vocabulary has eight types.** They are *sculpture*, *religious statue* (a deity,
Christ, Mary, the Buddha, a bodhisattva or a saint), *equestrian statue*, *fountain*, *street art*,
*clock*, *installation and land art*, and *roadside giant* (an everyday thing built huge to be
stopped at). The values are `religious-statue`, `equestrian-statue`, `installation` and
`roadside-giant` beside the four that stand. A religious statue stays in Public art, where the
maintainer placed it on 2026-11-10. Its card names the figure on the *Depicts* line (#2404).

**2. The type is read from the work's classes first, in one order** (`publicArtType` in
`publicArt/kindRules.ts`): clock, street art, fountain, religious statue, equestrian statue,
roadside giant, installation and land art, and sculpture otherwise. Each type has its classes in
`publicArt/classes.ts`. An equestrian statue may also be read from its genre, or from a horse
depicted beside a person. A clock or a fountain that no class names is read from its label or the
head of its Wikidata description, only where the classes name neither: the Brno astronomical clock,
Manneken Pis, the Bucket Fountain. The head ends at the first word that places or credits the work,
so a statue *by Lucio Fontana* is not a fountain.

**3. A plain sculpture whose reading names a holy figure is a religious statue** (`typeByDepicted`,
after `readCommemorates`). The holy figure is the one the reading of what a work depicts finds
(#2404). This applies only to a work that is raised to no one, and only to a figure that no
classical myth holds. Our Lady of the Rockies is typed only `sculpture` on Wikidata, and its
category *Statues of the Virgin Mary* names Mary. Cellini's Perseus is a sculpture, and the Column
of Marcus Aurelius, named for the emperor, is not a religious statue for the Paul the Apostle on
top of it.

**4. A type moved to another word of a kind's vocabulary passes the gate**
(`type-within-vocabulary`). This narrows ADR-0135 decision 2 for every kind that declares a
vocabulary on its records. Today those are the five kinds of the landmark pass: Public art,
Monuments & memorials, Towers, Bridges & engineering marvels and Squares & streets
(`typeVocabulary` in `landmarkSyncService.ts`). Places of worship and Archaeology declare none,
so their retypes stay questions. The reason is the same in every one of the five: the place is the
same either way, and only the filter it answers to changes. On the development catalogue on
2026-11-10 the three other kinds had never held such a retype: Towers' runs had moved 11 types
inside its vocabulary (`tower` → `mast`), all on rows no hold covered, and Bridges' and Squares'
none. As in ADR-0135
decision 1, the incoming type must be a word of the vocabulary. On a held row the type is written,
filed with the written fields and marked with its class. A record that proposes no type, or a word
outside the vocabulary, stays a question. A curator's claim keeps the stored value.

## Alternatives Considered

- **Let Jev type the works the classes leave plain.** That is #2218's question for every kind with
  types, and it needs its own measurement and its own narrowing of ADR-0087. Until #2218 is built,
  a work no class, genre, depicted figure, label or description places stays a sculpture: the
  Statue of Belief, Carhenge, the Cretto di Burri.
- **Hold the retypes as ADR-0135 decision 2 says.** A curator would read 130 cards, and every
  answer would be yes.
- **Move a religious statue to Monuments & memorials.** The maintainer decided against it on
  2026-11-10. A religious statue shows its figure and was not raised to remember the figure.

## Consequences

- The next run of Public art retypes about 130 works past the gate. No curator is asked about
  them, and the map's filter and the card's chip offer the four new types with their labels.
- A curator who sets a type keeps it (`curated_fields ? 'type'`), whatever a later run reads.
- A retype that Wikidata makes inside a vocabulary is no longer asked about either, in any of the
  five kinds.
  The review card no longer lists such a retype as a question. It appears among the written
  fields, with its class.
