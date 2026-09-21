# Review surface

A branch can keep the "one purpose per branch/PR" rule and still be too much to
review in one sitting. This document measures how much review the branches of
this repository have actually asked for, sets a soft budget from that history,
and says what happens when a branch is over it.

The budget is a **signal, not a gate**. Nothing fails because it was crossed: no
CI job runs this measure, and no branch protection consults it. What crossing it
buys is a decision made before reviewers arrive rather than after — split the
branch, or say why the surface is inherently one change (#923).

## Why not lines changed

`git diff --stat` does not predict review cost. Of the 55 non-Dependabot pull
requests merged between #779 and #946:

| PR | files | raw lines | review threads | what it was |
|----|------:|----------:|---------------:|-------------|
| #940 | 10 | 2 453 | 2 | one test file split into pieces |
| #935 | 50 | 2 931 | 2 | an API client split along its callers |
| #874 | 260 | 4 595 | 24 | one identifier renamed everywhere |
| #909 | 42 | 3 714 | 91 | new behaviour |
| #869 | 8 | 736 | 64 (over 21 hours) | four draft ADRs, no code at all |

Three kinds of churn dominate the line counts and cost almost nothing to read:
lines that **moved**, one token **renamed** across many files, and **generated**
output. One kind costs a great deal and barely shows up in the line count at
all: prose that states a decision. #869 changed no code and drew the longest
review in the set.

## What is counted

`surface` is a count of lines over the branch diff
(`git diff -M --unified=0 main...HEAD`), after four discounts:

1. **Meaningful lines only.** Blank lines and comment-only lines do not count —
   the same convention the file-size linter applies (`skipBlankLines`,
   `skipComments`; #530), so "counted lines" means one thing in this repository.
   In prose that rule applies to HTML comments alone: markdown writes a heading
   with `#` and a lead-in with `**`, and those are the text itself. Roughly a
   tenth of the lines under `docs/` open with one of the two, and dropping them
   would quietly undo the weight #869 is here to defend.
2. **Generated output counts nothing.** `package-lock.json`, `*.snap`, `*.lock`,
   and a `*.generated.ts` source file such as `backend/src/db/schema.generated.ts`
   (ADR-0064), which a generator writes and a gate holds to its input.
3. **Moved lines cancel.** An added line whose exact text is also deleted
   somewhere on the branch is a move, and both sides drop out. The pairing is
   branch-wide on purpose: a file split deletes a function in one file and adds
   it in another, and that is the case worth seeing through. Indentation is part
   of that text, with one exception: a line that matches only once trimmed still
   cancels when it **crossed into another file**, which is a block lifted into a
   new module and re-indented there. Within one file the same match is a
   re-indentation — in Python a change of behaviour, and in review a line to
   read — so it counts.
4. **A sweep of one token counts an eighth.** A deleted/added line pair whose
   tokens differ in exactly one substitution — `categoryId` → `sourceId` — is
   mechanical when that same substitution recurs five or more times on the
   branch. It is discounted rather than dropped, because a sweep still has to be
   glanced at, and a sweep of 240 files is still a lot of glancing. It is precise
   on this history: it fires on #874 (65% of its counted lines) and #816 (25%),
   and on no branch that carried behaviour — #888, #909, #839 and #858 measure
   0%, #892 1%.

What survives is weighted by what it is: code 1, prose in `docs/` or any `*.md`
½, a migration in `db/migrations/` ¼.

The measure is `scripts/review-surface.mjs`; `measureSurface()` is a pure
function of the diff text, and its tests state each rule above against a diff
written out in full.

## The budget: 800 counted lines

Of the 55 branches measured, 15 are above 800. What that separates:

| | branches | median threads | median review events | median commits | median hours open |
|---|---:|---:|---:|---:|---:|
| over 800 | 15 | **28** | 58 | 9 | 3.5 |
| 800 or under | 40 | **5** | 11 | 3 | 0.9 |

That five-fold difference in review threads is the entire claim the number
makes. It is not a claim that 801 lines is unreviewable; it is that a branch
above this line has historically cost about five times the review of one below
it, which is worth knowing before the first round rather than during the third.

For context, the distribution of surface over the 55: median 286, p75 1 338,
p90 2 128, maximum 5 502 (#888).

**File count is reported, not budgeted.** A files-changed budget would flag #935
(49 code files, 79 surface — a pure split) and let #869 through (8 files, no
code, 325 surface, the most expensive review in the set).

### Moving the budget

The number is a reading of history, so it is moved by re-reading history, never
by a branch that wants to pass. Re-run the baseline below over the branches
merged since, and change the number in the two places that hold it — the
`SURFACE_BUDGET` constant in `scripts/review-surface.mjs` and this document,
where it is both the section heading and the table above — in the same commit,
stating the new separation it buys. Nowhere else states the figure: the
development guide, `CLAUDE.md`, the docs index and `/pr-create` all point here
instead, so that a re-reading cannot leave four files quoting the old number. If the
separation has gone — if branches over the budget stopped costing more review —
that is a finding about the review process, not a licence to raise the number.

## Reproducing the baseline

The measurements above come from the merged pull requests themselves, fetched by
their head refs and measured against their merge base:

```bash
# `data/cache/` is gitignored, so a fresh clone has no directory to write into.
mkdir -p data/cache/review-surface

# The baseline's own pull requests, by number, minus Dependabot's. The range is
# pinned rather than "the latest N": a moving window would drop #779 and pull in
# whatever merged since, and the figures below would stop being reproducible.
# The search bounds the fetch by the window those pull requests merged in, so
# the answer does not depend on how many have merged since — a plain `--limit`
# window would quietly truncate the far end once enough had. The number filter
# is what pins the set; the dates only keep the fetch from growing.
gh pr list --state merged --search 'merged:2026-09-03..2026-09-20' --limit 200 \
  --json number,title,author,mergedAt,createdAt,additions,deletions,changedFiles \
  --jq '[.[] | select(.number >= 779 and .number <= 946)
             | select(.author.login | test("dependabot";"i") | not)]' \
  > data/cache/review-surface/prs.json

# The count is the check: short means the fetch, not the history, ran out.
test "$(jq 'length' data/cache/review-surface/prs.json)" = 55 || echo 'baseline incomplete'

# Each one's head, under refs/prs/<number>.
jq -r '.[].number' data/cache/review-surface/prs.json \
  | while read -r n; do git fetch -q origin "pull/$n/head:refs/prs/$n"; done

# What each one asked of its reviewers.
jq -r '.[].number' data/cache/review-surface/prs.json \
  | while read -r n; do
      printf '%s\t' "$n"
      node scripts/review-surface.mjs --base origin/main --rev "refs/prs/$n" --json | jq -c '{surface,files,moved,mechanical}'
    done
```

A later reading widens the range to the pull requests merged since and states
the new one here; it does not re-point the old one.

The review each drew — threads, review events, elapsed time — comes from the API
rather than from git:

```bash
gh api graphql -f query='query($n:Int!){repository(owner:"uncovering-world",name:"track-your-regions")
  {pullRequest(number:$n){number createdAt mergedAt commits{totalCount}
    reviews{totalCount} reviewThreads(first:100){totalCount}}}}' -F n=909
```

`data/cache/review-surface/` is gitignored: the inputs are bulky and re-fetchable,
and the conclusions are in this document.

## Using it on a branch

```bash
npm run review:surface                      # main...HEAD
npm run review:surface -- --base origin/main --rev my-branch
npm run review:surface -- --json
```

The scorecard reports the surface against the budget, what was discounted and
why, and then two breakdowns. **By area** is in the surface's own unit,
discounts applied, and sums to the figure at the top. **By commit** measures
each commit on its own — it ranks them, and does not sum: a line a later commit
revisits is counted in both, and a sweep spread thinly across commits clears the
five-occurrence bar in none of them. Those are the
seams: a branch over budget whose surface is split cleanly between `backend` and
`frontend`, or between its first four commits and its last three, is a branch
that wants to be two pull requests.

`/pr-create` runs this before opening a pull request. Over budget, it proposes a
split along those seams; when the surface is inherently one change, it records
the reason in the pull request body under **Additional Comments**, as one line
beginning `Review surface:`, so a reviewer opening a 3 000-line diff knows it was
a decision and what the decision was. A recorded reason is enough — the pull
request then proceeds normally.

Reasons the baseline shows to be real: a migration and every reader it changes
must land together (#874, #825); a source and the kind it fills arrive as one
thing or the catalogue is briefly wrong (#888, #848); a table's writers cannot be
split from the table. A reason that is not a reason: "it is all one feature",
which is what the one-purpose rule already required, or "splitting is work",
which is the work being weighed.

## The baseline, in full

55 non-Dependabot pull requests merged between #779 and #946, measured on
2026-09-20. "Reviews" counts review events (a bot posts many per round);
"threads" counts review conversations opened.

A surface in **bold** is over the budget.

| PR | files | raw lines | surface | commits | reviews | threads | hours |
|----|------:|----------:|--------:|--------:|--------:|--------:|------:|
| #888 | 98 | 10450 | **5502** | 22 | 71 | 33 | 8.5 |
| #839 | 45 | 8012 | **4664** | 14 | 38 | 17 | 9.9 |
| #892 | 67 | 8060 | **3945** | 11 | 58 | 28 | 3.5 |
| #848 | 96 | 7533 | **3478** | 13 | 38 | 18 | 1.9 |
| #858 | 64 | 5249 | **3428** | 14 | 121 | 62 | 5.3 |
| #825 | 80 | 5359 | **2128** | 7 | 44 | 21 | 2.6 |
| #909 | 42 | 3714 | **2092** | 6 | 188 | 91 | 7.2 |
| #802 | 40 | 3687 | **2089** | 7 | 61 | 30 | 3.3 |
| #919 | 42 | 4081 | **2058** | 4 | 84 | 40 | 7.8 |
| #832 | 53 | 3658 | **1727** | 6 | 92 | 44 | 5.1 |
| #903 | 36 | 3182 | **1726** | 9 | 36 | 17 | 2.5 |
| #860 | 45 | 2581 | **1474** | 10 | 86 | 41 | 5.6 |
| #830 | 44 | 3087 | **1437** | 10 | 21 | 10 | 1.2 |
| #874 | 260 | 4595 | **1338** | 4 | 39 | 24 | 1.8 |
| #902 | 24 | 1864 | **980** | 5 | 15 | 7 | 0.9 |
| #837 | 44 | 1471 | 751 | 7 | 40 | 19 | 1.7 |
| #904 | 32 | 1357 | 749 | 9 | 9 | 4 | 1 |
| #826 | 21 | 1546 | 687 | 3 | 24 | 12 | 2.3 |
| #787 | 11 | 785 | 498 | 4 | 27 | 14 | 9.1 |
| #810 | 21 | 819 | 466 | 6 | 9 | 4 | 0.5 |
| #866 | 14 | 1018 | 451 | 5 | 17 | 8 | 1 |
| #871 | 14 | 713 | 425 | 4 | 13 | 6 | 1.1 |
| #816 | 57 | 1015 | 415 | 6 | 27 | 13 | 0.7 |
| #813 | 18 | 677 | 411 | 5 | 15 | 7 | 0.8 |
| #829 | 2 | 539 | 369 | 2 | 17 | 8 | 1.1 |
| #869 | 8 | 736 | 325 | 2 | 135 | 64 | 21.3 |
| #879 | 7 | 622 | 319 | 2 | 8 | 4 | 2.4 |
| #854 | 32 | 1261 | 286 | 8 | 12 | 6 | 0.4 |
| #865 | 33 | 496 | 265 | 5 | 11 | 5 | 0.8 |
| #939 | 11 | 488 | 260 | 4 | 14 | 7 | 1.1 |
| #784 | 16 | 1099 | 259 | 6 | 23 | 11 | 2.2 |
| #941 | 11 | 1484 | 240 | 3 | 13 | 6 | 1.8 |
| #940 | 10 | 2453 | 217 | 1 | 5 | 2 | 0.8 |
| #836 | 15 | 429 | 183 | 3 | 31 | 13 | 6.9 |
| #800 | 7 | 281 | 182 | 3 | 0 | 0 | 1.4 |
| #811 | 8 | 333 | 170 | 2 | 13 | 6 | 9.1 |
| #873 | 6 | 537 | 166 | 3 | 11 | 5 | 3.5 |
| #820 | 6 | 317 | 153 | 2 | 27 | 13 | 2.1 |
| #936 | 9 | 2170 | 140 | 2 | 1 | 0 | 0.4 |
| #943 | 8 | 692 | 122 | 3 | 9 | 4 | 1.1 |
| #821 | 33 | 219 | 98 | 3 | 7 | 3 | 1.9 |
| #779 | 6 | 211 | 91 | 2 | 7 | 3 | 0.7 |
| #946 | 14 | 3287 | 84 | 2 | 19 | 9 | 0.7 |
| #934 | 7 | 104 | 83 | 3 | 2 | 1 | 0.9 |
| #935 | 50 | 2931 | 79 | 3 | 4 | 2 | 0.8 |
| #782 | 5 | 184 | 79 | 2 | 25 | 12 | 0.5 |
| #938 | 7 | 2380 | 69 | 1 | 7 | 3 | 0.3 |
| #838 | 9 | 214 | 61 | 3 | 9 | 4 | 0.9 |
| #937 | 9 | 2279 | 60 | 1 | 0 | 0 | 0.3 |
| #901 | 4 | 112 | 44 | 2 | 5 | 2 | 0.4 |
| #928 | 4 | 96 | 39 | 2 | 6 | 3 | 0.6 |
| #944 | 7 | 2717 | 32 | 1 | 9 | 4 | 0.5 |
| #827 | 2 | 52 | 29 | 1 | 5 | 2 | 0.6 |
| #942 | 5 | 1113 | 26 | 1 | 8 | 4 | 0.4 |
| #898 | 3 | 23 | 11 | 1 | 2 | 1 | 0.3 |
