# ADR-0093: The web unit lane runs under happy-dom, not jsdom

**Date:** 2026-10-12
**Status:** Accepted

---

## Context

Every spec file of the web unit lane gets a fresh document to render into
(`environment` in `frontend/vite.config.ts`), and building it is a fixed cost
per file. After #1377 cut the import cost, the environment was the largest
share of a whole run left: on the development machine (4 cores), Vitest put the
jsdom environment at 158 s and the tests themselves at 157 s, summed over the
workers, in a 207 s run started with the machine idle.

happy-dom is the other DOM Vitest supports out of the box. Measured on the same
machine with everything else unchanged, it ran the lane in 189 s against 222 s
at the machine's usual load, with one spec failing.

Neither environment is a browser. Both have no layout, no WebGL and no workers.
The web's specs and components carried about twenty comments naming what jsdom
cannot do, and each was a claim the switch could make false. Checked against
both environments by rendering:

| Claim | jsdom 26 | happy-dom 20.14 |
| --- | --- | --- |
| no layout (`getBoundingClientRect`, `offsetHeight` read 0) | holds | holds |
| no WebGL, no `Worker` | holds | holds |
| a click does not move the focus | holds | holds |
| no `ResizeObserver` | holds | a class whose `observe` does nothing |
| no `scrollIntoView` | holds | implemented |
| `:focus-visible` is not implemented | false | false |
| `getComputedStyle` does not resolve emotion's injected sheets | false | false |

## Decision

The web unit lane runs under happy-dom, and jsdom leaves `frontend/package.json`.

A workaround for a gap stays only where happy-dom has the gap too:

- The virtualised lists still give their scroll container a height, since
  neither environment lays anything out. Their own no-op `ResizeObserver` goes:
  happy-dom's never reports either.
- `scrollIntoView` is called on the row and the group header without an
  optional chain on the method, which every browser has and happy-dom has too.
- The focus ring and the treasures chip are checked on their computed style,
  not by searching the emitted CSS: both environments resolve the sheets, and a
  computed style is the chip's own, where a match in the CSS could be any
  chip's.
- The work tile's tooltip is checked through the keyboard focus its test is
  named after, not through a hover, since a scripted focus satisfies
  `:focus-visible`.

A comment that names the environment names happy-dom.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep jsdom | It costs about a sixth of a whole run, and the specs gain nothing from it that happy-dom lacks: every gap a spec works around is shared, and where the two differ happy-dom is the closer to a browser. |
| happy-dom for most specs, jsdom for some | No spec needs jsdom. Two environments would mean two sets of gaps to remember. |
| A real browser (Vitest browser mode) | It answers the layout and WebGL gaps, at the cost of a browser per run. The smoke lane already drives one; the unit lane is the fast one. |

## Consequences

**Positive:**

- A whole run of the web lane is shorter; the figures are in
  `docs/tech/gates.md` § The web unit lane.
- Four specs assert what they are named for: a computed size, a computed
  outline, a keyboard focus.

**Negative / Trade-offs:**

- happy-dom is younger and less complete than jsdom, and a spec may meet an API
  it does not implement. The answer is the one jsdom needed: stub it in that
  spec and say why.
- happy-dom releases before 20.0.0 carry a VM-escape advisory
  (CVE-2025-61927). The lane runs only the repository's own code in it, and
  the 20.x line evaluates no page script by default. happy-dom is a
  devDependency, so `npm run security:deps`, which audits production
  dependencies only (`--omit=dev`), never reads it. A later advisory against it
  surfaces where every other devDependency's does: in the repository's
  Dependabot alerts, which read the whole of `frontend/package-lock.json`.

## References

- Related ADRs: ADR-0062 (the gate map)
- Related docs: `docs/tech/gates.md` § The web unit lane
- PR / issue: #1388, #1377
