# ADR-0196: A dry run of the place pass reads the shared steps kept on the same inputs

**Date:** 2026-11-11
**Status:** Accepted

---

## Context

A rule change to one place kind is tried with a dry run of that kind alone (#2424, *Preview
<kind> alone*). The run still makes the pass's shared steps whole (ADR-0132), because the kind's
rule reads them:

- **the gather of places** (`gatherPlaces`): every kind's candidates and what is known of them;
- **the surroundings pool** (`readSurroundingsPool`, ADR-0171): every candidate measured
  against its neighbours;
- **the gather of works** (`gatherPassWorks`).

The kind's own share is a small part of the run. Measured on the development stack on
2026-11-11, on main 595267e85 (a throwaway container that made the steps and serialized each
with `v8.serialize`):

| Step | Minutes | Bytes |
|---|---:|---:|
| Gather of places | about 6 | 84.5 MB (Places of worship 43.8, Public art 12.2, Archaeology 10.1, Squares & streets 8.7, Bridges 8.0, Towers 4.1) |
| Surroundings pool | about 17, of which 14.6 read a year of readers for 517,241 items | 267.4 MB |
| Gather of works | about 1 | 1.3 MB |

Squares & streets' own share took 1.9 minutes on logs 827–834. A rule is settled over several dry
runs (#2311, #2069), and each one makes the same steps from the same inputs again.

## Decision

1. **Every run of the pass on the local subset keeps the gather of places and the surroundings
   pool, and only a dry run reads them back.** A real pass always makes them afresh. A run
   *without the cache* makes them afresh too. A run that reads the live query service keeps
   nothing, since no build names what that service answered. The gather of works is not kept: it
   takes a minute, and its collectors are functions whose inputs are hard to name.
2. **A kept step is read back only under the same key.** The key has three parts:
   - **The builds in place:** how many dump builds have succeeded, and the newest of them.
     Every table the two steps read is made by a dump build: the subset, the readers' months,
     the redirects, Wikivoyage's usage and the OpenStreetMap layer. So any build that has
     succeeded since the step was kept makes it again, the daily layer diff included.
   - **The rows each kind admits before the run,** which its share is asked for by id. A
     real pass between two dry runs changes them; a dry run writes none.
   - **The code that makes the step:** a hash over every module the static import graph
     reaches from `gather.ts`, `surroundingsPool.ts`, `keptGather.ts` (the format a step is kept in) and each pass kind's declaring module
     (`PASS_KIND_MODULES`, `codeGraph.ts`), the modules of `@tyr/shared` it imports included:
     a kind's type vocabulary is declared there. Type-only imports are left out. A module the
     graph cannot find refuses the key, and a run with no key keeps and reads nothing.

   The pool's key adds what the pool is asked for, as data: its classes and items, the classes
   whose venues it counts (ADR-0192), the cut and the groups. The venues are read from the
   OpenStreetMap layer, and every layer swapped in is a dump build, so they follow the builds.
3. **Both steps are kept as files in the dumps directory**, one per step (`kept-gather/places-<key>.v8`,
   `pool-<key>.v8`, about 350 MB together). They are workbench data, derived and made again at
   will. A file is written to a `.part` and renamed, and it replaces the step's older file. A file
   that cannot be read, or does not hold a step of its kind, is made again; a step that cannot be
   written is logged and the run goes on.
   A step is written and read in slices (`slicedV8.ts`): every Map of more than 5,000 entries
   is one `v8.serialize` frame per 5,000 entries, and the backend serves its other requests
   between frames. On a value shaped like the pool (2.1 million rows, 277 MB), one
   `v8.serialize` held the event loop for 2.8 s and one `v8.deserialize` for 7.2 s. Sliced, the
   longest pause was 111 ms writing and 585 ms reading (99th percentile 81 and 147 ms), over 4.4 s
   and 11.9 s in all. A Map held in two places is written once and read back as one Map. An
   entity two kinds' pools both hold is written once per kind, unlike in one `v8.serialize`,
   so the files are somewhat larger than the sizes above, which one `v8.serialize` measured.
4. **The run's closing line says what it read back:** the step, when it was kept, and the builds
   its key names (`completionMessage`). A preview made on a kept gather is never read as one that
   made it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Key the code on every file under `services/sync` | Not one of the last 40 commits to `services/sync` on main would have kept the steps. The import graph of the two steps and the kind declarations leaves 10 of them unchanged. These change what a run does after the gather: what a memorial commemorates, the writers, Archaeology's surroundings sites. |
| Key the code on the two steps' own modules only, not the kinds' declarations | A kind's classes, entrances and editions are code the gather runs. A change to them changes the gather, so a key that skipped them would read a stale gather. |
| Key the builds on the ones each step reads, not every build | The list of tables a step reads would have to be kept by hand. A new reader would forget it, and a stale read is worse than one more made step. |
| Keep the steps as a `bytea` row | 350 MB in a row is a poor fit for the workbench tables. A file beside the dumps is read and replaced whole, which is all a kept step needs. |
| Keep the gather of works too | A minute's saving, against a key that would have to name every collector's inputs. |

## Consequences

**Positive:**
- A second dry run on the same builds, admitted rows and code skips about 23 minutes. On
  Squares & streets that brings a dry run from 20 to 25 minutes down to about 3: the gather of
  works and its own share. Such runs include:
  - the dry run of the whole pass that follows a one-kind dry run of the same head;
  - a dry run of another kind of the same head;
  - main's dry run again, after a merge that touched only what runs after the gather.

**Negative / Trade-offs:**
- The key reads the static import graph, which errs towards making a step again. Some changes
  touch a module the step imports but never calls, and still make it again: `admissionRegister.ts`,
  for one. 30 of the last 40 sync commits would have made the steps again.
- **A kind's rule is in the key.** A kind's declaring module also reaches its rule: Squares &
  streets' `kind.ts` → `declaredKind.ts` → `worldTier.ts`, with its exceptions in `classes.ts`;
  Public art's `pipeline.ts` → `kindRules.ts`. So a change to a kind's rule makes both steps
  again, though the gather of places does not read the rule. #2448 keys the kind side by what
  the gather asks.
- What the gather asks the live service beside the subset (`SubjectRunner.live`, what a
  sculpture depicts) is kept with the step. A later dry run under the same key reads the answer
  as it was, for as long as no build succeeds.
- The dumps directory holds about 350 MB more.
- Reading the pool back takes about 12 seconds, with the backend held for up to about half a
  second at a time. Making it takes 17 minutes.

## References

- Related ADRs: ADR-0132 (one gather for the pass), ADR-0171 (the surroundings pool),
  ADR-0091 (a gate's result is reused on the same inputs, never across them)
- Related docs: `docs/tech/experiences.md` § Several kinds from one gather, `docs/tech/filling-a-kind.md`
- PR / issue: #2424
