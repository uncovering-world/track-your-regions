# ADR-0033: Lighthouse is driven through its Node API, and the budgets keep Lighthouse CI's syntax

**Date:** 2026-08-24
**Status:** Accepted

---

## Context

Until #630 the repository measured nothing about performance: no budget, no lane, nothing that
failed when a change made a page slower. The symptoms were filed one at a time as someone
happened to notice them (#551, #557, #560). The product review asked for a formal mechanism —
a measured baseline, budgets set just above it, CI enforcement with the same "one command
locally, the same command in CI" shape as the repository's other quality lanes — and asked for
it now, while the UI is still cheap to change, so that an anti-pattern is visible in the pull
request that introduces it rather than felt months later.

The obvious tool is Lighthouse, and the obvious way to run it in CI is Google's own
`@lhci/cli`: N runs per URL, a median, an assertion language over audits and resource
summaries, reports on disk. On the day the lane was built, `@lhci/cli@0.15.1` pinned
`lighthouse@12.6.1` exactly — a version more than a year behind `lighthouse@13.4.1` — and
that pin pulled a dependency tree of 1,066 packages carrying twelve `npm audit` findings, nine
of them high severity (`puppeteer-core`/`@puppeteer/browsers`/`extract-zip`, `tmp`,
`brace-expansion`, `nanoid`, `uuid`, `inquirer`). All of them are development-only, and none is
reachable from the lane's actual use (the browser is the Playwright image's pinned Chromium,
never downloaded; nothing is uploaded anywhere), but they would surface as nine open advisories
on a repository that reviews every Dependabot alert by hand, for a tool of which the lane needs
a small part. `lighthouse@13.4.1` on its own resolves to 88 packages and no findings, but
Lighthouse 13 removed the `performance-budget` and `timing-budget` audits, so its native
`budgets.json` is no longer a way to express a budget either.

What the lane needs is small: audit a handful of URLs a few times each with a fixed preset,
keep one representative run per URL, compare a dozen numbers against committed thresholds,
write the reports where CI can pick them up, and print something a reader can act on.

## Decision

**1. Lighthouse runs through its Node API, from a runner this repository owns.**
`frontend/perf/lighthouse.mjs` launches the stack's Chromium with `chrome-launcher`, calls
`lighthouse()` with the desktop preset N times per URL, picks the representative run with
Lighthouse's own `computeMedianRun`, and writes every run's report. `@lhci/cli` is not a
dependency.

**2. The budgets keep Lighthouse CI's syntax and its file shapes.**
`frontend/perf/lighthouse-budgets.json` uses `"<key>": ["<level>", { maxNumericValue | minScore }]`
with `categories:<id>`, `resource-summary:<type>:size|count` and plain audit ids — the subset of
Lighthouse CI's assertion language the lane uses, evaluated by `frontend/perf/assertions.mjs`
and covered by a unit test. The runner writes `manifest.json` and `assertion-results.json` in
Lighthouse CI's shapes. Anyone who has read a `lighthouserc.json` reads ours; swapping
`@lhci/cli` back in touches the runner and nothing downstream of it.

**3. The evaluator fails closed.** A key it does not understand, a threshold the key does not
take, or an audit the report does not carry fails the assertion rather than passing it. A budget
that cannot be read is not a budget that was met.

**4. Bundle bytes are gated separately, without a browser.** `size-limit` measures the gzip size
of the entry chunk and the stylesheet after `vite build`, in CI's build job. Lighthouse's
`resource-summary` rows budget the same bytes as transferred, so a dependency that doubles the
chunk fails twice — once in the minutes the build takes, once with the page around it.

**5. What is measured is the production build, served compressed, on the isolated test stack,
with the desktop preset.** The frontend container gets a preview shape (`FRONTEND_MODE=preview`)
on the dev server's port and hostname; `vite preview` gets a compression middleware because
Lighthouse's simulated throttling works from transfer size and a raw 2.87 MB chunk is a download
no host sends. Desktop, because the product is a desktop map today (`mobile-planning.md` is a
plan). Byte budgets are `error` from the day they are set; timing budgets are calibrated on the
CI runner's own numbers before they become `error`, since a timing copied from a laptop gates on
the wrong hardware. The rule for moving a budget lives in `docs/tech/performance.md`.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| `@lhci/cli` as published | Pins `lighthouse@12.6.1`; nine high-severity advisories in its tree on the day of the decision, for a feature set the lane uses a small part of (no LHCI server, no upload, no diffing, no GitHub status). Also, the first attempt at the lane ran on it and its healthcheck could not see the Playwright image's Chromium without `CHROME_PATH` — no worse than the Node API, but no better. |
| `@lhci/cli` with `overrides` forcing `lighthouse@13` and the vulnerable transitive packages | Five to six overrides across packages `@lhci/cli` was never tested with; Lighthouse 13 changed the report in ways LHCI 0.15 does not know about. Fragile, and still a large tree. |
| Lighthouse CLI with its native `budgets.json` (`--budget-path`) | The `performance-budget` and `timing-budget` audits were removed in Lighthouse 13; the format is dead. |
| Playwright-driven custom metrics (`performance.getEntries()` from the smoke specs) | Reinvents the metric definitions, the throttling model and the report; loses the LCP-element and long-task diagnostics that make a red gate explain itself. |
| Lighthouse's `resourceSizes` alone for the bundle, no `size-limit` | Only runs in the browser lane, minutes after the build, and only sees what the audited pages load; a lazy chunk nobody navigates to would grow unbudgeted. `size-limit` runs where the build is and measures every file it is pointed at. |
| Mobile preset, or both | The product is desktop today; a 4× CPU slowdown on a 2.87 MB bundle describes a device the product does not yet address. A second entry in the budgets file when that changes. |

## Consequences

**Positive:**
- 88 packages and no advisories for the lane's dependencies; `npm audit` stays readable.
- The budget file reads like every other Lighthouse CI configuration on the web, so the
  learning curve is Lighthouse's, not this repository's.
- The runner is ~170 lines and the evaluator ~100, both plain ESM under `frontend/perf/`,
  unit-tested where it matters (the evaluator), and refusing the two mistakes made while
  building them — auditing the dev server, and running on the host.
- The reports, manifest and results are the same files Lighthouse CI writes, so the summary
  printer, the CI artifact and a future switch back are all unaffected by which tool wrote them.

**Negative / Trade-offs:**
- This repository owns an assertion evaluator. Every Lighthouse CI feature the lane comes to
  need — `assertMatrix` per URL, `aggregationMethod` other than the representative run,
  `auditProperty` paths beyond `resource-summary` — is a change here rather than a config line.
- The assertion syntax is a subset: a `lighthouserc.json` pasted in may use keys the evaluator
  fails on (by design, loudly).
- No Lighthouse CI server, so no history, no diff against the base branch, no GitHub status
  per URL. The history is the CI artifacts and `docs/tech/performance.md`.

**What would justify superseding this:** `@lhci/cli` tracking a current Lighthouse with a clean
tree, at a time when the lane wants something the evaluator does not offer — per-URL matrices,
a trend server, base-branch diffs. The file shapes are kept so that switch is a runner swap.

## References

- Related ADRs: ADR-0031 (the tile-ladder change the backend probe re-measured)
- Related docs: `docs/tech/performance.md`, `docs/tech/development-guide.md` § Performance
- PR / issue: #630, #645; the breaches the baseline found: #643, #644
