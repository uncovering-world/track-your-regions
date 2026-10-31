# ADR-0169: A work a guide uses or Atlas Obscura lists enters at 20,000 readers a year, whatever its editions

**Date:** 2026-10-31
**Status:** Accepted

---

## Context

Public art fills its world tier by the editions line (ADR-0023's 22 and 18, `publicArt/pipeline.ts`)
and, under it, by the readership door over the works the source holds at the line (#2033: a work
read at the median of those enters, 115,121 views on the development catalogue of 2026-10-25). Most of
the famous public art a traveller goes to see has neither: of the 30 entries of the kind's calibration
list (#1953) its classes reach under the line, Cadillac Ranch carries 10 Wikipedia editions, the Crown
Fountain 13, Salvation Mountain 10, the Sun Voyager 9, Floralis Genérica 8, *The Spirit of Detroit* 2 —
under the pool's floor of 15, where no door reaches — and few are read at the readership door's bar.

The #1992 report measured a mark on them: an Atlas Obscura place ID (Wikidata's `P7772`, a CC0
statement read from the dump, never the site) is on 21 of the 30; a Wikivoyage edition's use on 18.
The #1997 report measured the marks with a year of readers on the kind's classes under the floor:

| Readers a year | Places | Missing tops among them |
|---|---|---|
| 10,000 | 452 | 15 |
| 20,000 | 207 | 15 |
| 25,000 | 149 | 9 |

The maintainer decided on 2026-10-30, on #2034: a work that a Wikivoyage guide uses or that carries an
Atlas Obscura place ID, and that a year of readers puts at 20,000 or more, enters whatever its count of
Wikipedia editions, for a curator; the bar is to follow the year's readership (#2145). Monuments &
memorials opens a guide door under its line (ADR-0167), Towers a guide door with readers under its
floor (ADR-0168); the street-art rule already reads these three marks together (#2035).

## Decision

This stands beside Public art's editions line and its readership door, which are unchanged.

1. **A work that passes the kind's rule, that a Wikivoyage edition uses or whose item carries an
   Atlas Obscura place ID, and that the latest year of readership reads 20,000 times or over enters,
   whatever its count of editions, for a curator** (`PUBLIC_ART_MARKS_DOOR`, `publicArt/marksDoor.ts`).
   Either mark says a traveller goes there; the readers say how many. The curator's question is the
   row's admission note: the editions, the readers, the marks it carries, the bar, and whether a
   visitor can see it there now.
2. **The door reads under the pool's floor** (`publicArt/underFloor.ts`): the readership names every
   item read at the bar in fewer than 15 editions, the marks narrow them, and Wikidata is asked which
   of those carry a class the kind's rule admits by — the sculptural and fountain closures and the
   public clocks, not the heritage senses of monument, which are Monuments & memorials' — then for
   their rows, facts, what holds them and what they depict. They join the share before any other read,
   and the rule reads them unchanged: a work inside a museum or a church is refused as it always was.
   The readership door and the guide door keep reading the pool from its floor; a row under it is this
   door's.
3. **A work the door admitted stays while a mark stands and the year reads it over 16,400** — the
   editions line's own ratio of stay to enter — and falls with the marks named once it does not. The
   door is shut while the source's curator gate is off (ADR-0056 decision 5) and while no year of
   readership is folded: nothing is read under the floor, nothing enters, and a held work under the
   stay line keeps its place with a note saying so. With no Wikivoyage usage build the guide's half is
   silent and Atlas Obscura's still speaks.
4. **The bar is a count, 20,000, stated once.** #2145 restates every readers' bar as a rule that
   follows the year's readership and changes that one line.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Atlas Obscura alone, at an editions floor (the issue's first shape) | Of 510 marked items with two editions or more, a sample held a fifth that is no public art; readers tell the sights from the roadside giants and the geographic centres. |
| The readership door's bar for the marked (the median, 115,121) | It reaches two of the thirty tops; the kind's famous works are read in the tens of thousands, not the hundreds. |
| 25,000 readers | Nine missing tops reached instead of fifteen, for 58 fewer places (#1997). |
| 10,000 readers | No more tops, more than twice the places. |
| A door that stops at the pool's floor | Most of the missing tops are under it: Cadillac Ranch, Salvation Mountain, the Sun Voyager, Floralis Genérica, *The Spirit of Detroit*. |

## Consequences

**Positive:**

- On the development subset, read-only, main against the branch by item, the door brings 198 works
  for a curator — 34 inside the pool (Mano del Desierto, the Fontana delle Tartarughe, the Statue of
  Decebalus, the Flame of Liberty, Christ of the Abyss) and 164 under its floor (Cadillac Ranch, the
  Crown Fountain, Salvation Mountain, the Sun Voyager, Floralis Genérica, *The Spirit of Detroit*,
  Spiral Jetty, Carhenge, the Headington Shark, the Prague Metronome, the Stravinsky Fountain, Čumil)
  — and keeps nine held works the line alone would have dropped. 69 carry both marks, 75 the guide's
  alone, 54 Atlas Obscura's alone. Nothing admitted before is lost.

**Negative / Trade-offs:**

- **198 arrivals for a curator to read**, most of them public art a traveller seeks out; a few are
  statues of people the kinds share with Monuments & memorials (the Karl Marx Monument, the Jan Hus
  Memorial), which #2069 reads.
- 24 marked works the readership named under the floor are refused by the rule by name — *Puppy* in
  the Guggenheim Bilbao's collection, Spoonbridge and Cherry in the Walker Art Center's garden,
  *Tuttomondo* on a church's wall, eight mausoleums and tombs — and appear in the run's report as
  refusals. The rule, not the door, keeps them out: a work on a venue's grounds is that venue's.
- The six tops read by fewer than 10,000 a year (*Alice in Wonderland* in Central Park, the Archibald
  Fountain) and the street-art districts outside the kind's classes (#2146, #2035) stay out.

## References

- Related ADRs: ADR-0023, ADR-0056, ADR-0127, ADR-0167, ADR-0168
- Related docs: `docs/tech/experiences.md` § Public art and Monuments & memorials;
  `docs/sources/global/atlas-obscura.md`;
  `docs/research/2026-10-25-how-public-art-enters-the-catalogue.md`;
  `docs/research/2026-10-30-what-other-signals-find-under-a-kinds-editions-line.md`
- Issues: #2034, #1992, #1997, #1953, #2145
