# ADR-0176: A place kind's pool starts at three sitelinks of any Wikimedia site

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

[ADR-0175](0175-a-place-kind-admits-by-quantiles-of-its-own-pool.md) decision 1 reads each of the
six place kinds' world bars off the kind's own pool, and describes that pool as every item the
kind's rule passes and that has a point, "whatever its editions: the regional pool's gather".

The bars it states were not measured on that pool. The review's extract
(`admission-signals.mts`, in the harness of
[the report](../research/2026-11-02-one-admission-frame-for-the-place-kinds.md) § Method) read a
kind's candidates at three sitelinks or more of any Wikimedia site, Wikidata's own count, and then
counted each one's Wikipedia editions. On that pool the quantiles give the ADR's table: Towers 19
editions, 64,996 readers and 12,838 with a guide's mark.

The regional pool's gather has no floor at all. On the development subset of 2026-11-02 it holds
33,219 items of the tower classes, 805,735 of the worship classes and 566,254 of the square and
street classes, most of them read in no Wikipedia. Quantiles over that pool are a few editions and a
few thousand readers, and the world tier would admit tens of thousands of places. The decision's
text and its numbers cannot both hold.

## Decision

This narrows ADR-0175 decision 1; the rest of that ADR stands.

**1. The pool is every item the kind's rule passes, with a point and at least three sitelinks of
any Wikimedia site, whatever its Wikipedia editions.** It is the pool the bars were measured on.
The editions a bar counts stay the runs' counter of Wikipedia editions (ADR-0082): the floor reads
Wikidata's count of sitelinks, the bar reads Wikipedias.

**2. The floor is part of the derivation.** It lives in the register beside the quantile levels
(`WORLD_REGISTER.poolSitelinks`) and moves only by ADR-0175 decision 5's method, since moving it
moves every bar.

**3. A row the kind already holds belongs to the pool when a class question of the kind names it
at the floor**, however the run first fetched it. A row only asked for by id, or named only by an
entrance (the street-art places), is decided by the bars but does not set them.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| The regional pool's gather, whatever its editions, as ADR-0175's text says | Its quantiles collapse to a few editions and readers, and the bars would admit tens of thousands of places the review never measured. |
| Two Wikipedia editions, the regional tier's own minimum | It is close (Towers' readers bar 57,146 on the development subset, against 64,996) but is not what the bars were measured on, and a second derivation would be needed to adopt it. |

## Consequences

**Positive:**
- The runs read the pool the review measured, and the bars they compute match the ADR's table
  within the readership's own drift.

**Negative / Trade-offs:**
- The run reads every candidate of the six kinds at three sitelinks from the local subset: about
  100,000 items, some seven minutes of the place pass on the development machine. The live service
  cannot answer a question this wide, so a run on it reads no pool and admits nothing new.

## References

- Narrows: ADR-0175 decision 1.
- Research: [2026-11-02 — One admission frame for the place kinds](../research/2026-11-02-one-admission-frame-for-the-place-kinds.md) § Method.
- Issues: #2177, #2251.
