# Architecture Decision Records

This directory contains all architectural decisions for the Track Your Regions project.

ADRs are **immutable once Accepted**. From then on only `Status` can change. To revise a
decision, create a new ADR and mark the old one as `Superseded by ADR-XXXX` — or, when a new
ADR narrows only part of an older one and the rest stands, `Accepted — decision N narrowed by
ADR-XXXX`. Superseding a multi-decision ADR to revise one of them would retire the decisions
that still hold.

A **Draft** is a proposal under review, and its text may be revised until the pull request
that accepts it lands: that pull request is where the wording is settled, and a note in the
ADR says what was amended while it was Draft and why. Immutability protects a decision that
is in force; a draft that could never be corrected before it binds anything would only teach
authors to write ADRs after the fact. ADR-0058 decision 4 is the precedent — written as Draft
by #888 as the rule to be decided from a measurement, finished from that measurement by #892,
and accepted by it.

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-use-maplibre-over-mapbox.md) | Use MapLibre over Mapbox | Accepted | 2024-11-01 |
| [0002](0002-use-gadm-for-administrative-boundaries.md) | Use GADM for administrative boundaries | Accepted — its licence consequence narrowed by [0078](0078-the-product-is-public-and-non-commercial-and-gadm-is-asked-before-it-is-published.md) | 2024-11-01 |
| [0003](0003-barrel-exports-for-controllers.md) | Use barrel exports for controllers | Accepted | 2025-01-01 |
| [0004](0004-drizzle-orm-plus-raw-pool-for-postgis.md) | Drizzle ORM + raw pool for PostGIS | Superseded by [0064](0064-row-types-are-generated-from-the-schema-and-queries-stay-sql.md) | 2025-01-01 |
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
| [0022](0022-locations-are-marked-not-deleted.md) | A location is marked, not deleted, and no run may empty a category | Accepted — its deferred verdict columns landed for locations by 0026; decision 2 narrowed by 0027 and by [0090](0090-a-component-renumbered-by-an-extension-is-the-same-point.md) | 2026-08-05 |
| [0023](0023-works-first-museum-selection.md) | Museum selection is works-first, with no institutional term and no cap | Accepted — decisions 1 and 2 narrowed by [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) and [0056](0056-a-work-the-world-reads-opens-a-second-door-to-the-world-tier.md) | 2026-08-07 |
| [0024](0024-a-category-may-refuse-what-the-source-still-lists.md) | A category may refuse what the source still lists | Accepted — decisions 2 and 4 narrowed by [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) | 2026-08-07 |
| [0025](0025-per-source-curation-gate.md) | A source is trusted or it is not, and the product says which | Accepted — decision 5 narrowed by [0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) | 2026-08-10 |
| [0026](0026-a-run-records-what-a-container-holds.md) | A run records what a container's contents did, per kind of contents | Accepted — decisions 1 and 2 narrowed by [0029](0029-what-an-object-is-made-of-can-be-curated.md) | 2026-08-15 |
| [0027](0027-a-point-rewritten-more-precisely-is-the-same-point.md) | A point the source rewrites more precisely is the same point | Accepted — decisions 1 and 5 narrowed by [0029](0029-what-an-object-is-made-of-can-be-curated.md); decision 5a-i narrowed by [0117](0117-the-location-pairing-is-made-complete-before-any-arm-reads-it.md) | 2026-08-16 |
| [0028](0028-a-reader-is-positioned-by-places-they-can-go-to.md) | A reader is positioned by places they can go to, never by a point that names the whole | Accepted — decision 2 narrowed by [0095](0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) | 2026-08-17 |
| [0029](0029-what-an-object-is-made-of-can-be-curated.md) | What an object is made of can be curated, and a correction outlives the run | Accepted | 2026-08-20 |
| [0030](0030-answers-from-a-source-are-kept-with-an-expiry.md) | What a source answers is kept, with an expiry a person can change | Accepted — decision 1 narrowed by [0047](0047-a-cached-answer-belongs-to-the-source-that-asked.md); decision 4 narrowed by [0119](0119-a-source-that-reads-the-subset-keeps-only-what-it-still-asks-live.md) | 2026-08-21 |
| [0031](0031-a-display-rung-drops-what-a-reader-cannot-see.md) | A display rung drops what a reader cannot see | Accepted | 2026-08-23 |
| [0032](0032-a-rule-stays-absolute-and-the-debt-is-recorded.md) | A rule about the catalogue stays absolute, and the debt is recorded beside it | Accepted | 2026-08-24 |
| [0033](0033-lighthouse-through-its-node-api-with-lighthouse-ci-budgets.md) | Lighthouse is driven through its Node API, and the budgets keep Lighthouse CI's syntax | Accepted — decision 2 narrowed by [0118](0118-a-budget-may-leave-out-a-host-the-repository-does-not-serve.md) | 2026-08-24 |
| [0034](0034-a-place-has-an-address.md) | A place has an address, and ids decide it | Accepted | 2026-08-25 |
| [0035](0035-ancestor-geometry-invalidation-lives-in-the-database.md) | Ancestor geometry invalidation lives in the database | Accepted — narrowed by ADR-0068 | 2026-08-27 |
| [0036](0036-a-rung-carries-the-holes-its-source-has.md) | A rung carries the holes its source has | Accepted | 2026-08-27 |
| [0037](0037-a-part-field-readers-see-is-held-like-the-objects.md) | A field of a part readers can see is held like the object's own | Accepted — decision 6 narrowed by [0050](0050-a-renamed-component-is-found-by-its-claim.md); decision 1 narrowed by [0089](0089-a-parts-empty-field-is-filled-without-a-hold.md) and [0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) | 2026-08-30 |
| [0038](0038-a-held-proposal-is-answered-per-field.md) | A held proposal is answered per field, and the answer is recorded by value | Accepted — decisions 1 and 1a narrowed by ADR-0039; decision 3 narrowed by ADR-0125 | 2026-08-30 |
| [0039](0039-a-run-records-facts-not-columns.md) | A run records facts, not columns: every metadata key is its own changeset entry | Accepted — decision 2 narrowed by ADR-0077 | 2026-08-31 |
| [0040](0040-a-work-names-every-one-of-its-makers.md) | A work names every one of its makers, and a curator can correct them | Accepted — decision 6 narrowed by [0049](0049-a-curator-writes-a-works-picture-only-with-its-credit.md) | 2026-08-31 |
| [0041](0041-a-database-says-which-migrations-it-has-seen.md) | A database says which migrations it has seen | Accepted | 2026-08-31 |
| [0042](0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md) | A search answers about the catalogue, and opens where the reader is | Accepted | 2026-09-01 |
| [0043](0043-a-picture-we-show-is-one-we-may-show.md) | A picture we show is one we may show | Accepted — decision 2's order narrowed by [0094](0094-the-item-named-as-a-world-heritage-property-is-its-item-whichever-number-it-carries.md) | 2026-09-01 |
| [0044](0044-a-work-leaves-a-museum-behind-a-floor-measured-on-works.md) | A work leaves a museum by a mark, behind a floor measured on works | Accepted — decision 2 narrowed by [0110](0110-a-works-floor-counts-the-sources-own-works-less-its-fame-decisions.md) | 2026-09-02 |
| [0045](0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md) | A traveller browses by kind of place, and a source is how a kind is filled | Accepted — decision 4 narrowed by [0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md); decisions 2 and 3 narrowed by [0048](0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md); decision 4 narrowed by [0084](0084-a-place-belongs-to-no-source-and-no-kind.md) | 2026-09-03 |
| [0046](0046-a-place-is-ours-to-identify-and-a-merge-is-confirmed-by-a-curator.md) | A place is ours to identify, and two rows become one place by a merge a curator confirms | Accepted — the wording of decision 5 narrowed by [0084](0084-a-place-belongs-to-no-source-and-no-kind.md); decisions 1 and 5 narrowed by [0100](0100-a-serial-sites-components-are-places-part-of-the-site.md); decisions 2 and 3 narrowed by [0120](0120-a-near-pair-is-also-asked-when-one-names-words-stand-in-the-others.md) | 2026-09-03 |
| [0047](0047-a-cached-answer-belongs-to-the-source-that-asked.md) | A cached answer belongs to the source that asked | Accepted | 2026-09-04 |
| [0048](0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md) | A kind is filled in two tiers, each from its own kind of source | Accepted — decision 1 and decision 5's "top" narrowed by [0126](0126-the-two-tiers-differ-by-source-and-weigh-the-same.md) | 2026-09-06 |
| [0049](0049-a-curator-writes-a-works-picture-only-with-its-credit.md) | A curator writes a work's picture only with its credit | Accepted | 2026-09-06 |
| [0050](0050-a-renamed-component-is-found-by-its-claim.md) | A renamed component is found by its claim, and a tie the name does not decide is nobody | Accepted | 2026-09-07 |
| [0051](0051-the-review-queue-is-one-list-of-dated-questions.md) | The review queue is one list of dated questions, filtered and set aside per curator | Accepted | 2026-09-07 |
| [0052](0052-a-place-of-worship-is-admitted-for-itself-or-for-what-it-holds.md) | A place of worship is admitted for itself or for what it holds | Accepted | 2026-09-08 |
| [0053](0053-a-curators-no-is-a-verdict-on-an-arrival-and-a-mark-on-a-part.md) | A curator's no is a verdict on an arrival and a mark on a part | Accepted — decision 2 narrowed by ADR-0083, decision 3 narrowed by ADR-0067 | 2026-09-09 |
| [0054](0054-placement-reads-leaves-through-their-pieces.md) | Placement reads the leaves through their pieces, and asks a non-leaf only about what no leaf holds | Accepted | 2026-09-10 |
| [0055](0055-readership-is-read-from-monthly-dumps-and-an-unseen-country-is-unobserved.md) | Readership is read from Wikimedia's monthly dumps, and a country the data does not show is unobserved, not unread | Draft | 2026-09-11 |
| [0056](0056-a-work-the-world-reads-opens-a-second-door-to-the-world-tier.md) | A work the world reads opens a second door to the world tier | Accepted | 2026-09-11 |
| [0057](0057-a-work-famous-in-its-own-language-admits-its-museum-where-no-native-source-is-adopted.md) | A work read at home as much as a world masterpiece admits its museum to a regional tier that has no native source | Draft | 2026-09-11 |
| [0058](0058-archaeology-is-one-kind-of-sites-and-museums.md) | Archaeology is one kind of sites and museums, and a museum joins it for what it is, not for one find | Accepted — decision 4 narrowed by [0060](0060-the-site-pool-has-a-second-entrance-the-map.md) and [0127](0127-a-site-the-world-reads-opens-a-second-door-to-the-world-tier.md); decisions 1 and 2 narrowed by [0103](0103-a-museum-whose-famous-find-no-kind-shows-arrives-in-archaeology-held-for-a-curator.md); decision 2 narrowed by [0104](0104-the-map-is-a-third-signal-of-an-archaeology-museum-and-a-department-in-an-art-museum-is-refused.md) | 2026-09-13 |
| [0059](0059-what-the-catalogue-takes-from-openstreetmap-it-keeps-separable-and-offers-under-odbl.md) | What the catalogue takes from OpenStreetMap it keeps separable and offers under ODbL | Accepted | 2026-09-13 |
| [0060](0060-the-site-pool-has-a-second-entrance-the-map.md) | The site pool has a second entrance, what the map calls a dig, and one rule judges both | Accepted — decisions 2 and 3 narrowed by [0098](0098-a-place-the-map-shows-in-use-is-refused-on-the-maps-entrance.md); decision 1 narrowed by [0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md) | 2026-09-15 |
| [0061](0061-the-catalogues-world-map-is-a-read-of-the-api-not-a-tile-source.md) | The catalogue's world map is a read of the API, not a tile source | Accepted | 2026-09-16 |
| [0062](0062-a-gate-runs-only-when-its-inputs-changed.md) | A gate runs when, and only when, the inputs it checks have changed | Accepted — decisions 3 and 4 narrowed by [0092](0092-a-gate-reads-its-own-side-and-its-own-settings.md) | 2026-09-20 |
| [0063](0063-sql-whose-correctness-is-a-row-set-is-tested-on-postgres.md) | SQL whose correctness is a row set is tested on PostgreSQL | Accepted | 2026-09-21 |
| [0064](0064-row-types-are-generated-from-the-schema-and-queries-stay-sql.md) | Row types are generated from the schema, and queries stay SQL | Accepted | 2026-09-21 |
| [0065](0065-a-rule-both-sides-apply-lives-in-one-package-both-import.md) | A rule both sides apply lives in one package both import | Accepted | 2026-09-21 |
| [0066](0066-an-endpoints-answer-is-a-backend-schema-and-the-clients-type-is-generated-from-it.md) | An endpoint's answer is a backend schema, and the client's type is generated from it | Accepted — decisions 3 and 7 narrowed by ADR-0073 | 2026-09-22 |
| [0067](0067-accepting-a-refusal-keeps-it-and-a-batch-answer-pins-nothing.md) | Accepting a refusal keeps it, and a batch answer pins nothing | Accepted — its consequence on the 119 batch pins narrowed by [0096](0096-the-unread-batchs-pins-are-released-once-read.md); decision 2 narrowed by [0097](0097-a-cards-put-back-pins-only-when-the-curator-remembers-it.md) | 2026-09-24 |
| [0068](0068-a-member-change-invalidates-its-region-in-the-database.md) | A member change invalidates its region in the database | Accepted | 2026-09-25 |
| [0069](0069-a-catalogue-tables-writers-are-a-closed-list-and-a-locked-write-takes-the-lock.md) | A catalogue table's writers are a closed list, and a locked write takes the lock | Accepted | 2026-09-25 |
| [0070](0070-the-database-refuses-a-curation-state-move-the-gate-does-not-allow.md) | The database refuses a curation-state move the gate does not allow | Accepted | 2026-09-26 |
| [0071](0071-a-route-is-declared-once-and-its-middleware-follows-from-the-declaration.md) | A route is declared once, and its middleware follows from the declaration | Accepted | 2026-09-26 |
| [0072](0072-the-openapi-document-is-generated-from-the-route-declarations-and-linted.md) | The OpenAPI document is generated from the route declarations, and linted | Accepted | 2026-09-27 |
| [0073](0073-the-web-client-is-generated-from-the-openapi-document-by-orval.md) | The web client is generated from the OpenAPI document by Orval | Accepted — decisions 4 and 5 narrowed by ADR-0074 | 2026-09-27 |
| [0074](0074-a-type-no-route-answers-is-derived-and-no-image-url-carries-a-token.md) | A type no route answers is derived from the generated ones, and no image URL carries a token | Accepted | 2026-09-28 |
| [0075](0075-a-regions-write-bumps-the-tile-version-at-commit.md) | A write to regions bumps its world view's tile version, at commit | Accepted | 2026-09-28 |
| [0076](0076-a-dialogs-fields-and-refusals-come-from-one-form-hook.md) | A dialog's fields and its refusals come from one form hook | Accepted | 2026-09-29 |
| [0077](0077-the-curation-gate-keeps-its-tables-and-a-claims-reach-is-decided-once.md) | The curation gate keeps its tables, and a claim's reach is decided in one place | Accepted | 2026-09-29 |
| [0078](0078-the-product-is-public-and-non-commercial-and-gadm-is-asked-before-it-is-published.md) | The product is public and non-commercial, and GADM is asked before it is published | Accepted | 2026-09-30 |
| [0079](0079-each-kind-of-project-information-has-one-home.md) | Each kind of project information has one home, and drafts stay local | Accepted | 2026-10-01 |
| [0080](0080-the-repositorys-workflows-are-skills-both-agents-read-from-one-copy.md) | The repository's workflows are skills both agents read from one copy | Accepted | 2026-10-01 |
| [0081](0081-a-kind-is-a-record-before-it-is-code-and-an-expectation-is-listed-before-the-catalogue-holds-it.md) | A kind is a record before it is code, and an expectation is listed before the catalogue holds it | Accepted | 2026-10-01 |
| [0082](0082-a-fame-line-counts-wikipedia-language-editions.md) | A fame line counts Wikipedia language editions | Accepted | 2026-10-03 |
| [0083](0083-a-no-to-a-moved-point-keeps-the-stored-pin.md) | A no to a moved point keeps the stored pin | Accepted | 2026-10-04 |
| [0084](0084-a-place-belongs-to-no-source-and-no-kind.md) | A place belongs to no source and no kind | Accepted — decision 4 narrowed by [0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md) and by [0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) | 2026-10-04 |
| [0085](0085-one-wikidata-item-is-one-reading-whichever-source-reads-it.md) | One Wikidata item is one reading, whichever source reads it | Accepted | 2026-10-05 |
| [0086](0086-a-merge-is-a-record-that-moves-a-place-into-another-and-back.md) | A merge is a record that moves one place into another, and can move it back | Accepted — decision 3 narrowed by ADR-0088 and [0100](0100-a-serial-sites-components-are-places-part-of-the-site.md) | 2026-10-07 |
| [0087](0087-jev-suggests-an-answer-on-a-curator-card-and-a-curator-decides.md) | Jev suggests an answer on a curator's card, and a curator decides | Accepted | 2026-10-08 |
| [0088](0088-a-world-heritage-site-of-one-point-is-its-one-item-and-one-point.md) | A World Heritage site of one point is its one Wikidata item, and merges to one point | Accepted — decision 1 narrowed by [0094](0094-the-item-named-as-a-world-heritage-property-is-its-item-whichever-number-it-carries.md) | 2026-10-08 |
| [0089](0089-a-parts-empty-field-is-filled-without-a-hold.md) | A part's empty field is filled without a hold | Accepted | 2026-10-08 |
| [0090](0090-a-component-renumbered-by-an-extension-is-the-same-point.md) | A component renumbered by an extension is the same point | Accepted | 2026-10-10 |
| [0091](0091-a-gates-pass-is-reused-for-the-same-inputs.md) | A gate's pass is reused for the same inputs, keyed from the gate map | Accepted — decision 1 narrowed by [0092](0092-a-gate-reads-its-own-side-and-its-own-settings.md) | 2026-10-11 |
| [0092](0092-a-gate-reads-its-own-side-and-its-own-settings.md) | A gate reads its own side and its own settings, and only CI runs everything for the map | Accepted | 2026-10-11 |
| [0093](0093-the-web-unit-lane-runs-under-happy-dom.md) | The web unit lane runs under happy-dom, not jsdom | Accepted | 2026-10-12 |
| [0094](0094-the-item-named-as-a-world-heritage-property-is-its-item-whichever-number-it-carries.md) | The item named as a World Heritage property is its item, whichever number it carries | Accepted | 2026-10-12 |
| [0095](0095-a-place-of-several-points-has-no-coordinate-of-its-own.md) | A place of several points has no coordinate of its own | Accepted | 2026-10-12 |
| [0096](0096-the-unread-batchs-pins-are-released-once-read.md) | The pins of the unread batch of 2026-09-14 are released once a curator has read them | Accepted | 2026-10-12 |
| [0097](0097-a-cards-put-back-pins-only-when-the-curator-remembers-it.md) | A card's put-back pins only when the curator chooses to remember it | Accepted | 2026-10-12 |
| [0098](0098-a-place-the-map-shows-in-use-is-refused-on-the-maps-entrance.md) | A place the map shows in use is refused on the map's entrance | Accepted | 2026-10-12 |
| [0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) | A rewrite a visitor would not notice passes the gate | Accepted | 2026-10-12 |
| [0100](0100-a-serial-sites-components-are-places-part-of-the-site.md) | A serial site's components are places, part of the site | Accepted | 2026-10-13 |
| [0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md) | Bulk reads come from public dumps, and Wikidata is kept as a wide subset cut by entity | Accepted — decision 2 narrowed by [0105](0105-the-wikidata-subset-follows-containment-chains-and-is-kept-compact-and-swapped-in-whole.md), decision 6 narrowed by [0121](0121-english-wikipedias-structure-is-kept-as-articles-categories-and-their-links.md) | 2026-10-13 |
| [0102](0102-a-work-one-kind-refuses-as-held-by-a-place-is-handed-to-the-kind-that-holds-it.md) | A work one kind refuses as held by a place is handed to the kind that holds that place | Accepted — decision 2 narrowed by [0112](0112-a-handed-over-work-its-statements-place-nowhere-goes-where-the-refusal-named.md) | 2026-10-13 |
| [0103](0103-a-museum-whose-famous-find-no-kind-shows-arrives-in-archaeology-held-for-a-curator.md) | A museum whose famous find no kind shows arrives in Archaeology held for a curator | Accepted | 2026-10-13 |
| [0104](0104-the-map-is-a-third-signal-of-an-archaeology-museum-and-a-department-in-an-art-museum-is-refused.md) | The map is a third signal of an archaeology museum, and a department in an art museum is refused | Accepted | 2026-10-14 |
| [0105](0105-the-wikidata-subset-follows-containment-chains-and-is-kept-compact-and-swapped-in-whole.md) | The Wikidata subset follows containment chains, and is kept compact and swapped in whole | Accepted — decision 4 narrowed by [0107](0107-a-subset-build-cut-in-its-second-pass-is-picked-up-not-started-again.md) | 2026-10-14 |
| [0106](0106-public-dump-builds-run-in-a-worker-process-queued-through-the-ledger.md) | Public dump builds run in a worker process, queued through the ledger | Accepted | 2026-10-14 |
| [0107](0107-a-subset-build-cut-in-its-second-pass-is-picked-up-not-started-again.md) | A subset build cut in its second pass is picked up, not started again | Accepted | 2026-10-15 |
| [0108](0108-gitleaks-reads-every-tracked-file-for-a-generic-credential.md) | gitleaks reads every tracked file for a generic credential | Accepted | 2026-10-15 |
| [0109](0109-a-field-belongs-to-the-family-of-sources-that-brings-it.md) | A field belongs to the family of sources that brings it | Accepted — decisions 1 and 3 narrowed by [0111](0111-a-shared-field-that-names-a-familys-own-field-goes-with-it.md) | 2026-10-15 |
| [0110](0110-a-works-floor-counts-the-sources-own-works-less-its-fame-decisions.md) | A works floor counts the source's own works, less what its fame line decides | Accepted | 2026-10-15 |
| [0111](0111-a-shared-field-that-names-a-familys-own-field-goes-with-it.md) | A shared field that names another family's own field goes with that field | Accepted | 2026-10-16 |
| [0112](0112-a-handed-over-work-its-statements-place-nowhere-goes-where-the-refusal-named.md) | A handed-over work its own statements place nowhere goes where the refusal named | Accepted | 2026-10-16 |
| [0113](0113-a-regions-reference-map-is-kept-in-the-database-as-raster-bytes.md) | A region's reference map is kept in the database, as raster bytes | Accepted | 2026-10-16 |
| [0114](0114-work-is-held-in-queues-one-issue-per-goal.md) | Work is held in queues, one issue per goal, with a checkable end and a journal | Accepted | 2026-10-16 |
| [0115](0115-a-point-is-offered-to-several-maps-the-devices-own-first.md) | A point is offered to several maps, the device's own first | Accepted | 2026-10-16 |
| [0116](0116-a-gap-the-catalogue-carries-is-judged-once-in-a-committed-ledger-by-cause.md) | A gap the catalogue carries is judged once, in a committed ledger by cause | Accepted | 2026-10-16 |
| [0117](0117-the-location-pairing-is-made-complete-before-any-arm-reads-it.md) | The location pairing is made complete before any arm reads it | Accepted | 2026-10-17 |
| [0118](0118-a-budget-may-leave-out-a-host-the-repository-does-not-serve.md) | A Lighthouse budget may leave out a host the repository does not serve | Accepted | 2026-10-17 |
| [0119](0119-a-source-that-reads-the-subset-keeps-only-what-it-still-asks-live.md) | A source that reads the subset keeps only what it still asks live | Accepted | 2026-10-18 |
| [0120](0120-a-near-pair-is-also-asked-when-one-names-words-stand-in-the-others.md) | A near pair is also asked about when one name's words all stand in the other's | Accepted | 2026-10-18 |
| [0121](0121-english-wikipedias-structure-is-kept-as-articles-categories-and-their-links.md) | English Wikipedia's structure is kept as articles, categories and their links | Accepted | 2026-10-18 |
| [0122](0122-a-world-views-geometry-computation-runs-in-the-dump-worker-beside-its-builds.md) | A world view's geometry computation runs in the dump worker, beside its builds | Accepted — decision 2 narrowed by [0123](0123-a-regions-union-is-made-of-full-resolution-inputs-and-bounded-where-it-runs.md) | 2026-10-18 |
| [0123](0123-a-regions-union-is-made-of-full-resolution-inputs-and-bounded-where-it-runs.md) | A region's union is made of full-resolution inputs, and bounded where it runs | Accepted | 2026-10-18 |
| [0124](0124-the-dump-built-tables-live-in-a-workbench-schema-and-every-table-declares-its-tier.md) | The dump-built tables live in a workbench schema, and every table declares its tier | Accepted | 2026-10-19 |
| [0125](0125-a-type-answer-is-the-kinds.md) | A held answer to a kind's type is the kind's, and every other is the place's | Accepted | 2026-10-19 |
| [0126](0126-the-two-tiers-differ-by-source-and-weigh-the-same.md) | The two tiers of a kind differ by source and weigh the same | Accepted | 2026-10-19 |
| [0127](0127-a-site-the-world-reads-opens-a-second-door-to-the-world-tier.md) | A site the world reads opens a second door to the world tier | Accepted | 2026-10-20 |
| [adr-template](adr-template.md) | — Template — | — | — |

## When to create an ADR

See `CLAUDE.md` § Architecture Decision Records.
