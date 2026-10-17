# ADR-0118: A Lighthouse budget may leave out a host the repository does not serve

**Date:** 2026-10-17
**Status:** Accepted

---

## Context

ADR-0033 decision 2 keeps the Lighthouse budgets to the subset of Lighthouse CI's assertion
language the lane uses, so that swapping `@lhci/cli` back in touches the runner and nothing
downstream of it. Every key in `frontend/perf/lighthouse-budgets.json` was one Lighthouse CI reads:
`categories:<id>`, `resource-summary:<type>:size|count` and plain audit ids.

#669 added two pages that load a region's data: the fixture's region page and its open card. Their
weight is mostly the OpenStreetMap raster basemap, about 30 kB a tile, and the number of tiles that
land before Lighthouse calls the page loaded is not the repository's to decide. Across the CI runs
of #1641, #1644 and #1646:

- the region page's total moved between 1.37 MB and 2.32 MB in CI, on 34 to 52 basemap tiles;
- the repository's own bytes held at 677.9–682.9 kB.

A total line set above the heaviest run of the first job failed the next unrelated pull request
at 2 317 656 B. A line over that spread gates the tile count, not a change.

Lighthouse CI's language has no key for "everything but one host". `resource-summary:third-party`
counts the stack's own backend and tile server as third parties, because every stack this
repository runs serves them from origins other than the page's. `performance.md` already declines
to budget that row for this reason.

## Decision

The budgets may use one key of the lane's own, `requests-except:<host>:size|count`: the bytes, or
the requests, of the `network-requests` audit, leaving out every request to `<host>` and its
subdomains, and every preflight. `frontend/perf/assertions.mjs` evaluates it and fails closed like
any other key. `scripts/lighthouse-summary.mjs` prints it in bytes or requests. The region and card
pages gate at `error` on `requests-except:openstreetmap.org`. Their basemap-inclusive totals are
read at `warn`, because a visitor pays for those tiles whoever serves them.

This narrows ADR-0033 decision 2. The budgets keep Lighthouse CI's syntax for every key it has, and
add this one where it has none. Swapping `@lhci/cli` back in would mean dropping these keys, or
replacing them with whatever measures the same thing. Until #651 moves the basemap off a public
server, nothing else does.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the total line and raise it above every run seen | The spread has no ceiling the repository controls. Each raise is reached by the next run that draws a few more tiles, and the line is then too wide to catch a change of the repository's own bytes. |
| `resource-summary:third-party:size` | It counts the backend and Martin as third parties, which on these pages are the data the page exists to show. Budgeting it would gate the stack's shape, which `performance.md` already declines. |
| Lighthouse budgets' `firstPartyHostnames` | It reclassifies hosts for the `third-party` row, but Lighthouse CI still has no row for first-party bytes. It moves the same problem rather than answering it. |
| Gate the total at `warn` only, with no byte gate on these pages | The pages' first-party bytes would go ungated except for the shared script, stylesheet and font lines. A read the card adds, of hundreds of kilobytes, would pass. |

## Consequences

**Positive:**
- The region and card pages gate on what a change to the repository moves: within 5 kB across
  eighteen CI runs, so a first-party growth of about 35 kB fails.
- The basemap's cost is still read on every run.

**Negative / Trade-offs:**
- One key is outside Lighthouse CI's language, and `@lhci/cli` would refuse it if it were swapped
  back in.
- The excluded host is named in the budgets file. A basemap moved to another host (#651) has to
  rename the key, or the gate starts counting the tiles again.

## References

- Related ADRs: ADR-0033 (decision 2 narrowed here)
- Related docs: `docs/tech/performance.md` § The region and card pages, § Budgets
- Issues: #669, #651; PR #1646
