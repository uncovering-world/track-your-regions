# Curation applies to everything a reader sees — decisions taken

**Status:** decided in conversation 2026-08-05, not yet specced in full. Local working document,
never committed.

This supersedes the part of `slice-f-per-source-curation-gate.md` that had the gate hold an
experience's contents as one bundled proposal. **Slice F is to be re-cut around what follows.**
The rest of that spec — the per-source setting, the three states, the migration's honesty, the
New chip re-anchoring, `curated_fields` staying — is unchanged and still stands.

The design is not finished: what an "experience" in the museum category even *is* turned out to
be broken (see `museum-import.md`), and that has to be settled before this is specced, because
a gate over a catalogue full of departments and dead collectors' collections curates the wrong
things.

---

## The decision

**Curation is not a property of an experience. It is a property of anything a run brings in and
a reader can see.** There are three such things, and all three get the same three states —
`pending` (nobody has seen it), `auto` (shown, nobody checked it), `verified` (a person passed
what is live now):

| | seen by a reader as | tracked personally by a user in |
|---|---|---|
| experience | a row in a list, a pin, a search hit | `user_visited_experiences` |
| location | a pin under an experience | `user_visited_locations` |
| treasure | an item inside an experience | `user_viewed_treasures` |

The product already treats all three as things a person deals with individually — there is a
table recording each. Curation existed for only the first of them.

## Why not bundle contents into the experience's proposal

That was the previous design, and it fails in three ways:

1. **It is all-or-nothing.** A dozen new paintings arrive at the Prado and the whole Prado waits
   — a curator cannot publish a corrected description without blessing twelve artworks they know
   nothing about, and cannot hold one suspicious artwork without holding the museum.
2. **Contents-level curation degrades gracefully.** The Prado stays visible, minus the one
   unchecked painting. A 758-point site stays visible, minus three unchecked components.
3. **It puts the decision at the wrong grain.** The one real incident so far — sync run 42 —
   was a *contents* failure: the source returned 291 artworks where the previous run returned
   1906, and 45 museums lost most of their artwork counts. Bundled into experiences, that is 45
   separate cards each reading "-11 artworks", and no card from which a person could see that
   the run had broken.

## The rules that come with it

- **A source is trusted or it is not**, decided once per source. Unchanged from slice F.
- **Nothing that nobody has seen needs protecting.** A gated source refreshes an invisible item
  in place — content, points and treasures alike — so the curator reviews the newest state
  rather than whatever arrived first.
- **Contents of an unseen container ride with it.** A new museum arrives with twenty paintings:
  one decision, not twenty-one. An artwork becomes its own queue item only when it arrives at a
  museum that is *already visible*.
- **The curator's card is grouped by container, the decision is per row.** "Museo del Prado —
  description changed, 12 new paintings", each publishable on its own. Grouping is what makes
  the volume bearable; per-row decisions are what stop one doubtful painting freezing a museum.
- **Nothing is deleted, only marked.** This is the biggest change, and it is not about the gate.
  Today, when a source stops offering a location, the row is deleted and `ON DELETE CASCADE`
  silently takes the user's record of having been there with it. A location that is an object
  rather than a disposable row gets the lifecycle an experience already has — "the source no
  longer offers this" becomes a verdict, not a deletion — and a visit record becomes
  indestructible by construction.
- **A run that saw far less than last time may not conclude that things vanished.** The 90 %
  coverage floor that already protects experiences applies to contents too. Run 42 returned a
  sixth of the artworks and reported `success`; that floor would have stopped it.

## Where the state lives for a treasure

Split across two, mirroring the two axes ADR-0020 already established for experiences:

- **on the treasure** — "this is a real work, correctly described". Checked once, globally.
- **on the link between treasure and experience** — "it is here". This is the fact that changes:
  works are sold, moved, and lent, and the source records ownership rather than location.

An earlier draft put the state on the treasure alone. That was wrong: a move is a change to the
link, and links are currently only ever added, never removed, so a moved work would show in both
museums for ever. 66 works already sit in more than one museum — mostly provenance chains
(Rembrandt's *Jewish Bride* is owned by the Amsterdam Museum, hangs in the Rijksmuseum, and
Wikidata also records the 1854 van der Hoop bequest) and replicas (Duchamp's *Fountain* exists in
five museums, and all five are true).

**What this cannot answer:** whether a visitor will actually see the work. Loans, restoration and
rotating display are invisible to the source, which records ownership. The honest response is
wording — "in the collection of", not "on display at".

## What this costs

Slice F as written has to be re-cut: its tasks for holding an experience's points and treasures
as one bundled proposal go away and are replaced by the same three states applied three times.
The migration is still free — everything existing becomes `auto`, nothing is rewritten: 1603
experiences, 6677 locations, 1014 treasures.

## Order of work

1. States and the per-source setting — the migration touches three tables and rewrites nothing.
2. **Locations stop being deleted** — the lifecycle, so visit records survive. Independent of the
   gate and worth doing on its own.
3. The gate for experiences — holding their own content, publishing, hiding from readers, the
   New chip.
4. The gate for contents — locations and treasures, the grouped card, per-row publication.
5. The coverage floor for contents, and an honest run status.
6. A curator can correct a coordinate; the reader sees the mark.
7. Documentation and the ADR.

Related: `museum-import.md` (what an "experience" in the museum category is, which has to be
settled first), `slice-f-per-source-curation-gate.md` (the parts still standing),
`review-queue-redesign.md` (the wider redesign).
