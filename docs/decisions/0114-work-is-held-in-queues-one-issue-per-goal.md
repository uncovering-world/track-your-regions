# ADR-0114: Work is held in queues, one issue per goal, with a checkable end and a journal

**Date:** 2026-10-16
**Status:** Accepted

---

## Context

ADR-0079 put intent in GitHub issues, but the **order** of the work was still held elsewhere.
On 2026-10-16 it lived in three places, and none of them held all of it:

- **The milestone** holds the goal and its exit criterion, but no order.
- **The board** holds priorities, but no reasons and no order within a priority.
- **A local session file** (`docs/local/sessions/YYYY-MM-DD.md`, its "NEXT SESSION STARTS HERE"
  block) holds the order, but:
  - only the agent on that machine sees it;
  - it is lost between sessions and between machines;
  - it is tied to no goal.

Nothing recorded **how the order changes**, so a detour stopped being a detour without anyone
deciding it.

Here is the case. The milestone *A catalogue worth travelling for* has an exit criterion, the
traveller's guide test, which stood at 123 of 173 musts on 2026-09-30.

1. Work on #755 was paused when the syncs failed on the query service's 504s.
2. The public-dump pipeline (#1312, #1434) was built to unblock it.
3. That pipeline then grew on its own for days: sample builds, step progress, the admin page.
4. The guide test was not re-run once in that time. The maintainer noticed on 2026-10-16.

A second agent session was also working on the repository. It shared the dev stack and the
migration numbers, and its agreements lived in messages and in its own local notes.

## Decision

1. **A queue is one GitHub issue labelled `queue`.** Its body holds five sections:
   - **Goal:** one sentence, and the milestone it serves.
   - **Done when:** a checkable condition (a measure, or a list of issues that are closed),
     and what is out of scope.
   - **Items:** in order. Each item says why it is there and what state it is in. There is no
     cap on the number of items: everything is written down, so a long queue loses nothing. A
     queue that keeps growing without end is dealt with when that happens.
   - **Owner:** the session that holds the queue, and when it last touched it.
   - **Claims:** what the queue's work takes:
     - code areas;
     - migration numbers;
     - dev-stack actions: pull, migrate, frontend mode, panel runs and builds.

   The **journal** is the issue's comments. It records:
   - every change of order;
   - every addition and every deferral, each with its reason;
   - every detour, with what it serves and what ends it.

   Only the owner edits the body. Anyone else comments.
2. **Four rules govern a queue:**
   - **An item enters only if it serves the queue's goal.** Anything else goes to the backlog
     or to another queue.
   - **A detour is an item with an end condition.** It closes when that condition holds.
   - **No new item starts while the current one lacks evidence that it ended.** Evidence is a
     merged PR, a measurement, a closed issue, or an explicit "deferred because…".
   - **The maintainer sets the goal and the priorities; the agent decides the slicing.**
3. **A session works one queue.** In a new session, `/queue resume <n>` does four things:
   - reads the queue and its journal;
   - reads the items in progress, with their open PRs, branches and worktrees;
   - takes ownership;
   - says where the work stopped and what is next.

   A session that stops working a queue releases it. Another session takes over a queue whose
   owner did not release it only after seven days without a touch, or when the maintainer
   confirms that the owner has stopped. Not seeing the owner proves nothing: a Codex session,
   or a session on another machine, is invisible to the session that looks.
4. **Sessions see each other's claims.** `/queue status` lists every open queue with its owner
   and claims, and flags conflicts:
   - two queues on one code area;
   - one migration number in two queues;
   - a panel run during another queue's build.

   The shared dev stack is one queue's claim: its keeper's. A session that would touch another
   queue's claim asks that queue's owner through cross-session messages, and records the
   outcome in both journals.
5. **The workflow is the `/queue` skill** (ADR-0080): `new`, `show`, `resume`, `check`,
   `change`, `close`, `status`.
   - `change` takes a reason.
   - `close` works only when *Done when* holds, and moves the leftovers to the backlog
     explicitly.
   - `check` reports drift:
     - merged work since the last `check` that serves no item;
     - items in progress with nothing open behind them;
     - PRs and worktrees left over from items that are done.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The order in the milestone's description | A milestone has no comments, so changes have no journal, and one milestone can hold work for two sessions with no owner or claims; its description stays the exit criterion |
| A board view sorted by a custom "order" field | The board shows the order without the reasons and has no journal; a field per queue does not scale to several queues at once |
| Keep the local session file as the order | It is the failure this ADR answers: one machine, one agent, no goal, no record of change |
| A committed file in the repository (`docs/queue.md`) | Every change of order would be a commit and a review round; two sessions would conflict on one file; ADR-0079 keeps intent in issues |
| An Epic per goal, with the order as its slice list | An Epic is a decomposition of one piece of work and its ledger marks slices, not order; a queue also holds detours, measurements and items from several Epics |

## Consequences

**Positive:**
- **"What is next" has one answer, readable from any machine or agent:** the current item of
  the queue the session holds, with the reason it is next.
- **A detour is visible as a detour.** It has an item, a reason and an end condition, and
  `/queue check` lists merged work that served no item.
- **Two sessions can share the repository without talking past each other.** Claims are written
  down, conflicts are listed, and agreements land in both journals.

**Negative / Trade-offs:**
- **Bookkeeping costs time.** Each change of order costs an edit of the body and a journal
  comment. This is deliberate: an unrecorded change is what let the detour run.
- **A queue issue is an issue but not a piece of work.** `/issues` never offers it as a pick,
  and its board Status only shows whether it is being worked.
- **The body is read and written whole.** An issue body has no partial edit, so the owner
  rewrites it, and only the owner may, which is why no one else edits it.

## References

- Related ADRs: ADR-0079 (intent is an issue), ADR-0080 (workflows are skills)
- Related docs: `docs/README.md` § Where things live, `.claude/skills/queue/SKILL.md`
- Issue: #1591
