# ADR-0160: A place's name starts with a capital unless its first word is spelled otherwise, and the capital passes the gate

**Date:** 2026-10-30
**Status:** Accepted
**Issue:** [#2137](https://github.com/uncovering-world/track-your-regions/issues/2137)
**Narrows:** [ADR-0139](0139-a-field-no-reader-sees-and-a-typographic-rewrite-pass-the-gate.md) decision 2

---

## Context

Wikidata's English labels follow its sentence-case style, which lowercases a common noun. A run
stores the label as it comes, so readers see names that start with a lowercase letter. On the
development catalogue on 2026-10-30, 94 live places and 32 points had such a name:
- Wikidata's style: *mortuary temple of Hatshepsut*, *iron pillar of Delhi*, *tunnel of
  Eupalinos*, *rostra*;
- a local name kept in its own language's style: *place de la Concorde*, *piazza del Campo*,
  *rue de Rivoli*, *pont de l'Alma*. Squares & streets alone held 46 such names;
- the World Heritage list's own component names: *mas de Torres*, *marmalo I*, *[main complex of
  Mahabalipuram]*.

Some lowercase starts are spelled that way on purpose: the Arabic article of *al-Azhar Mosque* and
the components of Samarra (*al-Huwaysilat*), and the Zulu prefixes of *iSimangaliso Wetland
Park* and *uKhahlamba Drakensberg Park*.

The issue proposed deciding by the label in other languages and the Wikipedia title. Measured on
the same rows, neither tells the two groups apart. Wikipedia always starts a title with a capital,
so it gives *Al-Azhar Mosque*. German writes *via Condotti*.

A run that capitalized names would, under ADR-0139, hold a rename card for every stored name it
changed: 85 places and 25 points that nobody needs to answer.

## Decision

**1. A run capitalizes a place's name.** The rule is `capitalizedName` in `@tyr/shared/labels`
(ADR-0065):
- the first letter becomes a capital, after whatever punctuation opens the name, so *[main complex
  of Mahabalipuram]* becomes *[Main complex of Mahabalipuram]*;
- a name whose first word carries a capital of its own is kept as written: *al-Azhar*,
  *iSimangaliso*, *'s-Hertogenbosch*;
- a name that opens with a digit is kept: *1st Avenue*;
- a name whose first letter's capital is more than one letter is kept (*ß*, a ligature such as
  *ﬀ*). The SQL spelling keeps the same letters, read off JavaScript's own mapping, since
  Postgres's `upper` under glibc would give *ß* the single *ẞ*.

The rule reads the word itself, not a list and not another language. The run applies it where a
name enters:
- the upsert's name rule (`withTidyNames`, `experienceUpsert.ts`), for every source's place name;
- the World Heritage list's component reader (`componentText`, `unescoSyncService.ts`), beside
  ADR-0147's mend.

A place's local names in other languages, and the names a curator types, are not changed.

**2. A capital is typography, one way (narrows ADR-0139 decision 2).** `sameTypography` passes an
incoming text that folds to the stored one with its first letter capitalized. A run that writes
*Place de la Concorde* over a stored *place de la Concorde* therefore passes the gate as
`typography`. The reverse is asked: *Place* → *place* lowercases a capital. So is a change of any
other letter's case. The location writer's SQL spelling (`capitalizedNameSql`, `sameTypographySql`
in `backend/src/services/sync/labelFold.ts`) is pinned to the TypeScript rule by
`labelFold.db.test.ts`.

The twin check that names two places of one label apart (`nameTwins.ts`, #1967) asks a twin's
recorded label in both forms, with its capital and without it (`twinLabels`). Until each source runs
again, a twin's membership still holds the label it sent before: a stored *place de la République*
is still a twin of an incoming *Place de la République*, and the suffix that names the two apart is
not dropped and set again.

**3. No migration rewrites the stored names.** As with ADR-0147, the next run of each source writes
the capitalized names, and a name a curator claimed is the curator's.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Decide by the labels in other languages and the Wikipedia title, as the issue proposed | Measured on the 61 Wikidata names: the English Wikipedia title starts with a capital for *al-Azhar* too, and the German label lowercases *via Condotti*. Neither tells the intended spelling from the sentence-case style |
| A list of the names spelled lowercase on purpose | Every new particle or prefix would wait for someone to add it to the list. A capital inside the first word is the mark such a spelling carries |
| A migration that capitalizes the stored names | It spells the rule in SQL a second time for one use. The names would still be held as renames once a run compared them with a source that sends lowercase, unless the gate learned the capital anyway |
| Capitalize in `tidyLabel`, the store rule every writer applies | A curator who types *de Young Museum* means it. The rule is about what a source sends |

## Consequences

**Positive:**
- A reader sees *Place de la Concorde* and *Mortuary temple of Hatshepsut*, as English writes them,
  and *al-Azhar Mosque* as it is spelled.
- The correction costs a curator nothing: no card is raised for a capital.

**Negative / Trade-offs:**
- A name whose lowercase first word is intended but carries no capital of its own, such as *de Young
  Museum*, gets a capital, as English Wikipedia's title gives it. A curator who claims the name keeps
  their spelling.
- Only the first letter changes. *parvis Notre-Dame - place Jean-Paul-II* becomes *Parvis Notre-Dame
  - place Jean-Paul-II*, with its second *place* still lowercase.

## References

- Related ADRs: ADR-0139 (a typographic rewrite passes the gate), ADR-0147 (the list's defects are
  mended on reading), ADR-0065 (rules both sides apply)
- Related docs: `docs/tech/experiences.md`
- Issue: #2137
