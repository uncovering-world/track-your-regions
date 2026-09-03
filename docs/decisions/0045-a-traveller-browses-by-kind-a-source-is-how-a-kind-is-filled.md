# ADR-0045: A traveller browses by kind of place, and a source is how a kind is filled

**Date:** 2026-09-03
**Status:** Accepted

---

## Context

The word "category" is read two ways in this repository, and the two readings have been
building different things.

**One reading: a category is a source.** ADR-0024 and ADR-0025 say so as a premise
("each source is one category and one sync service"); the schema comment on
`experience_categories.requires_curation` says it verbatim ("A category is a source here");
`docs/vision/vision.md` lists the three live categories by their source names; and the
planning decision of 2026-08-05 that produced the museum import made the category "strictly art
museums" and sent archaeology and history museums to "their own future import, category and
source". Everything a reader browses by is keyed on `experiences.category_id`: the groups of
the list beside the map, the source pills in Discover, the pin colour, the count in a group
header ("12 of 467"), the curator's scope, the admin routes.

**The other reading: a category is what a traveller stands in front of, and a source is an
implementation detail.** `docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md` says "Museums is a
category; `art` is a type within it" and sketches a chip row `[All] [Art] [History]`;
`docs/vision/EXPERIENCES-OVERVIEW.md` says "a single category can be populated from multiple
sources … What users see is the category." The schema half-supports this: beside
`category_id` there is `experiences.category`, a per-source vocabulary of types (`cultural` /
`natural` / `mixed` for UNESCO, `monument` / `sculpture` for public art, `art` for museums).

The two readings coexisted while every source produced exactly one thing a traveller would
name. They stop coexisting on the three pieces of work the next milestone holds, and on the
data already in the catalogue:

- **The catalogue already contradicts the first reading.** "Top Art Museums" holds 128 rows,
  every one typed `art` by a literal in `museumSyncService`. Checked against Wikidata
  `instance of` on 2026-09-03, 36 of the 127 rows that carry a QID have no art-museum type at
  all; about twenty are archaeological, Egyptological, history or natural-history museums
  (Naples, Athens, Olympia, Delphi, Istanbul, Cyprus, the Egyptian Museum in Cairo, the
  Natural History Museum in Vienna); two are churches (the Church of Our Lady in Bruges holds
  the *Madonna of Bruges*, Antwerp's cathedral holds Rubens); one is the Roman Forum, admitted
  for the *Column of Phocas*. The label on the group is false for the twenty-odd rows that
  are plainly something else — roughly one row in six — and unproven for one in four, because
  works-first admission (ADR-0023) selects *venues that hold a famous work*, whatever
  the venue is.
- **An archaeology import (#581)** is either a fourth source and a fourth group with a fourth
  pin colour, or a second way of filling something a traveller already has a word for.
- **A work a traveller goes to a church to see (#753)** has nowhere to live: a church is not a
  museum, and the works-first source is the only thing that would bring it.
- **Art museums without a famous work (#628)** cannot be admitted at all while "the category"
  is "the museums that hold a qualifying work" (ADR-0023 decision 1).
- **A monument that is also a World Heritage point (#755)** is two rows and two pins today,
  because a row is at once the place and its membership in a source.

The maintainer's own reading as a traveller settled the direction: a person who loves history
museums and does not love art museums wants two lists and two pin colours, not one list with a
chip; a person collecting cathedrals wants Cologne Cathedral in that list, and a person
collecting World Heritage wants it in that one, and it is one place either way; and a list
that exists only because other imports happened to drop a few of its members is worse than no
list at all.

## Decision

**1. The unit a traveller browses by is a *kind of place*, and it is what a traveller would
call the thing in front of them.** World Heritage sites, art museums, archaeology museums,
history museums, public art and monuments, places of worship — each kind is its own list, its
own pin colour and its own count ("12 art museums in Italy"). Museums are **not** one kind with
a type chip: a traveller chooses between an art museum and an archaeological one the way they
choose between a museum and a cathedral, so the kinds are siblings. Where a kind has types
inside it that a traveller would still browse together (a cultural, natural or mixed World
Heritage site; a sculpture or a monument), the type stays a type: a chip on the card and a
filter, not a group.

**2. A kind is offered to readers only when it has a sync of its own and a rule that says what
complete means for it.** Places that other syncs happen to bring — the churches works-first
admits, the cathedrals UNESCO lists — are stored with what they are, but a kind "Places of
worship" does not appear until a sync fills it on its own terms. A list of thirty-seven
churches worldwide with none in Prague is a claim about the world, and a false one; an absent
list says only that we do not cover this yet.

**3. Sources and kinds are related, not one to one.** A kind may be filled from several sources
(art museums: the works-first selection of ADR-0023 *and* a regional list that asks nothing
about famous works), and one source may contribute to several kinds (works-first brings art
museums, archaeology museums and churches, each of which is what it is). Syncing is organised
by kind — an art-museums sync, an archaeology-museums sync — and a kind's sources are the
inputs of that sync. The pipeline is shared (fetch, admit by the kind's rule, type the place
from what it is, find or create the place, write); what differs per kind is its sources and its
rule. `experience_categories` remains the table of **sources**; it stops standing for what the
reader browses by.

**4. A place and its membership in a kind are different things.** Cologne Cathedral is one
place and belongs to two kinds; it has a card in each list, a pin in each colour and counts
once in each. The reason a place was admitted to a kind — the work that justified it
(`admittedFor` today), the list it was on — and the source that brought it live on the
membership, not on the place. A visit is recorded on the place (or on one of its locations,
for a place made of several) and is seen through every membership at once; for a serial World
Heritage site the visit marks the location, never the whole set. How two rows are recognised
as one place — the identity key, the matching signals, the curator's confirmation of a
probabilistic merge — is a decision of its own and is taken in a separate ADR, tracked as an
issue of the same milestone; this ADR only fixes that the separation exists and what each half
carries.

**5. Iconic is a badge, not a ticket.** A regional art museum that holds no work above the fame
line is an art museum in full standing, without the badge. ADR-0023 decision 1 is narrowed:
works-first remains one source of the art-museums kind and the rule that sets the badge, and it
stops being the only way in. "Every museum in the catalogue is definitionally Iconic" ceases to
hold the day a second source is admitted. ADR-0023 decision 2 is narrowed with it: the
22-sitelink line keeps deciding which works and, by holding one, which museums carry the badge,
and the two badges still cannot disagree about the same work — but a museum admitted by another
source may hold no Iconic work at all, so "a museum's card can never be empty" holds only for
the museums works-first admitted.

**6. A refusal is the withdrawal of one membership, and a curator confirms it.** When a kind's
rule says a place does not belong — an archaeological museum in the art-museums list, the
Roman Forum among museums — the machine proposes the withdrawal and the curator decides, through
the same gate that holds every other proposal a run leaves open (ADR-0025, ADR-0037). The place
keeps its other memberships. ADR-0024 decisions 2 and 4 are narrowed: refusal stops being an
action the machine takes on its own, and what it acts on is a membership, not a row.

**7. The gate stays on the source.** ADR-0025 decision 1 — trust is granted or withheld per
source, on `experience_categories.requires_curation` — is unchanged in substance; the table it
sits on is the source table, which is what it always was. A kind fed by a gated and an ungated
source shows the ungated members and holds the gated ones, per member.

**8. Names follow.** "Top Art Museums" is a source's name for a selection rule, not a kind's
name for what a traveller sees; the kind is **Art museums**, and the works-first source is one of
its inputs.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep category = source and add archaeology as a fourth source and fourth group | A traveller in Naples sees the archaeological museum in the art-museums group today and would see it again in the archaeology group tomorrow, as a second row, because `UNIQUE(category_id, external_id)` does not know the two are one place; a church admitted for its Michelangelo stays a "museum" forever; type chips never appear; and the group label "Top Art Museums" stays false for the one row in six that is plainly not an art museum. |
| One kind "Museums" with `art` / `archaeology` / `history` as chips inside it | The maintainer's reading as a traveller is the opposite: history and art museums are different lists to a person who wants one and not the other, with different pins. Code sharing was the only argument for the single kind, and the shared pipeline of decision 3 gives that without merging what the reader sees. |
| Several admission paths inside the one existing museum source row, typed from Wikidata, renamed "Museums" | Fixes the label and the literal `art`, but keeps place and membership as one row, so Cologne Cathedral and the Bruges church still cannot be one place in two lists; and it does not answer the church at all, which is not a museum under any path. |
| Type every place from Wikidata `instance of` and show every kind it implies at once | Produces exactly the partial lists decision 2 forbids: "Places of worship: 37 worldwide" the day after merge, none of them in Prague. |

## Consequences

**Positive:**
- The traveller's words and the product's words are the same: a list of art museums holds art
  museums, a cathedral is in the cathedrals and in World Heritage, and "12 in Italy" counts what
  the header says.
- #581 (archaeology), #628 (regional art museums), #753 (works in churches) and #755 (a
  monument that is also a World Heritage point) each get a shape: a new kind with its own sync, a
  second source of an existing kind, a kind that waits for its sync, and the first use of the
  place/membership split respectively.
- The "Top Art Museums" mislabel has a mechanism that fixes it — memberships proposed for
  withdrawal, kinds typed from what a place is — instead of a hand-edited list.
- New kinds far from museums (books, films, food — `PROPOSED-EXPERIENCE-CATEGORIES.md`) fit the
  same model: a kind, its sources, its rule of completeness.

**Negative / Trade-offs:**
- This is a schema change and a reading change together: a kind is a new table or a new role of
  an existing one, membership is a new table, and every reader of `category_id` that means
  "what the visitor browses by" — list grouping, Discover pills, pin colours, the counts
  endpoint, curator scopes, the cache key of ADR-0030 — has to learn which of the two it meant.
  None of that lands with this ADR; it lands issue by issue, and until it does the code
  conflates the two exactly as before.
- More kinds means more pin colours and a kind filter the map does not have yet; a traveller
  who wants "everything here" scans more groups.
- A place in two kinds counts twice in a region's total unless the total is defined as places,
  not memberships; the definition of every count has to be restated when the split lands.
- Refusal through the gate is slower than the automatic sweep and puts the ~20 mistyped museums
  in a curator's queue rather than out of the catalogue overnight.
- The identity question is deferred to its own ADR; until it is decided, two sources cannot
  safely feed one kind, which orders the work: identity first, second source after.

## References

- Related ADRs: ADR-0020 (lifecycle axes, "no run may empty a category" — unchanged), ADR-0023
  (decisions 1 and 2 narrowed), ADR-0024 (decisions 2 and 4 narrowed), ADR-0025 (unchanged; its table is
  the source table), ADR-0030 (cache keyed per source), ADR-0037 (the gate holds per-field
  answers the same way it will hold withdrawals)
- Related docs: `docs/tech/experiences.md` § Kinds and sources, `docs/vision/vision.md`,
  `docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md`, `docs/vision/EXPERIENCES-OVERVIEW.md`
- PR / issue: #758 (this decision); #581, #628, #753, #755 shaped by it; the place-identity ADR
  is its own issue in the same milestone
