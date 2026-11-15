# ADR-0209: The kept gather of places is keyed by what it asks, and the pool by its own code

**Date:** 2026-11-15
**Status:** Accepted

---

## Context

A dry run of the place pass reads back the gather of places and the surroundings pool kept from
an earlier run on the same inputs (ADR-0196, #2424). The code part of ADR-0196's key was one hash
for both steps. It covered every module the static import graph reaches from `gather.ts`,
`surroundingsPool.ts`, `keptGather.ts` and each pass kind's declaring module.

A kind's declaring module also reaches its rule. Squares & streets' `kind.ts` reaches
`declaredKind.ts` and `worldTier.ts`, and its exceptions sit in `classes.ts`. Public art's
`pipeline.ts` reaches `kindRules.ts`, `publicArtTest.ts` and `streetArtTest.ts`. The kept-step
format reached the dump builds too, through `dumpsDir` in `buildQueue.ts`, and the gather read
the admission register, which holds every number of the frame. So a change to any kind's verdict,
exceptions or world bars made both steps again, about 23 minutes on the development stack, though
the gather of places reads no rule (#2448). Settling a rule over a series of dry runs (#2311,
#2069) is what ADR-0196 was for.

What the gather of places does with a kind is to walk its trees (`trees`), ask the pool by the
classes it reads off them (`poolClasses`), and, beside that, run its entrances and its editions,
read containers and subjects where the kind's rule reads them, and ask an admission pool at the
kind's floor. The share it keeps holds the trees too, and the rule reads them.

## Decision

Decision 2 of ADR-0196 is narrowed: the two steps get keys of their own, and the code part of
each is its own.

1. **The gather of places is keyed by what it asks each kind, as data, and by its own code.**
   - **As data** (`gatherQuestion` in `keptGather.ts`), in the order the kinds are asked for:
     - each kind's name;
     - the classes it asks by, read off the trees the run walked, broad roots with their labels
       and narrow classes sorted;
     - the floor of its admission pool (`PlaceKind.admissionPool`, now the number itself, so the
       gather no longer reads the register);
     - whether its rule reads containers and subjects;
     - the names of its entrances, and whether it has editions.
   - **As code:** `gather.ts`, `keptGather.ts`, and the modules a kind's entrances and editions
     are declared in (`KIND_GATHER_MODULES` in `placePass.ts`, today `publicArt/entrances.ts`).

   No kind's declaring module is in either part, and `placePass.test.ts` checks that the gather's
   code reaches no module a kind's verdict, exceptions or world bars are declared in.
2. **The trees are walked every run and are not kept** (`walkTrees` in `gather.ts`). A kept
   gather hands each kind the trees this run walked. A tree only the rule reads, such as a new
   refusal or an exception's tree, is read afresh rather than read stale, and it changes nothing
   the gather asks. A tree that changes the classes asked by changes the question, so the gather
   is made again.
3. **Entrances and editions are code.** Their answers cannot be named without running them, and
   `attach` runs on the gathered pool. So each kind declares them as one object in a gather-side
   module, which imports no rule. The street-art entrance and its four constants move out of
   `streetArtPlaces.ts` and `streetArtTest.ts`, and the cast groups' and gardens' attach step
   moves out of `pipeline.ts`.
4. **The surroundings pool keeps a key of its own.** Its key holds:
   - the gather's key;
   - what the pool is asked, as data (unchanged);
   - its own code: `surroundingsPool.ts`, `surroundingsTier.ts`, `keptGather.ts` and every pass
     kind's declaring module.

   That code reaches the surroundings cut and its register, the venue references and the
   readers' venue-line code. A change to the surroundings door, or to a kind's rule, still makes
   the pool again. Only the gather of places, about 6 minutes, is kept across such a change.
5. **The kept-step format imports no step's code but the gather's.** `poolOf` takes the pool's
   reader, and `dumpsDir` moves to `localCopies.ts`. So `keptGather.ts` sits in both keys
   without bringing the pool or the dump builds into the gather's.

The builds and the admitted rows stay in both keys, as ADR-0196 decided.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Split each kind's gather-side declaration (classes, entrances, editions) into modules the rule imports and the gather does not, and keep the trees | A declared kind's declaration holds each refusal's root beside its reason, and its exceptions beside the trees they name. Splitting it would cut every declaration in two. A kept share also holds the trees the rule reads, so a new refusal would still have to make the gather again. Keying by data needs no change to the declared kinds, Places of worship or Archaeology. |
| Key by the trees as data and keep them | Every tree the rule reads would be in the key, so a refusal or an exception naming a new tree would make the gather again. Walking the trees afresh keeps it. |
| Key the entrances and editions by their answers | `attach` runs on the gathered pool, and the entrances read the category copy and the database, so their answers are known only by running them. The code of the one module that declares them is enough, and the guard spec holds it to that. |
| Leave the pool on the gather's code key | The pool runs the readers' venue-line code and reads the surroundings cut. With the gather's code no longer reaching the kinds' declarations, that key would read a stale pool after a surroundings change. |

## Consequences

**Positive:**
- A change to a kind's verdict, exceptions or world bars keeps the gather of places. Before this,
  every module of `declaredKind.ts`, `worldTier.ts`, `worldBars.ts`, `admissionRegister.ts`,
  the three declared kinds' `classes.ts`, `kindRules.ts`, `publicArtTest.ts`, `streetArtTest.ts`,
  `worshipTest.ts`, `siteTest.ts` and `masts.ts` was in the one key. Now none is in the gather's.
- Of the last 40 commits to `services/sync` on main (983cf2c4a to dae79ae8b), the old key would
  have kept both steps on 23. The new gather key keeps the gather on 27 and the pool on 23. The
  4 more are the readership's folding, a surroundings-door change (the venue test of Squares &
  streets, c9552bf46, which still makes the pool), the runs between swaps and the layer's street
  lines. No commit of that window changes a kind's rule alone.

**Negative / Trade-offs:**
- Every dry run walks the kinds' trees, a kept gather or not, since the key reads the classes off
  them. The walk is part of the gather's minutes and was not measured on its own.
- Public art's class lists (`publicArt/classes.ts`) and its monuments-category module stay in the
  gather's code. The container step and the gardens read the first, and the entrance sits beside
  the reading the verdict uses. A change to either still makes the gather again.
- The pool is made again on a rule change, as before: it runs the readers' code, which a kind's
  declaration holds.
- A kind that joins the pass with entrances or editions declares them in a module of
  `KIND_GATHER_MODULES`. `placePass.test.ts` fails until it does.

## References

- Related ADRs: ADR-0196 (decision 2 narrowed here), ADR-0132 (one gather for the pass),
  ADR-0171 (the surroundings pool), ADR-0175 (the admission frame)
- Related docs: `docs/tech/experiences.md` § Several kinds from one gather
- PR / issue: #2448
