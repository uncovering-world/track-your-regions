# Create Pull Request

Create a pull request for a branch, filling in the PR template based on the actual changes.

## Arguments

$ARGUMENTS — optional: branch name. If not provided, list branches with unmerged commits and ask which to create PRs for.

## Instructions

### 1. Determine which branches to process

If $ARGUMENTS provides a branch name, use that branch.

If no argument, analyze all local branches that don't have an open PR:

```bash
# List local branches with unmerged commits (excluding main)
git branch --no-merged main --format='%(refname:short)'

# List branches that already have open PRs
gh pr list --state open --json headRefName --jq '.[].headRefName'
```

Filter to only local branches without an open PR. For each, gather a quick summary (commits, files changed) and present a table with your recommendation:

```
| # | Branch | Commits | Summary | Recommendation |
|---|--------|---------|---------|----------------|
| 1 | add-feature-x | 3 | New feature X | Create PR |
| 2 | backup/old-stuff | 47 | Old backup branch | Skip (backup) |
```

Recommendations:
- **Create PR** — focused branch with clear purpose
- **Skip (backup)** — branch name suggests it's a backup (`backup/`, `-backup`, `old-`)
- **Skip (stale)** — very old commits with no recent activity
- **Review first** — large diff or unclear purpose, user should decide

Ask the user to confirm which branches to create PRs for.

### 2. Rebase branches on top of main

Before creating PRs, ensure each branch is rebased with fast-forward on top of the latest main:

```bash
git fetch origin main:main  # fast-forward local main — and nothing else: a refspec-less
                            # `git fetch origin` would refresh origin/<branch> too, making
                            # the per-branch lease below vacuous
```

If the working tree is dirty, stash before switching branches:
```bash
git stash --include-untracked  # if needed
```

For each branch:
```bash
git checkout <branch>
git rebase main
git push --force-with-lease    # first push of a new branch: git push -u origin <branch>
```

Rewriting your own branch's history and force-pushing it is this repo's normal flow — `--force-with-lease` is all the protection needed here, *because* the fetch above touched only `main`: the lease compares against your remote-tracking ref, which still holds the last state of the branch you actually saw. A refused push means someone else pushed to the branch — fetch it, read what arrived, fold it in, push again.

After rebase, check if the branch still has commits ahead of main:
```bash
git log main..<branch> --oneline
```

If empty (all commits were already in main), **skip this branch** — report it as "already merged" and do not attempt to create a PR.

If rebase has conflicts, stop and report them to the user — do not force through.

After all rebases, restore the stash if one was created and return to the original branch.

### 2.5 Verify clean branch history (mandatory gate)

The branch history must be clean before a PR: **no commit may exist solely to fix, amend, or "address review" on an earlier commit of the same branch.** Each commit must be self-contained and independently reviewable (see `docs/tech/development-guide.md` § "Granular Commits").

Inspect the subjects and the diffs:

```bash
git log --oneline {base}..HEAD
```

If any commit just patches a previous one on this branch (e.g. "fix typo from <earlier>", "address review", "harden X added two commits ago"), **STOP and fold it into the original** before proceeding — run `/pr-changes-amend`. Only continue to the PR once every commit stands on its own.

### 2.6 Measure the review surface (before the first review round)

A branch can keep the one-purpose rule and still be far more than one sitting's
review. Measure that **before** the PR exists — after it, splitting means moving
reviewed code between histories and reopening threads that were already answered:

```bash
npm run review:surface -- --base main --rev <branch>
```

The scorecard reports the surface in counted lines against the budget, what
was discounted — moved lines, a swept token, generated output — and two
breakdowns, **by area** and **by commit**. Those are the seams. Read the commit
column as a ranking only: each commit is measured on its own, so it does not sum
to the headline, and the saving a split actually buys is the surface of the
proposed halves, measured.

- **Within budget** — say the number in one line and carry on to step 3.
- **Over budget** — read the seams before proposing anything. When the surface
  divides cleanly (an area the rest does not touch; a run of the first N commits
  that stands alone), propose that split to the user concretely: which commits go
  to which PR, in which order, and which one the other depends on. The user
  decides; do not split a branch unasked.
- **Over budget and inherently one change** — record the reason. Put one line in
  the PR body's **Additional Comments** section, written for the reviewer who is
  about to open a large diff:

  ```
  Review surface: 1 338 counted lines, over the budget — a migration and every
  reader of the renamed column land together or the catalogue is briefly wrong.
  ```

  `docs/tech/review-surface.md` lists the reasons this repository's history shows
  to be real and the two that are not.

This **never blocks**. There is no CI job and no branch-protection check behind
it; a PR with a recorded reason proceeds exactly like any other. Crossing the
budget buys one decision made early, not a refusal.

Also confirm the gates this branch asks for ran on it. **A gate runs when, and only when, the inputs it checks have changed.** `scripts/gates.mjs` is the map from each gate to its inputs; `npm run gates` prints which gates the current change asks for and why the rest are skipped; `docs/tech/gates.md` has the map and the reasoning. Before every commit: `npm run check` (the fast gates the change asks for; `npm run check:all` forces every one), `npm run gates -- run test` (the unit lanes it asks for; `TEST_REPORT_LOCAL=1` keeps them on the host), and `/security-check`. Before the pull request opens, and again on the head the maintainer is asked to merge when a review wave since then touched their inputs: `npm run security:all` (the fast gates plus the slow Semgrep and Trivy scans the change asks for) and, when `npm run gates` lists them, `npm run test:e2e:smoke`, `npm run test:db` and `npm run perf:local` — a review-wave push owes the per-commit tier alone, and CI answers for the slow lanes on the pushed head (`/commit` § 8 holds the rule, #920). A gate the map skips was not run and did not need to be; a gate the host cannot run (the Python tooling guard) is a failure to report, not a skip. CI reads the same map per job, so a skipped job is a job whose inputs the pull request does not touch.

Run `npm run gates -- --base main` on the branch, on a clean tree, to get that list as the reviewer's CI will compute it, and say in the PR what ran. (`--rev HEAD`, the default, reads the working tree and the untracked files too, which CI never sees; on a clean tree the two agree.) A job reported green because its inputs were untouched is not a job that found nothing wrong — it is a job that had nothing to read.

### 3. For each branch, analyze the changes

Switch context to the branch (without checking it out) and gather info:

```bash
# Commits on this branch since diverging from main
git log main..<branch> --oneline
git log main..<branch> --format='%s%n%n%b---'

# Full diff against main
git diff main...<branch> --stat
git diff main...<branch>
```

From this, determine:
- **What changed**: summarize the purpose of the branch's commits
- **Related issues**: look for issue references in commit messages (`#123`, `Closes #123`, etc.)
- **Files changed**: list of modified/added/deleted files
- **Type of change**: feature, bug fix, refactoring, docs, etc.

### 4. Fill in the PR template

Use the project's PR template (`.github/PULL_REQUEST_TEMPLATE.md`) and fill each section:

#### Description
Write a clear summary of what the branch does and why. Derive this from the commit messages and the actual diff — don't just repeat commit titles. Group related changes if there are multiple commits.

#### Related Issues
- If commit messages reference issues, include them with `Closes #N` / `Fixes #N` (the merge closes the issue) or `Part of #N` (partial progress — the issue stays open). Use `Relates to #N` only for a loose association that should not drive the issue's board status.
- Also search open issues for matches: `gh issue list --state open --limit 500 --json number,title` (the default `--limit` is 30, far below this repo's open count) — look for issues related to the branch's changes by title/keyword
- If no issues are referenced and none found, write "None"

#### How Was This Tested?
- If the branch includes test files, mention the tests added/modified
- If it's a config/docs/tooling change that doesn't need tests, say "N/A — configuration/documentation change"
- If it's code without tests, note "Manual testing" or flag that tests are needed

#### Checklist
Fill in the checklist based on actual state:
- Check commit messages: are they well-formatted with title + body?
- Check signatures: `git log main..<branch> --format='%G?'` or look for `Signed-off-by`
- Check for related issues (already gathered above)
- Lint status: run `npm run check` — it runs the fast gates this branch's diff asks for and names the ones it skipped, so a docs-only branch needs no judgement call about whether to run it

#### Additional Comments
Add any notable context: migration notes, deployment considerations, or things the reviewer should pay attention to. Leave empty if nothing special.

### 5. Create the PR

```bash
gh pr create --base main --head <branch> --title "<title>" --body "$(cat <<'EOF'
<filled template>
EOF
)"
```

PR title rules:
- Under 70 characters
- Imperative mood ("Add X", "Fix Y", not "Added X" or "Fixes Y")
- Derived from the branch's overall purpose, not just the last commit

The review bot reviews the PR once it is open, unless it is a draft — a draft is reviewed when it is marked ready. After that a push on its own brings no review; § 8 asks for each further round.

### 6. Update the board

For every issue the PR references (`Closes #N` / `Fixes #N` / `Part of #N`), move it to review on the org board:

```bash
scripts/board.sh status <N> "In review"
```

The board update is best-effort: if it fails because the token lacks the `project` scope, run `gh auth refresh -s project` (or note the miss and continue) — it must not block the work itself.

An issue referenced with `Closes`/`Fixes` goes ✅ Done automatically when the merge closes it. A `Part of #N` issue stays open — after the merge, move it back to 📋 Backlog (or 🏗 In progress if its work continues) by hand.

### 7. Report results

For each PR created, show:
- PR number and URL
- Title
- Brief note on what was included

If multiple PRs were created, show a summary table at the end.

### 8. Babysit the PR until it is mergeable

Creating the PR is not the end of the job — an open PR is unfinished work. Stay on it until it is mergeable: checks green, every review thread answered, no conflicts with main. Poll periodically rather than waiting to be asked, and do not move on to other branches while checks are red or reviewers are unanswered. One carve-out: a stacked chain built by `/vibe-history` opens all its PRs first (that command owns the ordering and the nothing-lost verification) and then this loop covers the whole chain together.

**Checks.** `gh pr checks <number>`. CI binds the branch, not the round (#920): a job already red when the round ends (*The next round* below) is fixed in the same wave, and one first seen after the round ends — while the wave is being assembled or after its push — opens a wave of its own — never a wait on the full run before a wave starts. A wave's push owes the per-commit tier locally (`/commit` § 4); the slow tier's second owing, on the head the maintainer is asked to merge, is *Done* below's — and it is answered from a reading this step takes **before the fold**, while the pushed head is still an ancestor of the local branch and before any rebase onto main: `git diff --name-only $(gh pr view <number> --json headRefOid --jq .headRefOid) HEAD` plus `git status --short` for edits not yet committed is every path the wave changed, `fixup!` or not; the classes among them (`app`, `python`, `tooling` — `docs/tech/gates.md` § Inputs) are what the round comment's `Touched:` line says (*Dispositions* below, `/commit` § 8). Read it after the fold and the evidence is gone — the fold is `git rebase --autosquash main` (`/pr-changes-amend` § 4), so the tree then carries main's churn too. The one wave that *is* a rebase — a conflict-resolving one, a round of its own (*The next round* below) — reads the files its resolutions edited, the ones the rebase reported in conflict; a reading that also counts what main moved over-reports, which is the safe direction. On a failure, read the actual failing log (`gh run view <run-id> --log-failed`), reproduce locally, and fix. A fix is folded into the commit that owns the broken code — run `/pr-changes-amend` (for a dependent member of a stacked chain, pass its dependency branch as the base: `/pr-changes-amend <dependency-branch>` — the default `main` base would let the mapping reach the root's commits and rewrite them inside the dependent; and when the amended commit belongs to a chain member that itself **has** dependents, create the `fixup!` on the chain's top branch and fold from there with `git rebase --autosquash --update-refs origin/main`, so the rewrite carries into every dependent and all refs move together — then force-push each branch of the chain) — never appended as an "address review" commit; then `git push --force-with-lease` (see "Conflicts and staleness" below for the one rule that keeps that safe). Pushing its own amends unattended is this loop's normal operation (the carve-out is stated in `/pr-changes-amend` and `/commit` too): the branch is under this loop's stewardship, `--force-with-lease` refuses to clobber anything it has not seen, every amend answers a review thread that gets a reply naming the fix, and parking each wave for a manual push would defeat "stay on it until it is mergeable".

**The next round.** A push brings no review on its own — the bot reviews a pull request when it is opened or marked ready, and after that only when asked (`claude-review.yml`, #796). So once the wave has landed — its `git push --force-with-lease`, or, for a wave with no push because every finding was declined with a reason, its last reply — comment `/review` on the PR:

```bash
gh pr comment <number> --body '/review'
```

One per wave. The order of a wave is stated in full here only; `/pr-comments-reply` § 6, `/pr-changes-amend` § 6, `/review-pr` steps 4–7, the guide's § Review Rounds and the *Dispositions* paragraph below each carry the unlabelled sequence in passing and point here for the label case, so an edit to this order visits those five too: on a PR without the `review-on-push` label, push (when there is one) → replies in the threads (`/pr-comments-reply`) → the round comment (*Dispositions* below) → `/review`; on a PR that carries the label, replies → round comment → push, because there the push is what starts the run, and a run that has started reads nothing posted after it. Either way the re-review reads the replies and the dispositions — the bot verifies each fix at the head, accepts a reasoned decline, and resolves its own threads it finds addressed or reasonably declined. A rebase that resolved conflicts is a wave too and gets one; a rebase that left `git diff origin/main...HEAD` unchanged gets none, since there is nothing new to read. When the maintainer wants every push to one PR reviewed, `/review always` labels it `review-on-push` and every push is reviewed until the label is removed by hand: the loop's escape hatch, not its default. On such a PR the push is itself the ask — post no `/review` after a push there, or the same head is reviewed twice; a reply-only wave on it still gets one.

The review to wait for is the **workflow run** the comment started, never a check on the PR: a comment-triggered run's check attaches to main's head commit, not the PR's, so `gh pr checks` never lists it, and the PR head's own `review` check is the skipped `synchronize` one. On a PR labelled `review-on-push` a *push* wave's run is the head's `pull_request` one, whose `review` check does sit on the head — but a reply-only wave there is asked for with `/review` like anywhere else, and its run is an `issue_comment` one while the head's check is the previous push's, already green. So the run is never read off a check, and never off `gh run list` either, which carries no pull-request filter and would hand a sibling PR's run to a batch or a stacked chain. It is found through the PR itself: the action posts a progress comment (`claude[bot]`, "Claude Code is working…") on the PR within seconds of the ask, and that comment links the run. Take the one posted after the ask, and block on it:

```bash
gh api "repos/{owner}/{repo}/issues/<number>/comments?since=<time of the ask>&per_page=100" \
  --jq '[.[] | select(.user.login == "claude[bot]" and .created_at > "<time of the ask>")] | first | .body // empty | capture("actions/runs/(?<id>[0-9]+)").id'
gh run watch <id>
```

`since` is the endpoint's own window and does the narrowing server-side: the listing is oldest-first, thirty to a page, so without it a pull request past thirty comments — a few rounds in — keeps the current progress comment on a page the call never reads, and the empty result would read as "not admitted" below.

Nothing within a couple of minutes of the ask means the ask was not admitted (the commenter's association, a draft on a `pull_request` event) — read the workflow's `if:` before asking again.

CodeRabbit is the other half of the round, and its finished signal is the commit status it sets on the head — context `CodeRabbit`, `pending` ("Review in progress") while it reads, then `success` with "Review completed", "Review rate limited" or "Review skipped". Its plan allows about one review an hour, so about every other push gets the rate-limit notice instead of a review; for the round's purpose that head is finished the moment the status says so — `@coderabbitai review` once the window reopens is how a final pass is asked for before merge, and never something this loop waits on. Read it off the pull request's head, never the local `HEAD` — this loop may be standing on another branch of the batch:

```bash
gh api "repos/{owner}/{repo}/commits/$(gh pr view <number> --json headRefOid --jq .headRefOid)/status" \
  --jq '.statuses[] | select(.context == "CodeRabbit") | "\(.state) \(.description)"'
```

The round is over when the Claude run has concluded **and** that status is no longer `pending`, with two clocks, both counted from the event that started the round — the push, or for the first round the PR opening or its marking ready, since `/commit` pushes and this command opens the PR afterwards: a head that has no `CodeRabbit` status five minutes after that event is one CodeRabbit is not reviewing, and a status still `pending` thirty minutes after it is read as finished — either is said in the round comment, on a line between its header and the three labelled bullets, which the re-review skips as it skips the header. A wave with no push waits on the Claude run alone, since CodeRabbit reads pushes. The next wave starts once, after that joint signal, and covers every finding gathered by then — never on the first comment from either bot. CI is not part of the signal: it binds the branch (*Checks* above, *Done* below), not the round (#920). This paragraph is the one statement of when a round is asked for and what it waits on; `/commit` § 8, `/pr-changes-amend`, `/pr-comments-reply` and `/review-pr` point here rather than restate it.

**Reviews and comments.** Fetch new review threads as they arrive — `/pr-comments-analyze` collects and classifies them, `/pr-comments-reply` answers them; inside this loop their ask-the-user approval gates are carved out (stated in both files), since an unattended loop cannot wait on them and every reply is anchored to a verified fix or a stated reason. Ground rules, learned the hard way:

- Answer every thread; **do not resolve threads yourself** unless explicitly told to — the commenter resolves. `main` requires conversation resolution, so an ignored thread blocks the merge as surely as a red check. One carve-out: when a bot commenter reports it could not resolve its own thread ("please resolve it manually"), that *is* being told — resolve it yourself and say so in the reply.
- Read a bot reviewer's *verdict*, not just its finding list — and verify each claim against the code (grep for the claim, not the cited line number; lines drift) before agreeing or pushing back.
- When a finding is real, look for its symmetric twin — the same bug in the mirrored code path — and fix both; then expect second-order breakage from the fix and re-run the affected tests.
- A declined finding gets a reply with the concrete reason, never silence.
- A line in the bot's summary comment — Minor, Note, `[pre-existing]` of any severity — opens no thread and blocks nothing: it is information, not an ask. What it and every thread are owed is a **disposition** (#924).

**Dispositions.** Every *verified* finding — one this loop checked against the code, never the reviewer's raw claim — ends in exactly one of three places, and the round comment below records which:

- **Fixed on the branch** — the branch introduced it, or it is pre-existing but the changed path depends on it, so the change is unsafe or incorrect while it stands. The test is two questions: *would this problem exist if this branch were not merged?* and, if it would, *is the changed path correct while it stands?* A no to either makes it the branch's. Folded into the owning commit in this wave; a branch never files a ticket for its own defect.
- **Filed** — a verified pre-existing defect the branch neither introduced nor depends on, worth durable backlog work. Search first (`gh issue list --state open --limit 500 --search "<claim>"` — the limit is an upper bound, so a narrow query costs nothing, while a query with a common word matches more open issues than any small cut shows and a covering issue can rank below it; the same depth the reviewer's own search uses) and link the issue that already covers it; otherwise file it with `/issue-create` — Bug type, area labels, the four fields proposed conservatively — whose § 3 confirmation gate is carved out inside this loop (as `/pr-comments-analyze` § 8 and `/pr-comments-reply` § 5 are), with the test and the search result stated in the round comment so the maintainer sees the number and can close it. Never a blocking thread, never a fix wave on this branch.
- **Dropped** — verification found no defect (a false positive, a defensive wish where a guarantee exists, a style preference), or a real but trivial cleanup or speculative improvement that does not justify backlog work. One line with the reason; a thread is declined with that reason in it.

A reviewer's severity is a triage of urgency; the disposition is ownership, decided by the test. A Critical in a path this branch never touched is urgent follow-up work (Priority Urgent), not this branch's; a small defect the branch introduced is the branch's, whatever the reviewer called it. Security-bot findings are never dropped without the full data-flow read (`/pr-comments-analyze` § 3).

The wave closes with one PR comment — under these three labels and no other, since the re-review parses by them — the `Touched:` line and a clock line sit between the header and the bullets, where the parser skips them as it skips the header — posted after the thread replies and before whatever asks for the round ("The next round" above: `/review`, or the push on a labelled PR), so the re-review can verify it — its summary carries a `Dispositions since <sha>` tally — and the maintainer can see where review scope ended without reading every round:

```
Review round <n> — dispositions
Touched: <app | python | tooling | none of the three> — the classes among every path this wave changed, read in *Checks* before the fold (`/commit` § 8), consumed by *Done*
- Fixed on the branch: <finding> → <commit>
- Filed: <finding> → #<issue> — would exist without this branch; the changed path does not depend on it
- Dropped: <finding> — <reason>
```

**Conflicts and staleness.** If main moves ahead, rebase — the repo is rebase-only, no merge commits:

```bash
git fetch origin main && git rebase origin/main
git push --force-with-lease
```

One rule keeps the bare lease sound: **never refresh `origin/<branch>` inside the loop** — that means no refspec-less `git fetch origin` and no bare `git pull` (it runs exactly that fetch); fetch `main` (or another specific ref) by name. The lease compares against your remote-tracking ref, i.e. the last state of the branch you actually saw; a full fetch would silently mark a reviewer's or the maintainer's fresh push as "seen" and let the next force-push clobber it. With the fetch scoped, a third-party push simply makes the push refuse — fetch the branch, read what arrived, fold it in, push again.

A **stacked chain** (dependents' PR bases are their dependency branches, per `/vibe-history` step 5e) does not use the recipe above branch-by-branch: rebasing a dependent onto `origin/main` would balloon its PR with main's and the root's commits, and hand-running `--onto` needs pre-rebase tips that the root's rebase destroys. Rebase the whole stack in one move from its top instead: `git checkout <top-branch> && git rebase --update-refs origin/main` — `--update-refs` moves every intermediate branch ref with it, no remembered shas — then force-push each branch of the chain (`--force-with-lease`, same scoped-fetch rule). Re-run whatever gates the rebase could have invalidated.

**Done.** The loop ends when the PR reports mergeable and all reviews are addressed — and, before it reports that, it runs the slow tier's second owing (`/commit` § 8): read the `Touched:` line of every `Review round <n> — dispositions` comment on the PR, and when any names `app`, `python` or `tooling`, check the branch out at the merge head — `git rev-parse HEAD` equal to `gh pr view <number> --json headRefOid --jq .headRefOid`, since the loop may be standing on another branch of the batch and these lanes measure the working tree — and run `npm run security:all` and the smoke and perf lanes `npm run gates` lists there. A wave's push is exempt from that tier, so this is the one step that owes it; a red lane here is a wave like any other. Auto-merge is disabled on this repo — the maintainer presses the button; report the final state, with what the `Touched:` lines said and what ran, rather than merging.
