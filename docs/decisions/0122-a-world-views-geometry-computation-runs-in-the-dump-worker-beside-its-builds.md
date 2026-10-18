# ADR-0122: A world view's geometry computation runs in the dump worker, beside its builds

**Date:** 2026-10-18
**Status:** Accepted
**Extends:** [ADR-0106](0106-public-dump-builds-run-in-a-worker-process-queued-through-the-ledger.md) (the dump worker takes a second kind of work, through a ledger of its own)

---

## Context

A world view's geometry computation is long. On 2026-10-17, world view 5 ("Administrative") took 1 h 24 min for 3,831 regions.

It is started explicitly from the admin panel, with *Compute Geometries* in the WorldView Editor or in an import's review. Until now it ran inside the backend process after the request had been answered, holding its progress in memory. The dev backend runs under `tsx watch`, so an edit or a `git pull` restarted it and stopped the computation part-way. A deploy does the same in production. The progress went with the process, so the panel could not say the run had stopped.

The full-resolution union that #459 decided on for the continents makes the run longer still. Measured on dev on 2026-10-18, one statement takes:

| Region | Time |
|---|---|
| Canada | 3 min 18 s |
| Asia | 6 min 15 s |
| Europe | 9 min 42 s |

Dump builds had the same problem, and ADR-0106 moved them into a worker process queued through a ledger. The maintainer's rule for long work is the same for geometry: a long blocking operation runs only when someone starts it explicitly, and in the worker, never as a side effect of another action.

## Decision

**1. The dump worker runs a world view's geometry computation.**
- The `dump-worker` compose service's process (`backend/src/worker.ts`) takes queued computations as well as builds, and runs them with the existing pipeline (`controllers/worldView/computationRun.ts`).
- An edit, a pull or a restart of the backend does not stop a computation. Stopping the worker does, and the row then says to start it again.
- An ordinary computation started again takes up where the stopped one left off, because it computes the regions with no geometry and their ancestors.

**2. The panel queues a computation in a ledger of its own, `geometry_computations`, which is the only channel between the two processes, as `dump_builds` is for a build.**
- *Compute Geometries* counts the regions to compute, as before. Where there are any, it inserts a `queued` row with what was asked for (`force`, `skip_snapping`) and who asked.
- A unique index admits one queued or running computation per world view, and a second press is answered 409.
- The worker takes the oldest queued row with `FOR UPDATE SKIP LOCKED`. Every five seconds it writes the row's progress and heartbeat: regions done, computed, skipped and failed, the region in hand, and the step.
- *Cancel* closes a queued row at once. On a running one it sets `cancel_requested_at`, which the worker reads with its next heartbeat; the run stops after the region in hand.
- What the panel shows is read from the row, whatever process runs it. A finished computation is shown for 30 seconds after its end, so the poll that comes after the end still reads how it ended. The response shapes the web reads do not change.
- Startup closes what cannot be running. The worker closes its own runner's running rows, and the backend closes rows that have stopped beating, as for builds (ADR-0106 decision 4).

**3. The two kinds of work run side by side, each one at a time.** The worker runs two loops, one taking builds and one taking computations.
- A computation never waits hours behind a build, and a build never waits behind a computation.
- Two computations do not run at once, even of different world views. Each region's union is a heavy statement, and two runs side by side would each take longer for no gain to either.

**4. A region's geometry is computed only by an admin's explicit action, and the backend lint holds the rule.**
- `computationRun.ts` is imported by the worker's entry alone.
- The region pipeline it runs (`geometryComputeSingle.ts`) is imported by `computationRun.ts` alone.
- The editor's single-region recompute (`recomputeRegionGeometry`) is imported by its stream (`geometryComputeSSE.ts`) alone.
- No read and no write computes a geometry as a side effect: the read path never did (`geometryRead.ts`), and a region change only clears the derived parent (ADR-0035).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the run in the backend and make it resumable | A restart would still stop it part-way, the panel would still lose its progress, and every deploy would interrupt a run the continents now need minutes per statement for. |
| A worker process of its own for geometry | One more compose service and one more process to restart, for work the dump worker already has the shape for: a ledger, a heartbeat, a cancel through the row, and startup cleanup. |
| Queue computations in `dump_builds` | That row's columns are a dump's: the file, its date, its checksum and its bytes. A computation would leave them empty and need columns of its own beside them, and one unique index could not serve both. |
| Run builds and computations one at a time in one queue | A two-hour build would hold back a computation an admin started, and the reverse. They are separate work, and nothing in either waits for the other. |
| Let several computations run at once | Each region's union already uses the database's CPU for minutes, and two runs side by side would each take longer. |

## Consequences

**Positive:**
- A computation of the whole Administrative world view, or a continent's full-resolution union, survives an edit, a pull or a deploy of the backend.
- The panel says how a computation ended, including one stopped by a restart, from its row.

**Negative / Trade-offs:**
- A computation needs the worker running. On a stack without the `dump-worker` service, such as the isolated test stack, a queued computation waits until a worker takes it, and the panel says it is waiting for the dump worker.
- A change to the computation's code is live only once the worker restarts. A restart stops the computation it runs, as it stops a build.

## References

- Related ADRs: ADR-0106 (dump builds run in a worker process, queued through the ledger), ADR-0035 (a region change clears the derived parent)
- Related docs: `docs/tech/world-views.md` § Geometry computation, `docs/tech/geometry-columns.md`, `docs/tech/dumps.md`
- Issue: #1658; #459, the full-resolution union this makes room for
