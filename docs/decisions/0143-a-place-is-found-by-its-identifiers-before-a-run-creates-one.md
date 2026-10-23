# ADR-0143: A place is found by its identifiers before a run creates one

**Date:** 2026-10-23
**Status:** Accepted

---

## Context

ADR-0046 decision 1 gave a place an identity of its own: a source's identifier (a Wikidata item, a
World Heritage id, an OpenStreetMap object) is a property of the place's membership in a kind, never
the place's key, because a
serial site's components mostly have no item, a curator's place has none by definition, and a place
is a place whether or not Wikidata has heard of it. ADR-0084 made a place belong to no source and
no kind: a kind is a membership on it. ADR-0132 made the place kinds read one gather of candidates,
each kind's rule labelling a candidate with its kind.

What none of them changed is how a run *writes* a candidate: it looks the place up by its own
membership's key (source, external id) and, finding none, creates a place. Two sources that read one
Wikidata item create two places, and ADR-0046 decision 2 then merges them, after the run, without a
question (`mergeArrivalsOfRun`, `mergeEqualItems`, with the record and undo of ADR-0086). Measured on
the development catalogue on 2026-10-23:

- **Every equal-item duplicate is made by the write, and it is still being made.** There are 570
  equal-item merges. The largest pairs of sources are UNESCO and Archaeology 214, Places of worship
  and UNESCO 140, Places of worship and Archaeology 88, Art Museums and Archaeology 32; the other
  96 fall among 18 further pairs. Two were undone.
  Under the shared gather, the three kinds added on 2026-10-22 and 2026-10-23 made 41 more copies in
  their first runs (Bridges 21, Squares 11, Towers 9), each folded away after the run.
- **Identifiers are spread and of mixed strength.** 3,737 memberships are keyed by an item (3,268
  distinct items). 3,798 component points carry an item of their own (`experience_locations.wikidata_item`).
  A World Heritage site of one point resolves to one item (`wikidata_items`, ADR-0088). 17 items are
  carried by several places at once, up to six: an item naming an ensemble, such as the monastery
  item the chapels and the village of Saint Thaddeus all carry, which identifies none of them.
- **Places without any item are a large share and legitimate.** 5,562 of the 6,834 UNESCO places are
  component parts of serial sites (ADR-0100), most with no item, and a curator's place has none.
- **The fuzzy signal is rare.** 9 near-place proposals have ever been raised.

The product review asked whether this is more machinery than the model needs: a place is one thing,
and classifiers decide its kinds. Merging and separating places afterwards (#1801, #1885) is the cost
of not following that model when the place is written. The practice of the field agrees.

- **Overture's Global Entity Reference System.** Its places get stable, meaning-free identifiers. A
  registry says which are live, and bridge files map each source's identifier to the entity it
  contributed to.
- **Master data management.** It matches before it creates: an exact identifier match joins the
  existing record, a probable one goes to a steward, and a cross-reference from each source record
  to the master record is kept, so a wrong match can be unmerged without loss.

## Decision

**1. A place keeps the catalogue's own identifier** as its key (ADR-0046 decision 1, unchanged in
that). No external identifier is the place's key. What changes is where the identifiers are held:
on the place, in a registry, rather than on its memberships (decision 2).

**2. A place's external identifiers are a registry, and an identifier that identifies names one live
place.** `place_identifiers` holds, per place:

- its scheme: `wikidata`, `whc` (a World Heritage site's or component's reference), `osm`, or a
  source's own `source:<id>`;
- its value;
- whether it **identifies** the place or only **refers** to it.

A unique index over the identifying rows makes a second live place for the same identifier
impossible. A referring identifier is kept for what it says, and is never used to find a place: an
item several parts carry names their ensemble (ADR-0100 decision 4). A membership's `(source,
external id)` stays the membership's own key, and is the registry's `source:<id>` row for that place.

**3. One resolver finds a place before a run creates one, for every source.** `findOrCreatePlace`:

- **Its own membership.** A run's candidate is looked up by its membership first.
- **An identifying identifier.** Then by each identifying identifier it carries, under an advisory
  lock on the identifier's value, so two runs reading one item cannot both create it.
- **Neither.** A place is created, with its identifiers registered in the same transaction.

Found, the run adds its kind's membership (its label) to that place, and writes through the rules
that already govern a second source's view of a place: the hold (ADR-0025), the field families, the
membership-scoped points and works (ADR-0084). The World Heritage run, the museum import, the place
pass and a curator's create all go through it. A Wikidata item that Wikidata has redirected to
another is resolved to its target before it is looked up.

A candidate of one point that joins a place of one standing point is that point, whatever the
distance, as the merge makes two such places one point (ADR-0088 decision 3). The run places its
membership on the place's point, its own coordinate is its view on its membership, and where the
two differ by more than ten metres the sources card asks which one stands (#1246). Chartres
Cathedral's two sources put it 30 m apart, the Cave of Altamira's 753 m: each stays one pin. On a
place of several points, ADR-0137's ten metres stays the rule.

**4. A merge is for two places that should be one when no identifier says so.** These are the
near-place proposals (ADR-0046 decisions 2 to 4) and a curator's own merge, with the record and the
undo of ADR-0086. The equal-item merge after a run (`mergeArrivalsOfRun`) and the admin pass
(`mergeEqualItems`) are retired once the registry is backfilled and the catalogue check
`places-sharing-a-wikidata-item` counts 0. The merges already made stay, with their records and
undo.

**5. A wrong identifier is corrected where it is.** A curator who finds that an identifier names
another thing takes it off the place, or moves it to the right place. That is an edit of the
registry, written to the place's history. Where the kind it brought is then not this place's, the
curator separates that membership into a place of its own (#1885): the unmerge of a cross-reference
the practice keeps. It is the rare case (2 of 570 equal-item merges were undone), and it is built after
the resolver, not before it.

**6. `experiences.source_id` and `external_id` say where a place first came from, and nothing reads
them as a key.** That is ADR-0084 decision 3, restated, because a reader still breaks it: one that
names a place's one kind by them (`rowKindJoinSql` in `backend/src/db/membership.ts`, a list's
group and pin colour). It reads the kind from the place's memberships instead: the membership of the kind the
reader asks for, and otherwise the first of the place's kinds in display order. So no write has to
keep the two columns in step with a membership, and no membership is a place's own.

This narrows ADR-0046 decisions 1, 2 and 4: an identifier is held on the place, and an equal one
is found before a run creates a place, so it neither merges on its own nor waits as a proposal. It
narrows ADR-0086 decision 5 (once the equal-item merge is retired, a merge that names no curator is
found only in the records of the merges already made), ADR-0088 decision 2 (a World Heritage site of one point and one
item is that item's in the registry, where it used to be for the merge), ADR-0088 decision 3 (two
places of one point are one point when a run joins one to the other, not only when they merge),
ADR-0100 decision 4 (a part and another kind's place are one place because the run finds the part
by its item, not because the catalogue merges them afterwards) and ADR-0137 decision 1 (on a place
of one point, a joining run's one point is that point at any distance).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep creating, merge after the run (today) | Every equal identifier makes a copy that exists until the merge, writes its points, works and changeset against it, and leaves a merge record no curator asked for. The copies are still made by every new kind. |
| Join on arrival by a Wikidata item only (#1801) | It removes the copy for one scheme and keeps the merge for every other case, so the catalogue keeps two mechanisms, and an item two parts carry still needs a rule of its own. The registry states that rule once, as `refers`. |
| An external identifier as the place's key (Wikidata's item) | Rejected by ADR-0046 decision 1, and still wrong: most components of serial sites and every curator's place have no item, and an item can be merged or redirected on Wikidata. |
| Fuzzy matching (name and distance) before creating | The signal is weak and rare (9 near-place proposals ever), and a wrong automatic join is worse than a proposal. It stays a curator's question (ADR-0046 decision 4). |

## Consequences

- No run makes a copy it must merge, so the equal-item merge code and the planned join on arrival
  (#1801) are replaced by one resolver and one registry. The undo stays for the merges already
  made.
- A source that first brings a place a kind already holds is an arrival of a membership, not of a
  place. Its card shows the place it joined.
- The registry is backfilled from what holds identifiers today: memberships, World Heritage
  `wikidata_items`, component points' items and references. A conflict the backfill finds is a
  duplicate the merges missed, and it is reported, not merged.
- An identifier's strength becomes data: `identifies` against `refers`, set where the identifier is
  written (a component's item is identifying unless two parts carry it).
- A run reading a component's item finds the component part and gives it its kind, the state the
  equal-item merge reaches today by folding the part into the kind's place (the Temple of Karnak as
  a place of worship, part of Ancient Thebes), without a second place in between.
- Wikidata redirects must be readable from the subset (ADR-0105). Until they are, a run reads them
  live, as it reads the classes of a depicted subject (#1832).

## References

- Related ADRs: ADR-0046 (identity, narrowed), ADR-0084 (a place belongs to no source and no kind),
  ADR-0086 (the merge record and its undo, narrowed), ADR-0088 (a site of one point is its item,
  narrowed), ADR-0100 (components are places, narrowed), ADR-0105 (the subset the runs read),
  ADR-0137 (a point within ten metres is another source's, narrowed),
  ADR-0132 (the shared gather of the place kinds)
- Related docs: `docs/tech/experiences.md`
- Issues: #1889 (this decision), Epic #1891 and its slices #1892 to #1897, #1801 (replaced by #1894),
  #1885 (the unmerge)
- Overture Maps, Global Entity Reference System; master data management's match-merge and
  cross-reference practice
