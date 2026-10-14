# ADR-0106: Public dump builds run in a worker process, queued through the ledger

**Date:** 2026-10-14
**Status:** Accepted

---

## Context

A public dump build (ADR-0101 decision 4) ran inside the backend's own process. `startBuild` started it in the background of the request that asked for it, and it lived in that process's memory.

On the development stack the backend is `tsx watch`, so the process restarts on any edit under `backend/`, a `git pull` or a branch switch in the main checkout. A restart ends every build. The first build of the local Wikidata subset (#1434) was started from the admin panel on 2026-10-14. It reads the 156.4 GB entities dump twice at about 10 MB/s of compressed input, roughly four hours a pass. For the whole of that time no one could change the backend in the main checkout, from this session or any other on the machine.

Production has no watcher, but a deploy restarts the backend the same way.

#1463 already gave every build a ledger row with a heartbeat and a runner, and a unique index admitting one running build per dump. The panel could follow a build another process runs, but nothing ran builds outside the backend.

## Decision

1. **A build runs in a dump worker, a process of its own.**
   - It is a `dump-worker` compose service: the backend's image, environment and mounts, started with `npm run worker` (`backend/src/worker.ts`) and no file watcher.
   - It takes queued builds one at a time and runs them with the existing pipeline.
   - Its code changes when it is restarted, and a restart stops the build it runs. The build's row then says to start it again.
2. **The panel queues a build in the ledger, and the ledger is the only channel between the two processes.**
   - *Verify newest*, *Build newest* and *Build \<date\> copy* insert a `queued` row with what was asked for (`request`: the kind and, for a local copy, its file), after the backend's own checks.
   - The worker takes the oldest queued row with `FOR UPDATE SKIP LOCKED`, so two workers never take one build.
   - It writes the file it resolved, and every five seconds its progress and heartbeat (`progress`, `heartbeat_at`).
   - *Cancel* closes a queued row at once and marks a running one (`cancel_requested_at`); the worker reads the mark with its next heartbeat and stops.
   - The unique index admits one queued or running build per dump.
3. **What the panel shows of a build is read from its row,** whatever process runs it. The in-memory progress and the separate view of a build "in another process" (#1463) are gone.
4. **Startup closes the builds that cannot be running.** The worker closes the running rows of its own runner (`worker:<hostname>`, the host name compose fixes). The backend, and the panel's list, close those that stopped beating. A queued row waits for a worker.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep builds in the backend and stop watching in development | A deploy still restarts the backend. Development without a watcher costs every other edit a manual restart. |
| A child process the backend spawns | `tsx watch` restarts the process group, and production restarts would still take it down. It also needs a channel between the two that the ledger already is. |
| A job queue library (BullMQ, pg-boss) | A new dependency, and a Redis for BullMQ, for one kind of job a day at most. The ledger already holds the rows, the heartbeat and the one-per-dump rule. |
| Resume a cut build where it stopped | It is worth having between passes (#1468), but it does not stop the cut. Inside a gzip pass it costs the whole decompression again. |

## Consequences

**Positive:**
- An edit, a pull or a restart of the backend no longer stops a build of hours. A deploy that recreates the worker still does: the worker is the backend's image, so `docker compose up --build` (`npm run dev`) after a change under `backend/` rebuilds it. That is a deploy to time between builds.
- One mechanism serves a build started from the panel, by a script or by a second worker. The panel follows them all by the same row.
- The syncs, cut by the same restarts, have a place to move to if that is decided later.

**Negative / Trade-offs:**
- One more service to run. A stack without it queues builds that never start, and the panel shows them waiting for the worker.
- The worker runs the code it started with. A fix to the build reaches it only on its restart, which stops the build it runs.
- The panel shows progress at the worker's five-second beat, not in real time.

## Amendments

- 2026-10-14, before acceptance: the first consequence says a deploy that recreates the worker still stops its build. The review found that the stack's own `npm run dev` rebuilds the worker on any backend change.

## References

- Related ADRs: ADR-0101 decision 4 (a build is started by an admin and runs from the shared pipeline), ADR-0105 (the subset build)
- Related docs: `docs/tech/dumps.md` § A build, § The admin panel
- Issues: #1467, #1463, #1468, #1434
