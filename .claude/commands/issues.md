# Browse GitHub Issues

List open issues from the org task board, with their board fields, to help pick what to work on next.

## Arguments

$ARGUMENTS — optional filters, combinable: a label (`bug`, `enhancement`, `roadmap`, …), a Theme (`Curation`, `Map & Geo`, …), an AI-fit shorthand (`agent`, `pair`, `human`), a Priority (`Urgent`, `High`, `Medium`, `Low`), or a Status (`New`, `In progress`, `In review`, `Done` — naming a Status lifts the open-only rule below, so `Done` shows the closed issues it implies). If not provided, show the whole Backlog plus any untriaged 🆕 New items.

## Instructions

### 1. Fetch board items

All open issues live on the org project board (`uncovering-world/projects/2`) with five single-select fields: Status, Priority, Size, Theme, AI fit. Fetch items with fields via GraphQL (requires the `project` scope — `gh auth refresh -s project` if missing):

```bash
gh api graphql --paginate -f query='
query($endCursor: String) {
  organization(login: "uncovering-world") {
    projectV2(number: 2) {
      items(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content { ... on Issue { number title state labels(first: 10) { nodes { name } } } }
          fieldValues(first: 20) { nodes { ... on ProjectV2ItemFieldSingleSelectValue {
            name field { ... on ProjectV2SingleSelectField { name } } } } }
        }
      }
    }
  }
}'
```

`--paginate` follows `pageInfo` automatically (gh requires the variable to be named exactly `$endCursor` for that), so the command returns every page. Keep only open issues — unless $ARGUMENTS names a Status, which lifts this rule (✅ Done items are closed issues by definition). Reconcile once per run — only when the board fetch above actually succeeded (an empty board set in degraded mode means unreadable, not empty): diff the board's issue numbers against `gh issue list --state open --limit 500 --json number` (the default `--limit` is 30 — far below this repo's open count) and render any open issue missing from the board in an "Off-board" line — a failed best-effort placement must surface here, not vanish. If the token lacks the `project` scope, fall back to `gh issue list --state open --limit 200 --json number,title,labels` and say the board fields are unavailable. In that degraded mode only label filters can be honored — if $ARGUMENTS asks for a Theme, AI fit, Priority, or Status, say so and suggest refreshing the scope instead of presenting unfiltered results as filtered. Render degraded output as a single table (# / Title / Labels): with no board fields there are no priority groups, and emitting nothing would look like a complete empty answer.

### 2. Filter and group

Apply $ARGUMENTS filters (label / Theme / AI fit / Priority / Status). Then group by **Priority** (Urgent → High → Medium → Low), and within a group sort by Size ascending — quick wins first.

### 3. Display

One table per non-empty priority group:

```text
## 🏔 High
| #   | Title                        | Size      | Theme      | AI fit | Labels     |
|-----|------------------------------|-----------|------------|--------|------------|
| 583 | Location correction screen   | 🐂 Medium | Curation   | 🤝 Pair | front      |
```

Skip issues whose Status is In progress / In review / Done unless $ARGUMENTS names that Status; note their count in one line. The no-Priority rule below takes precedence: the Status skip applies only to items that have a Priority, so an item auto-added to the board mid-work (Status set, fields empty) still surfaces as untriaged. Render every board-field column as the full option name (`🐂 Medium`, never `M`; `🤝 Pair`, never a bare `🤝`) — what this table prints must be a value `scripts/board.sh set` accepts. Items with **no Priority set** (untriaged — 🆕 New items, but also anything added to the board without fields) get their own "🆕 Untriaged" table after the priority groups — they need attention, not invisibility.

### 4. Suggest next steps

After the tables, suggest:

- **To fix a bug**: run `/fix <number>`
- **To work on a feature**: run `/feature <number>`
- **To see issue details**: run `gh issue view <number>`
- Picking rule (also in the board README): match Size to the session's capacity and AI fit to its mode (autonomous → 🤖 Agent-ready), then take the highest Priority that fits.
