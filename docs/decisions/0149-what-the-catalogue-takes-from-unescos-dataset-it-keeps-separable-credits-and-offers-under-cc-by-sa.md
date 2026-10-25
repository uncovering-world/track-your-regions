# ADR-0149: What the catalogue takes from UNESCO's dataset it keeps separable, credits, and offers under CC BY-SA

**Date:** 2026-10-25
**Status:** Accepted

---

## Context

The UNESCO run reads `whc001` on data.unesco.org, the World Heritage List as UNESCO's open-data
portal publishes it. The dataset page's schema.org markup declares
`"license": "https://creativecommons.org/licenses/by-sa/4.0/"`. The run takes facts: each property's
number, names in six languages, category, point and components, the states party, the date
inscribed, the danger listing. It also copies text: `transformRecord`
(`backend/src/services/sync/unescoSyncService.ts`) writes the World Heritage Centre's short
description of the property, `short_description_en`, as the place's `description`. On the
development catalogue on 2026-10-25, 1,271 of the 1,272 standing World Heritage places held one,
and Rome's opens "Founded, according to legend, by Romulus and Remus in 753 BC…".

CC BY-SA 4.0 asks two things of that:

- **Attribution.** Whoever sees the text sees who wrote it and under what licence (§ 3(a)). No
  surface named UNESCO or the licence beside a description. `ImageCreditLine` credits pictures and
  `ExtentLine` credits OpenStreetMap's outlines, but nothing credited text.
- **Share-alike over the database.** A database holding all or a substantial part of the licensed
  database's contents is Adapted Material for the sui generis database right (§ 4(b)), and the
  licence asks that it be offered under CC BY-SA. Copying every property's description is a
  substantial part.

`docs/tech/filling-a-kind.md` § 5 and § 6.2 hold a share-alike source at `hold` until the
catalogue answers what that binds. ADR-0059 answered it for OpenStreetMap: the part taken is kept
separable with its provenance, offered under ODbL, and credited wherever it is shown. Wikivoyage
was answered by storing its facts and never its text (ADR-0048). The UNESCO run predates the
register, and nobody had asked the question of it. The register's record
(`docs/sources/global/unesco-world-heritage-list.md`) scored it 13 of 16 and held it at `hold`.
On 2026-10-25 the maintainer decided to answer it as ADR-0059 does (#2010).

The facts are facts, and neither copyright nor the licence reaches them as single items. The
description is an expression.

## Decision

**1. What is taken from `whc001` is marked on the row it is written to.** Every row the UNESCO
run writes carries `metadata.unesco` (`unescoProvenance.ts`). The mark names:
- the dataset (`whc001`);
- the property's number;
- the day the run read the dataset;
- the licence;
- the fields taken, as `facts` (`UNESCO_FACT_FIELDS`: name, local names, type, tags, point,
  components, countries, and the inscription's `metadata` keys) and `text` (`description`, where
  the dataset gave one).

The mark is the run's own record and is stamped again every pass, so it is a run-owned key
(`SYNC_OWNED_METADATA_KEYS`) that raises no question to a curator. Wikidata runs keep it while
the UNESCO membership stands (`FAMILY_FIELDS`). This is the collective-database shape of ADR-0059
decision 2. The UNESCO-derived part of the catalogue can be named, extracted and offered under
CC BY-SA 4.0. This decision does not settle the licence of a future release of the whole
catalogue or of its items; that stays a decision of the public release.

The mark names what the run read, not what the row holds. A field a curator claimed
(`curated_fields`) keeps the curator's value, and a field two sources' views contradict keeps
the value the place already holds, which may be another source's (`reported_*` on the
memberships, `keptAsStored`). So the UNESCO-derived part of a row is the mark less the row's
claims and less any field whose value differs from the UNESCO membership's `reported_*` view. The description is the one exception: a claimed description is UNESCO's
when the curator said it is an edit of UNESCO's text, which is the rule `descriptionSourceSql`
applies (decision 4). Aksum's description is the curator's although its mark lists the text.

**2. The UNESCO-derived part is offered under CC BY-SA 4.0.** Anyone who asks may have it under
that licence, the facts and the text as the mark names them, less what the row keeps as
the curator's or another source's (decision 1).

**3. The text is credited wherever it is shown, curator screens included.** The credit names
"UNESCO World Heritage Centre" and "CC BY-SA 4.0", each linked, beside the text and visible
without interaction. `@tyr/shared/textCredits` declares it once, for the run that stamps the
licence and the screens that show it. A read names the description's source
(`description_source`, `descriptionSourceSql` in `backend/src/db/membership.ts`). That is
`unesco` where the UNESCO source holds the place and the description is UNESCO's text: either no
curator has claimed it, since only the UNESCO run and curators write a description, or a curator
who rewrote it said the new text is an edit of UNESCO's. The screens:
- `DescriptionText` draws the text and its credit together, or nothing (the expanded card and
  Discover's detail panel);
- `DescriptionCreditLine` draws the credit beside a text shown elsewhere: the review card's line
  about the object, and the curator's edit field while it holds UNESCO's text;
- a review row proposing a new description says whose text it is in its sentence, as an extent
  row carries OpenStreetMap's credit.

**4. A curator who rewrites UNESCO's text says whose the new text is.** CC BY-SA asks for the
credit on an adaptation as on the original, and no rule can tell a curator's edit of UNESCO's
paragraph from a text of their own. So the edit dialog asks, on a place the UNESCO source holds,
whenever the description has been touched: "Edit of UNESCO's text", the default, or "My own text".
The answer is a claimed key, `metadata.descriptionAdaptedFrom` (`'unesco'`, or `null` for the
curator's own), which a run keeps. An edit is credited "adapted from UNESCO World Heritage Centre ·
CC BY-SA 4.0" (`description_adapted`), and the curator's own text carries no credit. On
2026-10-25 the one claimed description was Aksum's, which the curator wrote, and it holds no such
key, so it reads as the curator's own. The maintainer chose this on 2026-10-25 over crediting
every rewritten text as an adaptation, which would credit UNESCO under Aksum's, and over dropping
the credit on any rewrite, which would leave an edited paragraph uncredited.

**5. The register record is scored on its merits.** The `hold` is lifted for `whc001`, and the
record's verdict follows its total.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Drop the descriptions and keep the facts, as ADR-0048 does for Wikivoyage | The paragraph is the one text a World Heritage card has, and the licence permits it on terms the catalogue can meet; the maintainer chose to keep it. |
| Credit the text off the run's mark alone (`metadata.unesco`) | Rows hold the mark only once a run stamps them, so every card would go uncredited until the next run. The source of the text is already known from the membership and the claim, and the mark serves the extract. |
| One credit for UNESCO in a data-sources note, not beside the text | The licence asks for the credit where the material is shown, and ADR-0059 decision 3 reads the same obligation that way for OSM. A note a reader never opens credits nobody. |
| Publish the whole catalogue under CC BY-SA | Not this ADR's to decide, as ADR-0059 says for ODbL: the catalogue's own licence and GADM's terms are a decision for the public release. Keeping the UNESCO part separable leaves it open. |

## Consequences

**Positive:**
- The World Heritage card answers the licence it is built on, and the register holds no source
  the product already uses at an unanswered `hold`.
- A CC BY-SA extract of the UNESCO-derived part is producible from the marks, as an ODbL extract
  of the OSM part is from `metadata.osm`.

**Negative / Trade-offs:**
- A World Heritage card carries one more credit line, beside the picture's and the extent's.
- The facts list in the mark is declared in code (`UNESCO_FACT_FIELDS`). A field the run starts
  taking has to be added there, and the spec checks that every `metadata` key it names is one the
  run writes.
- A place whose UNESCO membership no longer stands keeps UNESCO's text and its credit until a
  Wikidata run, which keeps UNESCO's fields only while that membership stands, writes no
  description over it.
- A curator's separation (ADR-0144) moves UNESCO's text with the UNESCO membership, as ADR-0146
  decision 5 moves an outline with its drawer: the description, the mark and the curator's word on
  it go to the new place only when the membership separated is UNESCO's, and the original keeps a
  description only where a curator claimed it as their own. So a separated place of another kind
  starts with no description, where ADR-0144 had it show the original's, and the undo of a
  separation brings the text back with the membership, which the undo of that undo takes away
  again.
