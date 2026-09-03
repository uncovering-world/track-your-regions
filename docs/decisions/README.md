# Architecture Decision Records

This directory contains all architectural decisions for the Track Your Regions project.

ADRs are **immutable**. Only `Status` can change. To revise a decision, create a new ADR
and mark the old one as `Superseded by ADR-XXXX` — or, when a new ADR narrows only part of
an older one and the rest stands, `Accepted — decision N narrowed by ADR-XXXX`. Superseding
a multi-decision ADR to revise one of them would retire the decisions that still hold.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-use-maplibre-over-mapbox.md) | Use MapLibre over Mapbox | Accepted | 2024-11-01 |
| [0002](0002-use-gadm-for-administrative-boundaries.md) | Use GADM for administrative boundaries | Accepted | 2024-11-01 |
| [0003](0003-barrel-exports-for-controllers.md) | Use barrel exports for controllers | Accepted | 2025-01-01 |
| [0004](0004-drizzle-orm-plus-raw-pool-for-postgis.md) | Drizzle ORM + raw pool for PostGIS | Accepted | 2025-01-01 |
| [0005](0005-source-agnostic-world-view-import.md) | Source-agnostic world view import pipeline | Accepted | 2025-01-01 |
| [0006](0006-martin-for-vector-tiles.md) | Martin for vector tile serving | Accepted | 2025-01-01 |
| [0007](0007-jwt-with-httponly-refresh-tokens.md) | JWT with httpOnly refresh tokens | Accepted | 2025-02-01 |
| [0008](0008-tanstack-query-for-server-state.md) | TanStack Query for server state | Accepted | 2025-01-01 |
| [0009](0009-import-controller-domain-split.md) | Split worldViewImportController by domain | Accepted | 2026-04-25 |
| [0010](0010-spatial-anomaly-detection.md) | Spatial anomaly detection algorithm (BFS adjacency) | Accepted | 2026-04-26 |
| [0011](0011-icp-adaptive-alignment.md) | ICP adaptive alignment for CV-GADM division matching | Accepted | 2026-04-26 |
| [0012](0012-scope-fallback-and-accept-with-transfer.md) | Scope fallback and accept-with-transfer for geoshape/point matching | Accepted | 2026-04-25 |
| [0013](0013-manual-paint-editor.md) | Manual cluster-paint editor for CV match recovery | Accepted | 2026-04-26 |
| [0014](0014-vector-border-editing.md) | Vector border editing for cluster paint editor | Accepted | 2026-04-26 |
| [0015](0015-python-cv-microservice.md) | Python CV microservice for image-processing pipeline | Accepted | 2026-04-26 |
| [0016](0016-ai-management-layer.md) | Centralized AI management layer | Accepted | 2026-04-25 |
| [0017](0017-server-bind-address.md) | Server bind address — loopback by default, all interfaces in production | Accepted | 2026-06-03 |
| [0018](0018-base-layer-mirror-world-view.md) | Experiences reach the administrative base layer through a mirror world view | Accepted | 2026-07-27 |
| [0019](0019-matching-policy-per-source-shape.md) | The matcher picks a policy from the shape of the source's tree | Accepted | 2026-07-30 |
| [0020](0020-experience-lifecycle-and-run-changeset.md) | Record a changeset per sync run, and split an experience's lifecycle into two axes | Accepted — decisions 1 and 2 narrowed by 0021, decision 1 also by 0026, decision 2 also by 0024, decision 3 by 0022 | 2026-08-02 |
| [0021](0021-source-may-restore-membership.md) | A sync may restore `source_membership`, in one direction only | Accepted | 2026-08-03 |
| [0022](0022-locations-are-marked-not-deleted.md) | A location is marked, not deleted, and no run may empty a category | Accepted — its deferred verdict columns landed for locations by 0026; decision 2 narrowed by 0027 | 2026-08-05 |
| [0023](0023-works-first-museum-selection.md) | Museum selection is works-first, with no institutional term and no cap | Accepted — decisions 1 and 2 narrowed by [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) | 2026-08-07 |
| [0024](0024-a-category-may-refuse-what-the-source-still-lists.md) | A category may refuse what the source still lists | Accepted — decisions 2 and 4 narrowed by [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) | 2026-08-07 |
| [0025](0025-per-source-curation-gate.md) | A source is trusted or it is not, and the product says which | Accepted — decision 5 narrowed by [0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) | 2026-08-10 |
| [0026](0026-a-run-records-what-a-container-holds.md) | A run records what a container's contents did, per kind of contents | Accepted — decisions 1 and 2 narrowed by [0029](0029-what-an-object-is-made-of-can-be-curated.md) | 2026-08-15 |
| [0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md) | A point the source rewrites more precisely is the same point | Accepted — decisions 1 and 5 narrowed by [0029](0029-what-an-object-is-made-of-can-be-curated.md) | 2026-08-16 |
| [0028](0028-a-reader-is-positioned-by-places-they-can-go-to.md) | A reader is positioned by places they can go to, never by a point that names the whole | Accepted | 2026-08-17 |
| [0029](0029-what-an-object-is-made-of-can-be-curated.md) | What an object is made of can be curated, and a correction outlives the run | Accepted | 2026-08-20 |
| [0030](0030-answers-from-a-source-are-kept-with-an-expiry.md) | What a source answers is kept, with an expiry a person can change | Accepted | 2026-08-21 |
| [0031](0031-a-display-rung-drops-what-a-reader-cannot-see.md) | A display rung drops what a reader cannot see | Accepted | 2026-08-23 |
| [0032](0032-a-rule-stays-absolute-and-the-debt-is-recorded.md) | A rule about the catalogue stays absolute, and the debt is recorded beside it | Accepted | 2026-08-24 |
| [0033](0033-lighthouse-through-its-node-api-with-lighthouse-ci-budgets.md) | Lighthouse is driven through its Node API, and the budgets keep Lighthouse CI's syntax | Accepted | 2026-08-24 |
| [0034](0034-a-place-has-an-address.md) | A place has an address, and ids decide it | Accepted | 2026-08-25 |
| [0035](0035-ancestor-geometry-invalidation-lives-in-the-database.md) | Ancestor geometry invalidation lives in the database | Accepted | 2026-08-27 |
| [0036](0036-a-rung-carries-the-holes-its-source-has.md) | A rung carries the holes its source has | Accepted | 2026-08-27 |
| [0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) | A field of a part readers can see is held like the object's own | Accepted | 2026-08-30 |
| [0038](0038-a-held-proposal-is-answered-per-field.md) | A held proposal is answered per field, and the answer is recorded by value | Accepted — decisions 1 and 1a narrowed by ADR-0039 | 2026-08-30 |
| [0039](0039-a-run-records-facts-not-columns.md) | A run records facts, not columns: every metadata key is its own changeset entry | Accepted | 2026-08-31 |
| [0040](0040-a-work-names-every-one-of-its-makers.md) | A work names every one of its makers, and a curator can correct them | Accepted | 2026-08-31 |
| [0041](0041-a-database-says-which-migrations-it-has-seen.md) | A database says which migrations it has seen | Accepted | 2026-08-31 |
| [0042](0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md) | A search answers about the catalogue, and opens where the reader is | Accepted | 2026-09-01 |
| [0043](0043-a-picture-we-show-is-one-we-may-show.md) | A picture we show is one we may show | Accepted | 2026-09-01 |
| [0044](0044-a-work-leaves-a-museum-behind-a-floor-measured-on-works.md) | A work leaves a museum by a mark, behind a floor measured on works | Accepted | 2026-09-02 |
| [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) | A traveller browses by kind of place, and a source is how a kind is filled | Accepted — decision 4 narrowed by [0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md) | 2026-09-03 |
| [0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md) | A place is ours to identify, and two rows become one place by a merge a curator confirms | Accepted | 2026-09-03 |
| [adr-template](adr-template.md) | — Template — | — | — |

## When to create an ADR

See `CLAUDE.md` § Architecture Decision Records.
