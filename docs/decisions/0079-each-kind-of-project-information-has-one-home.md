# ADR-0079: Each kind of project information has one home, and drafts stay local

**Date:** 2026-10-01
**Status:** Accepted

---

## Context

What the project intends, what exists and what is still being worked out had spread over
places that disagreed. Counted on 2026-10-01:

- **Plans committed against the rule.** Twelve plans were tracked under
  `docs/tech/planning/`, which is gitignored and whose rule is "plans are never committed".
  `docs/README.md` indexed them as if they were current (#514). One of them described a CI
  that no longer exists (#431).
- **Local plans that outlived their work.**
  - 127 local files sat under `docs/tech/planning/`.
  - 36 were plans for issues already closed.
  - About 86 carried no issue number: roadmaps, strategy reviews, research with PDF renders,
    session plans and a "next session" prompt.
  - No roadmap had been updated since August, while the work had moved to milestones.
- **No line between a draft and a published document.** Research was drafted locally,
  sometimes in Russian, and a finished report that a decision rests on had no published home.
  The repository is public.
- **The rule was stated in three places,** with drift between them: `CLAUDE.md` §
  Documentation, `docs/README.md` § Conventions and the development guide.
- **The agents' memory held project status.** About sixty "status of slice #N" notes repeated
  what git, pull requests and issues already record, and they went stale the way the plans did.

## Decision

1. **Intent lives in GitHub issues.** What to do, why, its priority and its order are issues.
   The roadmap is the open milestones, each with an exit criterion in its description. A theme
   is an Epic, and a far-off idea is a Low Epic with no milestone. No document keeps a roadmap,
   a strategy or a "next session" list beside them.
2. **What is published is English and final, and lives under `docs/`:**
   - what exists: `docs/tech`, `docs/vision`, `docs/security`, `docs/sources`;
   - decisions: `docs/decisions` (an ADR may be a Draft inside its pull request, as before);
   - **`docs/research/`**, new: a dated, immutable report that an issue or an ADR cites, named
     `YYYY-MM-DD-slug.md`. Like an audit report, it is a point-in-time record.
3. **Everything unpublished lives under one gitignored `docs/local/`,** in any language:
   - `plans/<N>-slug.md`: the working plan of issue `N`. A plan without an issue number does
     not exist; file the issue first. When the pull request merges, what was not built is filed
     as issues, and the plan is deleted or moved to `archive/`.
   - `research/<topic>/`: drafts of research. A draft becomes a report by being finished,
     written in English, and published to `docs/research/` in a pull request, only when an
     issue or ADR needs to cite it.
   - `sessions/YYYY-MM-DD.md`: one working session's state, worth nothing after it.
   - `inbox/`: unsorted notes, emptied into issues or documents (`/issue-upload`).
   - `archive/`: finished or stale local files kept until a sweep deletes them.
4. **The rule is stated once,** in `docs/README.md` § Where things live. `CLAUDE.md`, the
   development guide and the commands point to it. `/docs-sweep` lists what has drifted:
   - a local plan whose issue is closed;
   - a local file with no issue number;
   - a stale draft or session file;
   - agent memory that holds project status.
5. **Agent memory holds how to work, never project status.** It keeps feedback, gotchas and
   references. What was built is in git and the pull requests; what is next is in issues.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep roadmaps as local documents beside the issues | Two sources of intent drift: the August roadmaps were overtaken by milestones within weeks, and nothing said which one was current |
| Commit plans as well (`docs/tech/planning/` tracked) | A committed plan drifts from the code and reads as a description of what exists, which is why the rule forbade it |
| Publish research as it is drafted | The repository is public; drafts carry working notes and mixed languages, and a decision should cite a finished report, not a moving draft |
| Keep `docs/tech/planning/` and `docs/inbox/` as the local homes | Unpublished work would sit in three trees (`tech/planning`, `inbox`, ad-hoc files), with no place for research drafts or session state; one `docs/local/` root makes "published or not" a matter of path |
| Move research into issue comments only | A multi-section report with tables reads badly in a comment, and an ADR should be able to cite a stable file |

## Consequences

**Positive:**
- **One answer per question.** What is planned: the issue. What exists: `docs/`. Why: the ADR,
  with the report it cites.
- **Published means one thing.** Anything under `docs/` outside `docs/local/` is English and
  final. Anything under `docs/local/` is a draft, and no reader mistakes it for a description.
- **A plan is found from its issue by number,** and it ends when the work ends.

**Negative / Trade-offs:**
- **A plan is visible only on the machine it was written on.** Another machine or agent sees
  the issue, so a plan's decisions belong in the issue or the pull request before they matter
  to anyone else.
- **Publishing a report is work:** finishing it and writing it in English. That is the point,
  but it means fewer reports are published than are drafted.
- **Old paths survive as links for a while.** `docs/tech/planning` and `docs/inbox` are
  symlinks into `docs/local/` for the sessions that still use them; `/docs-sweep` removes them.

## References

- Related ADRs: ADR-0062 (gates by inputs; `docs/research/` is a record for the line-pointer
  pass, like an audit report)
- Related docs: `docs/README.md` § Where things live, `docs/research/README.md`
- Issues: #1180 (this decision), #514, #431, #1181 (the commands become skills both agents read)
