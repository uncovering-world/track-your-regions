---
name: queue
description: "Work Queues: Open, show, resume, check, change, close or list the queues the work is held in (ADR-0114). A queue is one issue labelled `queue`: a goal, a checkable end, ordered items with their reasons, an owner, claims, and a journal in its comments."
---

# Work Queues

A queue is one GitHub issue labelled `queue` (ADR-0114). It holds one goal, a checkable end,
the ordered items that serve the goal, the session that owns it and what that session's work
claims. Every change to it is recorded in a journal, which is the issue's comments. A session
works one queue, and "what is next" is answered from it.

## Arguments

$ARGUMENTS — a subcommand and its operands:

| Subcommand | Operands | Does |
|---|---|---|
| `new` | the goal in words (optional) | opens a queue |
| `show` | queue number | prints it |
| `resume` | queue number | takes it over in this session and says where it stopped |
| `check` | queue number | reports drift between the queue and the repository |
| `change` | queue number, the change, its reason | changes the order, adds, defers, drops, opens or closes a detour, marks an item done |
| `close` | queue number | closes the queue once *Done when* holds |
| `status` | — | lists every open queue with its owner and claims, and the conflicts between them |

Without a subcommand, run `status`.

## The rules (ADR-0114)

- **An item enters only if it serves the queue's goal.** Anything else goes to the backlog or
  to another queue. When an item is turned away, say where it went.
- **A detour is an item with an end condition.** It closes when the condition holds.
- **No new item starts while the current one lacks evidence that it ended.** Evidence is a
  merged PR, a measurement, a closed issue, or an explicit "deferred because…".
- **The maintainer sets the goal and the priorities; the agent decides the slicing.** Ask the
  maintainer before you:
  - set or change a goal or its *Done when*;
  - move an item ahead of another for any reason but a dependency;
  - drop an item.

  Splitting an item into slices, ordering slices by dependency, and adding a detour that
  unblocks the current item are the agent's to do, each recorded in the journal.
- **Only the owner edits the body.** Every other session comments. An issue body has no
  partial edit, so it is read whole, edited and written back whole:

  ```bash
  gh issue view <n> --json body -q .body > <scratch>/queue-<n>.md
  # edit the copy
  gh issue edit <n> --body-file <scratch>/queue-<n>.md
  ```

  Every body edit is followed by its journal comment, in the same step.
- **A session works its queue autonomously** (the maintainer's decision, 2026-10-16, #1596).
  It does all of this without asking:
  - takes the current item;
  - builds it (`/feature` or `/fix`);
  - opens the pull request by every guideline (`/pr-create`);
  - babysits the review and CI;
  - merges the pull request itself once `/pr-create` § 8 *Done* holds. An item whose issue is
    *Human-led* is the exception: the maintainer leads it and tests it by hand, so its PR is
    merged only after the maintainer says the test passed;
  - marks the item done with that merge as its evidence, and starts the next item.

  It asks the maintainer only what is the maintainer's: product questions, and the calls the
  rule above reserves.
- **A session that stops working a queue releases it.** It sets *Owner* to `released` with
  the time, writes an `owner` entry saying where the work stopped, and moves the queue's board
  Status back (`scripts/board.sh status <n> Backlog`). A queue whose owner
  never released it is taken over only as `resume` § 2 allows.

## The body

The headings are fixed, since `status` and `check` read them:

```markdown
## Goal

<One sentence.> Milestone: <title> (#<milestone number> or its URL).

## Done when

- <a checkable condition: a measure with its command, or the issues that must be closed>

Out of scope: <what this queue does not do, and where it goes instead>.

## Items

- [ ] #1162 — <why it is here, what it serves> — **in progress**: PR #1600
- [ ] Re-run the guide test — <why> — **next**
- [ ] detour: #1437 — serves #755 (the syncs time out) — ends when: a run reads OSM from the dump — **waiting**
- [x] #1250 — <why> — **done**: PR #1610 merged
- [ ] #1163 — <why> — **deferred**: <reason>

## Owner

<session name as `ListAgents` prints it> (<agent>, <machine>) since YYYY-MM-DD; last touched YYYY-MM-DD HH:MM UTC

## Claims

- code: <path or area> (<item>)
- migration: <number> (<item>)
- worktree: <path> (<item>)
- dev stack: keeper — pull, migrate, frontend mode, panel runs and builds
```

- **An item is one checkbox line**, in order of work. The first line that is not done and not
  deferred is the **current item**.
- **An item is an issue (`#N`) or a named step** such as a measurement. A step that grows past
  one session becomes an issue first.
- **The state is one of** `next`, `in progress`, `waiting`, `done` or `deferred`:
  - `in progress` names its PR or branch;
  - `waiting` names what it waits on and the event that ends the wait;
  - `done` names its evidence;
  - `deferred` names its reason.
- **The board follows the state.** An issue item's board Status is set in the same step as its
  state, so the board tells started work that moves from started work that stopped:

  | Queue state | Board Status |
  |---|---|
  | `next` | 📋 Backlog |
  | `in progress` | 🏗 In progress, or 👀 In review while its PR is open |
  | `waiting` | ⏳ Waiting |
  | `deferred` | 📋 Backlog |
  | `done` | ✅ Done (a closing merge sets it) |

  ```bash
  scripts/board.sh status <N> Waiting
  ```

  An item that was started and then left, with no branch open, is `deferred`, not `in progress`
  or `waiting`. A blocker of an item that has not started is a blocked-by link on its issue
  (`gh issue edit <N> --add-blocked-by <B>`), and the item stays `next` or `deferred`.
- **A detour line starts with `detour:`.** It names the item it serves and its end condition.
- **A claim names the item it is for.** It is removed when that item is done. The dev stack is
  claimed by one queue only: its keeper's.

## The journal

One comment per change, headed `**Journal · YYYY-MM-DD · <kind>**`, where `<kind>` is one of:

- `opened`, `owner`, `closed`: the queue's life (an `owner` entry takes the queue over or
  releases it);
- `order`, `add`, `defer`, `drop`: the items;
- `state`: an item moving between `next`, `in progress` and `waiting`, in one line;
- `detour`, `done`: an item's start or end;
- `claim`: a claim taken or released;
- `ask`: a question to another queue's owner, and its answer;
- `check`: what a `check` found. It also marks where the next `check` starts reading.

The body of the comment says what changed and why, in one to five lines, with links: a PR, a
measurement, the maintainer's decision, as the maintainer said it and in English. A comment never
holds a session's working notes; those stay in `docs/local/`.

```bash
gh issue comment <n> --body-file <scratch>/journal.md
```

## Instructions

### `new`

1. **Get the goal from the maintainer.** Ask for the goal, its milestone, *Done when*, what is
   out of scope, and the Priority, unless the request already gave them. Propose wording; the
   maintainer decides.
2. **Draft the items.** For each item: the issue, why it serves the goal, and its state. Read
   every issue you list (`gh issue view <N> --json state,title,body,comments`). A closed issue
   is not an item, and an issue blocked by an open issue goes after its blocker.
3. **Draft the claims** the first items will take: code areas, migration numbers (the next
   free one is one past the highest in `db/migrations/` and in every open queue's claims),
   worktrees, and the dev stack only if this queue keeps it.
4. **Show the body to the maintainer, then create the queue:**

   ```bash
   gh label list --search queue --json name -q '.[].name' | grep -qx queue \
     || gh label create queue --color 0E8A16 --description "A work queue: one goal, ordered items, a journal (ADR-0114)"
   gh issue create --title "Queue: <goal in a few words>" --type Task \
     --label queue --label process --body-file <scratch>/queue-new.md
   ```

   Take the number from the URL `gh issue create` prints, then place it:

   ```bash
   scripts/board.sh add <n> <Priority> X-Large "<Theme>" Pair "In progress"
   ```

   The Priority is the maintainer's. The Size is `X-Large` because a queue spans many items.
   The Theme is its goal's. Placement on the board is best-effort, as for any issue.
5. **Write the `opened` journal entry:** the goal, why the queue exists now, and the first
   item.

### `show`

Print the goal, *Done when*, the current item, the next three items, the owner and when it last
touched the queue, the claims, and the last five journal entries.

```bash
gh issue view <n> --json title,body,state,labels,updatedAt
gh api --paginate "repos/uncovering-world/track-your-regions/issues/<n>/comments" \
  --jq '.[] | "\(.created_at) \(.body)"'
```

### `resume`

1. **Read the queue whole:** the body and every journal comment (the commands of `show`).
2. **Check who holds it.** When *Owner* names another session, look it up with `ListAgents`.
   - **Listed:** the session is alive. Ask it through `SendMessage` to release the queue, and
     wait for its `owner` entry.
   - **Not listed:** that proves nothing. `ListAgents` never shows a Codex session, or a
     session on another machine that is not under Remote Control, and the queue then has an
     *unknown* owner. Take it over only when one of these holds:
     - its owner released it (*Owner* says `released`);
     - it was last touched more than seven days ago;
     - the maintainer confirms that the owner has stopped.

     Otherwise ask the maintainer. Two sessions rewriting one body silently drop each
     other's edits.

   The `owner` entry says which of these applied.
3. **Take ownership** before any edit of the body: set *Owner* to this session and the time,
   write the `owner` journal entry, and set its board Status
   (`scripts/board.sh status <n> "In progress"`).
4. **Read what is in flight.** For each item that is `in progress` or `waiting`:

   ```bash
   gh issue view <N> --json state,closedByPullRequestsReferences
   gh pr list --state all --search "<N>" --json number,state,headRefName,mergedAt,title
   git branch -a --list "*<N>*"
   git worktree list
   ```

   An item whose PR has merged or whose issue is closed is done: mark it with its evidence. An
   item whose PR waits on review or CI stays `in progress`, and its PR is babysat (`/pr-create`
   § Babysit the PR until it is mergeable) before a new item starts. Refresh the claims so they
   name what the in-flight items hold. Write the `done` and `claim` entries these edits call
   for.

   Then compare each issue item's board Status with its state (*The board follows the state*
   above), reading Status as `/issues` § 1 does. Name every item where the two disagree, such
   as an item `waiting` on a build that stands in 👀 In review with no pull request open, or a
   `deferred` one in 🏗 In progress. Set the board from the state, and write one `state` entry
   that lists what moved.
5. **Say where the work stopped and what is next:**
   - the current item and its evidence so far;
   - what ends it;
   - the next item after it.

   Then start the current item: `/feature` or `/fix` on its issue, or the named step.

### `check`

Report drift and propose a `change` for each finding, but change nothing in the body. The one
thing `check` writes is its own `check` entry, the list of what it found. That entry is where
the next `check` starts, so an entry of another kind (a `claim` written mid-detour, say) never
hides the merges before it.

- **Merged work that serves no item.** List the PRs merged since the last `check` entry, or
  since the queue was opened when there is none:

  ```bash
  gh pr list --state merged --search "merged:>=YYYY-MM-DD" --limit 200 \
    --json number,title,mergedAt,closingIssuesReferences,headRefName
  ```

  Keep the ones that close or name no item of this queue and no item of another open queue.
  Each such PR was a detour no one recorded. Propose it as a `detour` entry after the fact,
  with what it served, or name the queue it belongs to.
- **An item in progress with nothing behind it:** no open PR, no branch, no worktree.
- **Leftovers of finished items:** an item marked done whose PR is still open, whose branch or
  worktree is still there, or whose claims are still listed.
- **A current item with no evidence of its end** while a later item is in progress. That
  breaks the third rule; name both items.
- **A detour whose end condition holds** but which is still open.
- **An owner that has not touched the queue in seven days.**

### `change`

1. **Name the change and its reason.** Without a reason there is no change. Ask for one if the
   request has none.
2. **Apply the rules.**
   - An addition must serve the goal; otherwise send it to the backlog (`scripts/board.sh
     status <N> Backlog`) or to the queue whose goal it serves, and say so.
   - A reorder that is not a dependency, a drop, and any change to *Goal* or *Done when* are
     the maintainer's: ask first, and record the answer as the maintainer gave it.
   - A detour needs an end condition before it is written.
   - `done` needs its evidence.
   - A change of an item's state sets its issue's board Status in the same step, as *The board
     follows the state* lists.
3. **Edit the body**, owner only. Another session writes an `ask` comment for the owner
   instead, and tells the owner through `SendMessage`.
4. **Write the journal entry** of the matching kind.

### `close`

1. **Check *Done when* against the facts.** Run the measure and read its result, or confirm
   each issue it lists is closed. If it does not hold, say what is missing and stop.
2. **Move the leftovers explicitly.** Every item not done gets a line in the closing entry. The
   line says where it went: to the backlog (`scripts/board.sh status <N> Backlog`), to another
   queue (a `change` there), or dropped. A drop is asked of the maintainer first, as in
   `change`, and the line carries the maintainer's reason.
3. **Release the claims**, and tell the sessions that were waiting on them.
4. **Write the `closed` entry**, with the evidence that *Done when* holds, then close the issue:

   ```bash
   gh issue close <n> --reason completed
   ```

### `status`

1. **List the open queues and read each body:**

   ```bash
   gh issue list --label queue --state open --json number,title,updatedAt,body
   ```

2. **Match each owner to a session** with `ListAgents`. An owner is one of three things:
   - **live**: listed;
   - **released**: *Owner* says so;
   - **unknown**: not listed. `ListAgents` never shows a Codex session, or one on another
     machine outside Remote Control, so "not listed" never reads as "gone".
3. **Print one row per queue:** its number, goal, owner and which of the three it is, last
   touched, current item, and claims.
4. **List the conflicts:**
   - one code area claimed by two queues (a path that is a prefix of another counts);
   - one migration number claimed twice, or claimed while a file with that number already
     exists in `db/migrations/` on `origin/main`;
   - a dev-stack action (a pull, a migration, a frontend mode switch, a panel run or build)
     claimed by a queue that is not the dev stack's keeper.
5. **Say how each conflict is settled:** the session that would touch another queue's claim
   asks that queue's owner through `SendMessage` (another agent asks the maintainer), and both
   queues record the outcome as an `ask` entry.
