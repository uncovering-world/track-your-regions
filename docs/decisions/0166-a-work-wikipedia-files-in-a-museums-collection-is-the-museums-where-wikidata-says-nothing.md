# ADR-0166: A work Wikipedia files in a museum's collection is the museum's where Wikidata says nothing

**Date:** 2026-10-30
**Status:** Accepted

---

## Context

Every kind that collects works places each work by Wikidata's collection (`P195`) and location
(`P276`) statements (ADR-0023, `placement.ts`). Some of the most famous objects in the world
name no holder there. On 2026-10-30:
- the Code of Hammurabi (Q93304) is typed `law code`, with no collection and no location;
- the Royal Game of Ur (Q937315) is a `board game`;
- the Dead Sea Scrolls (Q145780), the Khufu ship (Q1711677) and the Minoan snake goddess
  figurines (Q1125985) are wholes that name no holder.

No run can place them, so the Louvre, the British Museum, the Israel Museum, the Grand Egyptian
Museum and Heraklion do not offer them (#1999). The proposal of 2026-10-30 to hand them to a
curator as "a concept to find the object for" was refused by the maintainer: that is no question
a person can answer from a card.

English Wikipedia names the museum in the article's categories: *Near Eastern and Middle Eastern
antiquities in the Louvre*, *Middle Eastern objects in the British Museum*, *Collection of the
Israel Museum*, *Collection of the Grand Egyptian Museum*, and Heraklion's own category. #2164
measured those shelves on the copy of Wikipedia's structure (ADR-0121):
- 2,432 categories name a museum with an English article by one of three shapes:
  `Collection(s) of (the) <museum>` (367), `… in/of/at (the) <museum>` (1,580), and the museum's
  own category (485).
- The `… in/of the …` shape is mostly people: *Members of the Sons of the American Revolution*,
  *Prisoners in the Tower of London*, *Employees of the British Museum*. Its head noun tells the
  object shelves apart: *objects*, *antiquities*, *sculptures*, *paintings*, *manuscripts*.
- The museum's own category is junk for this purpose: *Hamlet* under Kronborg, the *Liberty
  Bell* under Independence Park, *Grant's Tomb* under the Mausoleum at Halicarnassus.
- Of the items on those shelves with no holder on Wikidata, 173 carry a work class; 14 of them
  are at the finds' line.

The venue-side read (#890) already asks what every admitted venue holds from Wikidata's side and
judges each object by the kind's own rule. Wikipedia's shelves are the same question asked of the
other source.

## Decision

**1. The venue-side read also reads what English Wikipedia files in each admitted venue's
collection** (`readArticleHoldings`, `museum/articleHoldings.ts`): the items of the articles
filed directly under `Collection(s) of (the) <museum>` and `<object shelf> in/of/at (the)
<museum>`, where the shelf's head noun is one of `COLLECTION_HEADS` (`wikipediaStructure.ts`).
The museum's own category is not read. Each item goes through the kind's own rule as any object
the venue-side read finds (the art museums' classes, the worship vocabulary, the find rule), so
a shelf's stray entry is refused by name like a Wikidata holding is.

**2. Wikipedia's word places a work only where Wikidata makes no statement.** A kept work with
no current `P195` or `P276` is placed at the venue by a statement Wikipedia makes
(`RawStatement.via = 'wikipedia'`, `placementOf` in `venueSide.ts`), and the resolver asks of
that venue what it asks of any. The same holds for a work the class pool collected that its own
statements place nowhere (`shelvedPoolWorks`): the Dead Sea Scrolls are an artefact with a find
spot and no holder. A work Wikidata places is Wikidata's, wherever Wikipedia also files it.
Two things a shelf files are never holdings: an item the kind calls a place (`shelfPlace`;
Archaeology reads its site, settlement, fortification, palace and worship trees, and so leaves the
Mausoleum at Halicarnassus on the Istanbul museums' shelf where a coordinate test would also have
left the Dead Sea Scrolls, which carry Qumran's), and an item under the works pool's floor once
its editions are counted (`holdShelvesToFloor`), since a shelf names its works with no floor where
Wikidata's holdings were asked at the pool's.

**3. The placement is marked, and the card says so.** The treasure carries
`metadata.placedBy = 'wikipedia'` (`ProcessedContent.placedBy`), in the find spot's three states:
a run that read the shelves writes the mark on a work the shelf placed and `null` on every work
it placed by Wikidata, which removes a stored mark, since the catalogue then knows the work's
place from Wikidata; a run that read no shelves sends nothing and the stored mark is kept
(`metadataWithFindSpot`, `treasureWriter.ts`). The mark therefore means one thing wherever it is
read: Wikidata names no holder for this work, and its places are Wikipedia's word. The venue's
changeset names each such work with `placed_by`, and both reach the curator: the arrival's row of works marks the work
*placed by Wikipedia's shelf* (`PendingWork.placedBy`, `ArrivedTable`), and the run's change list
says *placed by English Wikipedia's shelf* beside the work (`SyncContentItem.placed_by`,
`SyncChangeList`). The change list now carries the hand-over mark of ADR-0102 too, which the
answer rows had dropped at the API boundary.

**4. Read from the copy of Wikipedia's structure only.** Without a copy the run says so and
reads nothing of the shelves: asking the live API is a question per venue per shelf, which the
dumps answer in one (ADR-0121, the dumps-first rule of #1312). The one statement cuts every
category title into the tails that could name a museum and joins them to the venues' titles by
equality, about thirty seconds on the development copy; a pattern matched per museum against
every title ran for half an hour.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A curator places the object by hand (#1751) | A concept item with no holder is not a question a curator can answer from a card; the maintainer refused it. #1751 stays for the works no shelf files. |
| Read the museum's own category too | It shelves staff, buildings and the plays set there: *Hamlet* at Kronborg. |
| Every `… in/of the <museum>` shelf | 983 items on *Members of …* shelves alone; the head noun is what tells an object shelf from a roll of people. |
| Ask the live Action API | One question per venue per shelf shape; the copy answers in one statement. |
| Let Wikipedia's shelf override a Wikidata statement | Wikidata's statement is the curated claim; a shelf is a filing. Where they disagree the statement stands, and a curator reads the shelf's word on the card. |

## Consequences

Read through the runs' own pipelines on the development subset, main against this decision:

- Archaeology's 135 admitted venues have shelves naming 2,469 items, 2,144 of which Wikidata
  places at none of them. Nine finds are placed by Wikipedia's word, eleven placements at the same
  127 museums: the Dead Sea Scrolls at the Israel Museum, the Discobolus at the Museo Nazionale
  Romano and the Vatican Museums, the Cuerdale Hoard at the British Museum and the Ashmolean, the
  Kish tablet at the Ashmolean, the Apollo Sauroctonos at the Louvre, the Akan Drum at the British
  Museum, *Harmodius and Aristogeiton* at Naples, *Hounds and Jackals* at the Met and the Diary of
  Merer at the Egyptian Museum. The Mausoleum at Halicarnassus, on the Istanbul museums' shelf, is
  left out as a site.
- Art Museums' 186 venues have shelves naming 5,010 items, 4,187 of which Wikidata places at none
  of them. Five pool works are placed by Wikipedia's word, seven placements at six of the same 173
  museums: the Discobolus at the Vatican Museums, Munch's *Madonna* at Oslo's National Museum and
  the Hamburger Kunsthalle, *The Sick Child* at the Munch Museum and Oslo, the Apollo Sauroctonos
  at the Louvre and *The Burghers of Calais* at the Musée Rodin; 1,354 works against 1,347. The
  subset holds few of the shelved items, which a live run reads in full.

**Positive:**

- The Dead Sea Scrolls, the Discobolus, the Kish tablet and the Cuerdale Hoard are placed by a
  rule, each marked as Wikipedia's placement. The Code of Hammurabi, the Royal Game of Ur and the
  Khufu ship sit on the same shelves, and their items are not in the development subset, so that
  reading is not measured: it is expected of a live run, and the first one says. On the
  development copy the shelves of the British Museum name 424 items and the Louvre's 154.
- The Code of Hammurabi and the Royal Game of Ur are reached on live Wikidata, where their items
  answer a by-id read; the development subset holds neither item, so a dry run there does not
  show them.
- No curator is asked to find an object for a concept.

**Negative / Trade-offs:**

- **A shelf's filing is weaker than a statement.** A museum's shelf may file a work on loan or
  one it once held. The mark on the treasure is what lets a curator see the source; no shelf of
  loans or former holdings surfaced in the measured sample.
- **The mark is kept by a run that read no shelves.** A treasure is global, and a kind with no
  copy of the structure cannot say whether Wikidata now names the holder, so it leaves the mark;
  the next run that reads the shelves and places the work by Wikidata removes it.
- **A work filed only in the museum's own category is not placed**: the Minoan snake goddess
  figurines sit in *Heraklion Archaeological Museum* and on no collection shelf. Reading that
  category would bring Kronborg's *Hamlet* with them.
- **A work no shelf files still reaches nobody by a rule**: Ötzi, Ka-aper, the Zimbabwe Bird.
  They are #1751's, which should offer a curator the candidate venues it can find.

## References

- Extends: #890's venue-side read with a second source
- Related ADRs: ADR-0023, ADR-0058, ADR-0121 (the copy of Wikipedia's structure), ADR-0164
- Related docs: `docs/tech/experiences.md` § Art Museums (the venue-side read)
- Issues: #2164, #1999, #1751
