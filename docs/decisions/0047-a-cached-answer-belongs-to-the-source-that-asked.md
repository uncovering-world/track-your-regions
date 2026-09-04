# ADR-0047: A cached answer belongs to the source that asked

**Date:** 2026-09-04
**Status:** Accepted

---

## Context

ADR-0030 keeps what Wikidata answers in `wikidata_query_cache`, and its decision 1 keys a row
by the hash of the query text alone: the query is the question, so a changed filter is a
different key and misses by construction. Its decision 4 says the cache belongs to a source —
each row carries a `category_id`, the panel lists a source's kinds, *Clear* deletes a source's
rows — and while one collector asked Wikidata anything the two decisions never met.

The public-art import (#754) is a second collector, and it asks some of the same questions in
the same words: the children of `sculpture`, the `P279*` tree under `museum`. With the query
text as the whole key those questions have one row between the two sources, and the first
dry run showed what that costs:

- The public-art run read the museums' cached children of `sculpture`, a week old, and missed
  the Madara Rider — retyped to a class Wikidata had created that week. Nothing on the
  public-art side could see or refresh that row: it was the museums' by `category_id`, and
  *Sync without cache* bypasses the cache without replacing it (ADR-0030 decision 5).
- The write's `ON CONFLICT (query_hash)` reassigns `category_id` to the last writer, so
  *Clear* on one source silently leaves behind the shared rows the other source last wrote —
  and that source's runs go on reading them. What the panel shows for a source stops being
  what its runs read, which is the disagreement ADR-0030 decision 7 exists to prevent, one
  column over.

## Decision

**The key is the source and the question together.** `query_hash` is the SHA-256 of the
source's `category_id` and the query text, so the same question from two sources is two rows,
each the property of the source that asked it. ADR-0030 decision 1 is narrowed to that; the
rest of ADR-0030 stands, and decision 4 — the cache belongs to a source — is what this reads to
the letter.

Rows keyed the old way are never matched again. Migration 043 empties the table and corrects
the column's comment; a database that skips it loses nothing but disk until each kind's
lifetime passes.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the shared key; on a hit, ignore `category_id` and let both sources read one row | The Madara Rider case: a source cannot refresh a row it does not own, and a class Wikidata adds waits for the other source's schedule. *Clear* on either source is incomplete. |
| Keep the shared key; let the *first* writer own the row for good | Fixes *Clear* in one direction only — the other source still reads rows it can never clear or refresh. |
| Filter the read by `category_id` without changing the hash | The unique index on `query_hash` allows one row per question, so two sources would take turns overwriting each other's row and missing on every alternate run. |
| Add `category_id` to the unique index instead of the hash | The same key, spelled as DDL; a migration on a live index over a cache table, for no gain over hashing the pair. |

## Consequences

**Positive:**
- What the panel shows for a source is what its runs read, and clearing it clears exactly
  that; a class Wikidata adds reaches each source on that source's own schedule.
- No schema change: the column and its index are as they were, only the bytes hashed differ.

**Negative / Trade-offs:**
- A question both sources ask is asked twice of Wikidata, once per source — four class
  questions today, cheap ones (class space, seconds).
- Every row cached under the old key is dead weight until migration 043 runs or its lifetime
  passes: unreadable, and not rewritten in place, so the panel over-reports a source's size.

## References

- Related ADRs: ADR-0030 (decision 1 narrowed; decisions 2–8 stand), ADR-0041 (the migration
  ledger)
- Related docs: `docs/tech/experiences.md` § Public Art & Monuments, *Two sources, two caches*;
  `db/migrations/043-a-cached-answer-belongs-to-the-source-that-asked.sql`
- PR / issue: #802, #754
