# Browse GitHub Issues

List open issues with their type, fields, hierarchy and board Status, to help pick what to work on next.

## Arguments

$ARGUMENTS — optional filters, combinable: a type (`bug`, `feature`, `task`, `epic`), an area label (`front`, `back`, `security`, `process`, …), a Theme (`Curation`, `Map & Geo`, …), an AI-fit shorthand (`agent`, `pair`, `human`), a Priority (`Urgent`, `High`, `Medium`, `Low`), a milestone (`milestone` alone shows the open milestone's issues; a title fragment picks one), or a Status (`New`, `Backlog`, `In progress`, `In review`, `Done` — naming a Status lifts the open-only rule below, so `Done` shows the closed issues it implies). If not provided, show the whole Backlog plus any untriaged items (no Priority set) — which is not the same as `/issues Backlog`: the 🆕 Untriaged table of § 3 is built from the **open** items with no Priority *before* any Status filter is applied — open whatever `states:` the fetch used, since a closed issue needs no triage and the 226 closed ones carry no fields — so it appears on the default run and on any filtered run alike, while `/issues Backlog` narrows the priority groups to items whose Status is 📋 Backlog.

## Instructions

### 1. Fetch the issues, then the board's Status

Everything but Status lives on the issue itself — the type, the org issue fields Priority / Size / Theme / AI fit, the parent, the sub-issue progress, the blockers and the milestone — and is read from the repository with the `repo` scope:

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "uncovering-world", name: "track-your-regions") {
    issues(first: 100, after: $endCursor, states: OPEN) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state
        issueType { name }
        labels(first: 20) { nodes { name } }
        milestone { title state }
        parent { number }
        subIssuesSummary { total completed }
        issueDependenciesSummary { blockedBy }
        blockedBy(first: 10) { nodes { number state } }
        issueFieldValues(first: 10) { nodes { ... on IssueFieldSingleSelectValue {
          name field { ... on IssueFieldCommon { name } } } } }
      }
    }
  }
}'
```

`--paginate` follows only the top-level `issues` connection; the nested ones are bounded, not paginated — the org holds seven issue fields (four in use), so `issueFieldValues(first: 10)` is the whole set, and no issue carries anything near twenty labels — so raise those bounds before adding fields or labels past them.

The milestone filter (`milestone` alone = the *open* milestone's issues) reads `milestone.state`, and the open / closed counts § 3 prints come from the milestone itself, which a `states: OPEN` fetch cannot hold:

```bash
gh api --paginate "repos/uncovering-world/track-your-regions/milestones?state=open" \
  --jq '.[] | "\(.title): \(.open_issues) open, \(.closed_issues) closed, due \(.due_on[:10])"'
```

Status is the board's one field of its own and comes from the org project (`uncovering-world/projects/2`, `project` scope — `gh auth refresh -s project` if missing):

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  organization(login: "uncovering-world") {
    projectV2(number: 2) {
      items(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content { ... on Issue { number state } }
          fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue {
            name field { ... on ProjectV2SingleSelectField { name } } } } }
        }
      }
    }
  }
}'
```

`--paginate` follows `pageInfo` automatically (gh requires the variable to be named exactly `$endCursor` for that), so each command returns every page. Keep only open issues — unless $ARGUMENTS names a Status, which lifts this rule: fetch with `states: [OPEN, CLOSED]` then, in the one query, so that ✅ Done (closed issues by definition) can be shown while the open set still feeds the reconciliation and the Untriaged table below; the four other Statuses are open issues and need nothing beyond the default `states: OPEN`. Reconcile once per run — only when the project fetch actually succeeded (an empty project set in degraded mode means unreadable, not empty): any open issue missing from the project is rendered in an "Off-board" line — a failed best-effort placement must surface here, not vanish. If the token lacks the `project` scope, say Status is unavailable and render everything else. That degraded mode loses more than a column: the default run is "the whole Backlog" and § 3 skips In progress / In review / Done, and neither rule can be applied without Status — so a bare `/issues` then lists every open issue, work in progress included, and must say so in its first line rather than present the list as pickable Backlog; a Status filter in $ARGUMENTS cannot be honored and says so instead of answering unfiltered. The fields, the type, the hierarchy and the milestone are unaffected.

### 2. Filter and group

Apply $ARGUMENTS filters (type / label / Theme / AI fit / Priority / milestone / Status). Then group by **Priority** (Urgent → High → Medium → Low), and within a group sort by Size ascending — quick wins first.

An **Epic** is an umbrella: it is listed with its sub-issue progress (`Epic 2/5`) and is never the thing to pick — one of its open sub-issues is. An Epic with no sub-issues yet is not a dead end but a decompose-first item: render it as `Epic 0/0 · decompose`, and say in the suggestions that `/feature <number>` on it produces the sub-issues rather than code (and resumes a decomposition that stopped short of the Epic's slice list) (on 2026-09-02 that was 23 of the 31 open Epics — #628, #631, #714 among them). A sub-issue shows its parent (`↳ #237`). A blocked issue is gated on the count: `issueDependenciesSummary.blockedBy > 0` (open blockers only — unlike `totalBlockedBy`) excludes it from the picks whatever the nodes say. The nodes are for rendering: `⛔ blocked by #N` for each entry with `state == OPEN`, and `blockedBy(first: 10)` is one page, so when the count exceeds the open entries listed, add "and N more". An Epic can be both (#628 on 2026-09-02: `Epic 0/0 · decompose`, blocked by open #758); the two markers are shown together, and the disposition is decided in `/feature` § 1 — decomposition is allowed, and every slice is created `--blocked-by` the Epic's open blockers, so the blocker gate holds on the slices and nothing unblocked is minted while the blocker is open.

### 3. Display

One table per non-empty priority group:

```text
## 🏔 High
| #   | Title                        | Type      | Size   | Theme    | AI fit      | Parent / blockers | Labels |
|-----|------------------------------|-----------|--------|----------|-------------|-------------------|--------|
| 583 | Location correction screen   | Feature   | Medium | Curation | Pair        | ↳ #237            | front  |
| 237 | Full content curation …      | Epic 0/3  | X-Large| Curation | Pair        |                   | front  |
```

Skip issues whose Status is In progress / In review / Done unless $ARGUMENTS names that Status; note their count in one line. When $ARGUMENTS names a Status, the matching items that carry a Priority stay in their priority groups (`/issues Backlog` is the 172 Backlog items grouped by Priority, as the line-7 rule says), and the matching items that carry **none** and are closed get one flat table of their own in the same columns — a ✅ Done item is a closed issue with no fields (none of the 226 closed ones carries a Priority), so without that table the `states: [OPEN, CLOSED]` fetch of § 1 would have no consumer and `/issues Done` would answer empty. An open item with no Priority is already in the Untriaged table and is not listed twice. The no-Priority rule below takes precedence: the Status skip applies only to items that have a Priority, so an item that landed mid-work (Status set, fields empty) still surfaces as untriaged. Render every field column as the full option name (`Medium`, never `M`; `Agent-ready`, never a bare emoji) — what this table prints must be a value `scripts/board.sh set` accepts. **Open** items with **no Priority set** (untriaged — 🆕 New items, but also anything created without fields; never a closed issue, whatever `states:` the fetch used) get their own "🆕 Untriaged" table after the priority groups — they need attention, not invisibility. When a milestone is open, say in one line how many of its issues are open and closed — from the milestones read in § 1, not from the issue list.

### 4. Suggest next steps

After the tables, suggest:

- **To fix a bug**: run `/fix <number>`
- **To work on a feature or task**: run `/feature <number>`
- **To see issue details**: run `gh issue view <number> --json body,comments,parent,subIssues,blockedBy` — the body *and* the thread. A table row carries a title and a handful of fields, and none of them survives contact with a comment that retriaged the work, narrowed it, or recorded that the premise changed. Reading only the body is how a session starts on the wrong half of an issue
- Picking rule (also in the board README): match Size to the session's capacity and AI fit to its mode (autonomous → Agent-ready), prefer the open milestone, then take the highest Priority that fits — never an Epic, never a blocked issue. An Epic is the exception in one direction only: `/feature <number>` on it slices it into sub-issues, or completes a decomposition that stopped short — this list cannot tell a short set from a complete one, since it does not read bodies (#497 shows `Epic 0/1` over eight listed slices, none of them marked yet — the ledger arrived after the sub-issues did, and `/feature` reconciles first), so the marker is only a hint and `/feature` reads the ledger on the Epic's body — and the slices are what gets picked; when the Epic is also blocked, the slices carry its blockers and wait with it.
