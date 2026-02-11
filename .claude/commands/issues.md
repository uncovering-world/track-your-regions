# Browse GitHub Issues

List open GitHub issues, categorized by type, to help pick what to work on next.

## Arguments

$ARGUMENTS — optional: filter options. Examples: `bug`, `enhancement`, `refactoring`, or a label name. If not provided, show all open issues.

## Instructions

### 1. Fetch issues

```bash
# If $ARGUMENTS contains a label, filter by it:
gh issue list --state open --label "$ARGUMENTS" --limit 30 --json number,title,labels,assignees,createdAt,updatedAt

# If no arguments, fetch all open issues:
gh issue list --state open --limit 30 --json number,title,labels,assignees,createdAt,updatedAt
```

### 2. Categorize

Group the issues into these categories based on their labels:

- **Bugs** — issues with the `bug` label
- **Features** — issues with the `enhancement` label
- **Refactoring** — issues with the `refactoring` label
- **Other** — everything else

Within each category, sort by issue number (newest first).

### 3. Display

Output a clean summary table for each non-empty category:

```
## Bugs
| #   | Title                          | Labels          | Age     |
|-----|--------------------------------|-----------------|---------|
| 123 | Login fails on mobile          | bug, front      | 3 days  |

## Features
| #   | Title                          | Labels          | Age     |
|-----|--------------------------------|-----------------|---------|
| 200 | Add dark mode                  | enhancement     | 2 weeks |

## Refactoring
...
```

### 4. Suggest next steps

After the table, suggest:

- **To fix a bug**: run `/fix <number>`
- **To work on a feature**: run `/feature <number>`
- **To see issue details**: run `gh issue view <number>`
