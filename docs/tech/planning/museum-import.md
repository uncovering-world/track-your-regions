# The museum import brings in the wrong things — diagnosis and open questions

**Status:** diagnosed 2026-08-05 against the live database and live Wikidata. Not yet designed.
Local working document, never committed.

**Blocks:** the re-cut of slice F (`catalogue-curation-model.md`). A curation gate decides
whether a reader may see what a run brought in. Over this catalogue it would have a curator
approving four departments of the Louvre, a museum called `Q214867`, and the collection of a man
who died in 1854 — while the Louvre itself never appears at all.

---

## 1. What the category is supposed to be

`docs/vision/EXPERIENCE-TYPE-AND-SIGNIFICANCE.md` and `docs/vision/EXPERIENCES-OVERVIEW.md`
already settle the model, and this document does not reopen it:

- **Museum type is a closed enum**: `art`, `history`, `archaeology`, `science`, `ethnography`,
  `memorial`, `religion`, `nature`, `niche`. One primary type per experience.
- **Treasure type is a separate, independent axis** — "what kind of treasure is inside a venue
  (artworks, species, etc.). Independent of the venue type — a cathedral and an art museum can
  both hold artworks."
- The overview's own table reads: **Museums · ~100 · type `art` · significance `iconic` ·
  source Wikidata SPARQL**, and states that "the current sync fetches only art museums marked as
  iconic".

So this category is **art museums**, deliberately. Archaeology and history museums were always
meant to be separate imports. That is why the Rosetta Stone cannot appear in the British Museum
here — Wikidata types it `stele` / `bilingual inscription` / `Epigraphic monument`, and this
import asks only for paintings (Q3305213) and sculptures (Q860861). The whole treasure table is
910 paintings and 104 sculptures and nothing else.

## 2. What the implementation actually does

`museumSyncService.ts`, in order:

1. fetch artworks of those two types above a sitelinks threshold, each with its collection
   (`wdt:P195`);
2. group by collection, take the top ~115 by summed artwork fame;
3. fetch details for each collection — coordinates, country, image, website;
4. resolve collections **that have no coordinates** to a parent via `wdt:P361+`;
5. keep those that ended up with coordinates, cap at 100.

**Nothing in that pipeline tests whether the collection is a museum, or an art museum.** The
documented filter does not exist. The venue is whatever entity Wikidata hangs the paintings off.

The one deliberate omission is documented in the code and is correct: no `wdt:P279*` subclass
traversal in the main query, because it is the leading cause of Wikidata 504s. Confirmed the
hard way while writing this — an aggregate over all famous paintings timed out, and a later
query returned 502. The endpoint is genuinely fragile, and any fix has to respect that.

## 3. What that produces, measured

### 3.1 The Louvre is not in the catalogue

Four of its curatorial departments are:

| catalogue row | artworks |
|---|---|
| Department of Paintings of the Louvre | 80 |
| Department of Greek, Etruscan, and Roman Antiquities of the Louvre | 5 |
| Department of Near Eastern Antiquities of the Louvre | 3 |
| Department of Egyptian Antiquities of the Louvre | 1 |

Four pins in nearly the same place, 89 artworks split between them, and a visitor searching for
the Louvre finds nothing.

The mechanism is one condition. Step 4 resolves a collection **only when it lacks coordinates**.
`Q3044768` (Department of Paintings) is typed `art collection` and `curatorial department of the
Louvre`, carries `P361 → Louvre Museum`, and **has its own coordinates** — so it is never
resolved. Coordinates are the wrong test; "is this a place you buy a ticket to" is the question.

Worth knowing before designing the fix: `P195` is *ownership*, not location, and `P276`
(location) is not the answer either. For the Mona Lisa, `P195` is "Department of Paintings of the
Louvre" and `P276` is "Salle des États, Louvre" — a department and a room. The visitable
institution is an ancestor of both.

### 3.2 A major museum is in the catalogue as `Q214867`

`Q214867` is the National Gallery of Art in Washington — `P31` says *national gallery* and
*United States federal agency*, and it holds 45 artworks here. Its label exists in `de`,
`en-gb`, `fr` and `mul`, but **not in plain `en`**, and the query asks
`wikibase:language "en"` alone. With nothing to return, the label service hands back the QID,
and that is what a reader sees. Fixed by giving the label service a fallback chain.

### 3.3 Collections that are not places are listed as museums

| row | artworks | what it is |
|---|---|---|
| Andrew W. Mellon collection | 8 | a donor to the National Gallery, died 1937 |
| Borghese Collection | 10 | a collection entity; country recorded as France, and `P361`/`P276` point at both the Louvre and the Galleria Borghese |
| collection Adriaan van der Hoop | 2 | a collector, died 1854; `P361 → Rijksmuseum` |
| Demidov collection | 1 | same shape |
| Manfrin Collection | 1 | same shape; country recorded as "French occupation of the Republic of Venice" |
| Staechelin collection | 1 | same shape |

Three rows with "Collection" in the name are legitimate museums and must survive any filter:
**Wallace Collection** (art museum, historic house museum, national museum), **The Phillips
Collection**, and **Bavarian State Painting Collections** (an umbrella body — debatable, but it
is at least a museum organisation).

### 3.4 The British Museum is in the wrong category

It is here because it owns the Parthenon Frieze and a few other famous sculptures. Its entire
treasure list in this catalogue is eleven items — nine sculptures, one painting, and a
"crystal skull" that is a known nineteenth-century fake. No Rosetta Stone, no Sutton Hoo, no
Lewis Chessmen, no Cyrus Cylinder.

That is not an import bug. It is a museum that is not an art museum, sitting in the art-museum
category, and no amount of curation will make its list honest there.

### 3.5 Blank nodes leak into a reader-facing field

Four of those eleven British Museum treasures carry an artist like
`http://www.wikidata.org/.well-known/genid/0ade2294f6bf52050990a89723561e18`. `isValidQid`
filters blank nodes out of the *collection* binding and nothing filters the *creator* binding.

### 3.6 A run lost two thirds of the artworks and reported success

| run | date | artworks fetched | reported |
|---|---|---|---|
| 3 | 26 July | 1906 | **partial** |
| 42 | 4 August | 291 | **success** |

45 of 128 museums had their artwork counts fall in run 42 — the Art Institute of Chicago from 14
to 3, the Bode Museum from 4 to 1. The honest run that brought 1906 artworks was labelled
partial because a few items errored; the one that brought a sixth of the data was labelled a
success.

The data survived only because `upsertMuseumTreasures` links with `ON CONFLICT DO NOTHING` and
**never unlinks**. Museums now claim 421 artworks between them while 1087 links exist. **Anyone
who "fixes" the missing unlink without first adding a coverage floor for contents will delete
two thirds of the catalogue's artworks on the next such run, and the run will report success.**

### 3.7 Documented model versus stored data

| the docs say | the database holds |
|---|---|
| museums are type `art` | all 128 are `cultural` — UNESCO's enum, leaked into the museum category |
| museums are marked `iconic` | `is_iconic` is false on all 1603 experiences and all 1014 treasures |
| ~1000 treasures used for significance computation | nothing computes significance |

The type-and-significance model is documented as partly live. None of it is implemented.

## 4. Artworks move, and the model has to allow it

66 treasures are linked to more than one museum. Almost none of that is a move:

- **Duchamp's *Fountain* — five museums.** The 1917 original is lost; authorised replicas are
  held by Tate, Philadelphia, SFMOMA, the Israel Museum and Indiana. Five objects, one entity.
- **Rembrandt's *Jewish Bride* — three.** The Amsterdam Museum holds title, it hangs in the
  Rijksmuseum, and Wikidata also records the 1854 van der Hoop bequest. All true; exactly one
  answers "where do I go".

A genuine move — sale, deaccession, reorganisation — would add the new link and leave the old one
for ever, because links are only ever added. The reader would find the work listed in two places
and go to the wrong one. `catalogue-curation-model.md` answers this: the link carries "is it
here" as a lifecycle, so a move is recorded rather than accumulated.

**What no fix can deliver from this source:** whether a visitor will actually see the work.
Loans, restoration and rotating display are invisible to `P195`, which records ownership. The
honest response is wording — "in the collection of", not "on display at".

## 5. Open questions — this is the design work

1. **What counts as a venue?** The institution a visitor buys a ticket to. Needs a test that
   works without a `P279*` traversal in the main query — most likely a second, small query over
   the few hundred distinct collection QIDs, where the full museum-subclass check is affordable.
   Walk up `P361` / `P276` until reaching an entity that is museum-like *and* has coordinates;
   drop what cannot be resolved, and record why (the `filtered` mechanism already exists for
   this).
2. **How is the top selected once "fame of its paintings" stops being the ranking?** This is the
   question that put the British Museum in an art-museum list. Candidate signals are already
   listed in `EXPERIENCE-TYPE-AND-SIGNIFICANCE.md` § Computing Significance — sitelinks, visitor
   numbers, UNESCO connection.
3. **How is the type decided?** `art` versus the other eight. Whatever answers question 2 mostly
   answers this, and it is what lets archaeology and history museums become their own import.
4. **What happens to the 128 rows already imported?** Four Louvre departments merge into one
   Louvre carrying 89 artworks; `Q214867` is renamed or merged with a National Gallery of Art row
   if one exists; roughly seven non-places leave; the British Museum leaves the category. Every
   one of those is a move or a removal, and **today a removal cascades away visit records and
   manual region assignments** — which is why "mark, don't delete" must land first.
5. **Where does the category boundary run**, and does this import get renamed to say "art"?

## 6. Order

1. Locations and treasure links stop being deleted (`catalogue-curation-model.md`, step 2) —
   without it, everything in question 4 is destructive.
2. This design, and the import fix.
3. The curation gate on top, per source — which by then includes the archaeology import as a
   source of its own.

## 7. Smaller repairs to fold in

- label fallback chain, so `Q214867` becomes the National Gallery of Art;
- blank-node filter on the creator binding;
- a coverage floor for contents, and a run status that does not call a sixth of the data a
  success;
- `metadata.country` on museums duplicates `country_names` and disagrees with it; pick one.
