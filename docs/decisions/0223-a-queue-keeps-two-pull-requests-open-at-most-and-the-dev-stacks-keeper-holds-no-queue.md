# ADR-0223: A queue keeps two pull requests open at most, and the dev stack's keeper holds no queue

**Date:** 2026-11-17
**Status:** Accepted
**Built by:** #2619, #2458
**Narrows:** [ADR-0114](0114-work-is-held-in-queues-one-issue-per-goal.md)
decision 1 (a queue has a checkable end: a standing queue waits at it; dev-stack actions are no
queue's claim), decision 2 (the third rule: under the cap, an open pull request with green gates
is enough for the next item to start), decision 4 (the shared dev stack is no queue's claim, and a panel run during another
queue's build is the keeper's to order, not a conflict between queues) and decision 5 (`close` of a standing queue, and `status`'s dev-stack conflict).

---

## Context

ADR-0114 (2026-10-16) put the order of the work in queues: one issue per goal, a checkable
*Done when*, an owner session, its claims and a journal. It made the shared dev stack "one
queue's claim: its keeper's" (decision 4) and gave the goal and the priorities to the
maintainer (decision 2). The `/queue` skill and `CLAUDE.md` § Task Board & Issues follow it.

The practice moved on in four places, each recorded in a queue's journal and in no ADR:

- **Two open pull requests.** The journal of queue #1595, comment of 2026-10-25 00:56Z: "At the
  maintainer's word, this queue keeps at most two of its PRs open at a time." The queue has kept
  to it since: a finished item's branch is pushed and its pull request waits until one of the two
  merges (journal of 2026-11-02 10:11Z, #2236; of 2026-11-03 17:58Z, #2321; of 2026-11-11 06:37Z,
  #2433).
- **The keeper holds no queue.** The journal of queue #1594, comment of 2026-11-01 16:35Z:
  "Released the dev-stack keeper claim. By the maintainer's decision of 2026-11-01, the sync
  session […] keeps the dev stack and the merge order between sessions, and this queue asks it for
  a pull, a migration, a panel run or a perf lane." The journal of #1595 records the same move in
  its comment of the same minute: pulls, migrations, panel runs, dump builds and the worker,
  restarts, the frontend mode, `perf:local` and `perf:api`, heavy runs and the order of merges
  between sessions "are asked of the sync session […], no longer of #1594's owner", with the
  protocol "merge #N?" before a merge and "merged #N, sha" after. The sync session is a session of
  its own; #1594, the queue whose owner had kept the stack, closed on 2026-11-11.
- **A standing queue.** The journal of #1595, comment of 2026-11-01 09:31Z: "The maintainer
  decided the queue stays open as the standing Agent-ready role rather than closing while *Done
  when* holds. The queue **waits** on a new Agent-ready issue". ADR-0114 decision 5 lets `close`
  run once *Done when* holds and says nothing of a queue that should not close then.
- **The keeper's triage.** The sync session triages the backlog and moves issues to Agent-ready,
  among them by answering a question the issue left open (journal of #1595, 2026-11-04 12:55Z:
  "The sync session's Pair triage set them to Agent-ready after checking each premise on main
  […]; its reasoning is on each ticket"; 2026-11-13 05:04Z, "the keeper's backlog triage"). A
  question answered that way is a decision no one but the triaging session has read, and nothing
  on the issue tells it from the maintainer's.

On 2026-11-17 the audit of ADRs against issues asked the maintainer about the last point
(journal of queue #2458, comment of 2026-11-17 12:02Z): ADR-0114 gives the priorities to the
maintainer, while the keeper sets the merge order and a new issue's first Priority and AI fit.
The answer, recorded there: "as a plan for later, the keeper sets the merge order and the first
Priority, and the maintainer may change any." The same entry notes that the narrowing of ADR-0114
is not built in that queue; it is #2619's line 4.7.

## Decision

1. **A queue keeps at most two of its pull requests open at a time.** While two are open, its
   session answers their reviews, babysits their CI and builds the next item up to its pull
   request (branch pushed, gates green), and opens that pull request once one of the two merges.
   A queue's detour is one of its pull requests. The cap is per queue, and a session works one
   queue (ADR-0114 decision 3). Under the cap, an item whose pull request is open with its gates
   green is enough for the next item to start; its end is still the merge, and the item is not
   marked done before it.
2. **The dev stack's keeper is a session of its own and holds no queue.** ADR-0114 decision 4's
   "the shared dev stack is one queue's claim: its keeper's" no longer holds: no queue claims a
   dev-stack action. A session asks the keeper for a pull, a migration, a panel run, a dump build
   or the worker, a restart, the frontend mode, `perf:local` or `perf:api`, a heavy run, and the
   order of merges between sessions ("merge #N?" before a merge, "merged #N, sha" after), and its
   journal records the answer. Read-only probes and a branch's own frontend stay the session's.
   `/queue status` names any queue that claims a dev-stack action as a conflict.
3. **A queue may be standing.** The maintainer may keep a queue open as a standing role, as
   #1595 is for the Agent-ready backlog. When its *Done when* holds it is not closed: it **waits**
   (⏳ Waiting) on the event that brings its next item, which its *Done when* or *Owner* names,
   and `close` on it is the maintainer's call.

**Proposed, not decided here.** The audit (#2619 line 4.7) proposed that a triage which makes an
issue Agent-ready by answering a question the issue left open says so in a comment, "decided in
triage, open to veto", and that such an answer is never cited as the maintainer's. It is the
maintainer's to rule on, and no guideline states it until then.

**Recorded as a plan for later, not decided here.** The answer of 2026-11-17 on #2458 (12:02Z):
the keeper sets the merge order and a new issue's first Priority, and the maintainer may change
any. The merge order between sessions is the keeper's already (decision 2, since 2026-11-01). A
new issue's first Priority stays the maintainer's under ADR-0114 decision 2 until an ADR puts the
plan in force.

**Accepted on 2026-11-17** (#2619 line 4.7): decisions 1 to 3 record what the maintainer decided
in the journals of #1594 and #1595, and the guidelines already follow them; the triage proposal
was taken out of the decisions before acceptance, since no one has ruled on it.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Leave ADR-0114 as it stands and keep the practice in the journals | A new session reads the `/queue` skill and `CLAUDE.md`, not the journals of other queues; the skill still told it that a queue holds the dev stack, which no queue has since 2026-11-01 |
| Supersede ADR-0114 | Its five decisions stand but for the sentences named above; superseding it would retire the rules a queue still runs by |
| One open pull request per queue | A pull request waits hours on review and CI; with one, the session idles or builds ahead with nothing to show for it |
| A cap per session rather than per queue | A session works one queue (ADR-0114 decision 3), so the two are the same; the cap is written where the queue's state is read |
| Put the plan of 2026-11-17 in force now | The maintainer gave it as a plan for later |

## Consequences

**Positive:**
- The skill and `CLAUDE.md` say what the sessions do: two pull requests a queue, the dev stack
  asked of its keeper, a standing queue that waits.

**Negative / Trade-offs:**
- A third finished item waits with its branch pushed and no pull request, so it is reviewed
  later than it could be.
- Everything on the dev stack goes through one session; when it is gone, the queues wait until
  the maintainer names its successor.
- A standing queue has no end, so ADR-0114's "a queue that keeps growing without end is dealt
  with when that happens" is the maintainer's to apply.

## References

- Related ADRs: ADR-0114 (narrowed here), ADR-0079 (intent is an issue), ADR-0080 (workflows are
  skills)
- Related docs: `.claude/skills/queue/SKILL.md`, `CLAUDE.md` § Task Board & Issues
- Issues: #2619 (line 4.7), #2458, #1595, #1594, #1591
