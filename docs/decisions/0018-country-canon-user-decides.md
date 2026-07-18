# ADR-0018: Country canon as a derived global registry; disputes resolved by the user

## Status

Accepted — 2026-07-18

## Context

World-view work needs a stable country level (L2). Two questions had to be
settled: (1) where does the list of countries come from, and (2) how are
disputed territories handled. The 2026-06-28 strategic review recommended
against building a platform-curated perspectives engine (perspectives ×
rulings × resolver) in v1, and for the earlier "the platform never chooses —
the user decides" model. Nikolay added two hard constraints (2026-07-17/18):
the list must be a **derivative of open standards by published rules**
(explainable to users, not our editorial product), built **dynamically**
(not a committed artifact), and **not coupled to GADM** (the current unit
source is an implementation detail).

## Decision

- A global `countries` registry (superset with classes) + `disputed_territories`
  registry, derived by a sync service from open sources: Wikidata (CC0),
  Natural Earth (public domain), UN membership. Rules live in code
  (`canonSync/rules.ts`); manual input is limited to unit-match overrides and
  justified exceptions, both in git.
- Disputes affect **per-user counting only** (`user_disputed_preferences`,
  presets as pre-filled choices; `de_facto` default). No perspectives engine;
  preset data is forward-compatible as its future seed.
- Canon references only internal `administrative_divisions.id`; coverage and
  dispute unit sets are landed geometrically, so the unit source (GADM today,
  per ADR-0002) can be swapped by rebuilding the crosswalk only.

## Consequences

- The country list is explainable ("derived from ISO/UN/Wikidata/NE by these
  rules, on this date") and politically neutral by construction.
- Source drift (esp. Wikidata) surfaces as build diffs, guarded by exceptions.
- The first real build backs this up with evidence, not just intent: the
  94-feature dispute set landed entirely from Natural Earth's
  disputed/breakaway layer (nothing hand-authored), and Wikidata's volatility
  (a merged limited-recognition QID, undated dissolved entities, duplicate
  polity records for Denmark/UK/Greece) was absorbed through the P576 filter,
  the sync's per-build diff report, and eleven documented `exceptions.json`
  entries — not by hand-editing the canon.
- Supersedes nothing; extends ADR-0002 (GADM stays geometry/skeleton source)
  and ADR-0005 (source-agnostic import) toward the layered model of
  world-view-levels-and-perspectives.md.

## References

- Related ADRs: ADR-0002 (GADM administrative boundaries), ADR-0005
  (source-agnostic world view import)
- Related docs: `docs/tech/planning/country-canon-and-disputes.md`,
  `docs/tech/country-canon.md`
- Implementation: `backend/src/services/canonSync/`
