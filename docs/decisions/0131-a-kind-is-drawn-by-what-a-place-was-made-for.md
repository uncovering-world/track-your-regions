# ADR-0131: A kind is drawn by what a place was made for, and a place no kind holds waits for its own

**Date:** 2026-10-21
**Status:** Accepted

---

## Context

ADR-0045 decision 1 makes a kind what a traveller calls the thing, with its own list, pin colour
and count. A type is a closed vocabulary inside a kind, for things browsed together. Public Art &
Monuments (kind 3) was drawn by form: #754 admitted "an outdoor artwork, not a building Wikidata
calls a monument". By 2026-10-21 it had become a mixed bag. Of the 178 places it offered on the
development catalogue:

- 83 carry only commemorative classes: the Arc de Triomphe, the Lincoln Memorial, the Brandenburg
  Gate;
- 60 carry only art classes: the Manneken Pis, the Trevi Fountain, Cloud Gate;
- 32 carry both: the Bronze Horseman, the Motherland Calls, Christ the Redeemer;
- 3 carry neither: the Famine Stela, the Nestorian Stele, the Orkhon inscriptions.

About 20 belong to no kind at all: the Tsar Bell, the Anne Frank House, the Temple of Literature
in Hanoi, Sanabria Lake, the Way of Saint James and Kryptos in the CIA's courtyard.

The catalogue also offers no tower, bridge, gate, lighthouse or square, unless one is a World
Heritage property. The Eiffel Tower, the Galata Tower, the Golden Gate Bridge, Tower Bridge and
Red Square are missing. The register of kinds (`db/catalogue-coverage/kinds.jsonl`) proposed one
Towers & landmarks kind for them. The surveys file 82 entries under it: towers, gates, walls,
water works, lighthouses, stairs and a few others.

Before drawing the line, the maintainer asked for a study of how map products and guides sort
sights, and of what the surveys expect
([2026-10-21 report](../research/2026-10-21-how-maps-and-guides-sort-sights.md)). The sources
agree on several points:

- public art and street art are an art category;
- monuments go with memorials;
- "tourist attraction" is an overlay, not a type.

They disagree most on a generic "landmark", and Overture and OpenStreetMap have none.

The maintainer took the decision on 2026-10-21, one question at a time (#1163).

## Decision

1. **A kind is drawn by what a place was made for, not by its form.** Public Art & Monuments
   splits into two kinds:
   - **Monuments & memorials**: what was made to commemorate, a building raised as a monument
     included (the Lincoln Memorial, the Arc de Triomphe, the Vittoriano). This narrows #754: a
     building is admitted when it was built or remade as a monument (the Neue Wache, a
     guardhouse remade in 1931 as Germany's central war memorial).
   - **Public art**: what is looked at as art or for fun (the Manneken Pis, the Little Mermaid,
     the Trevi Fountain, street art).

   A place made for both is offered by both: the Bronze Horseman, Christ the Redeemer.
2. **There is no Landmarks kind.** "Landmark" names no thing a traveller looks for. What was
   built for use and is visited as a sight becomes a kind per thing:
   - **Towers**: towers, minarets, bell towers, TV towers;
   - **Lighthouses**;
   - **City gates & walls**: one defensive system. A gate or a wall standing whole, passed
     through or walked, is this kind, the Porta Nigra included (Bab Zuweila, Tiananmen, the Great
     Wall at Mutianyu). What survives as ruins stays Archaeology (most of the Theodosian Walls).
     This narrows, for gates and walls, the ruling of 2026-10-20 on #1160 that sent every remain
     of an ended past kept only as a monument to Archaeology, the Porta Nigra by name: read
     literally, it would also take the Delhi Gate and Mutianyu and leave this kind nearly empty;
   - **Historic waterworks**: stepwells, cisterns, nilometers, reservoirs. Aqueducts stay with
     Bridges & engineering;
   - **Bridges**;
   - **Squares & streets**, stairways included (the Spanish Steps, the Yerevan Cascade).
3. **They are separate kinds, not types of one kind.** Each has its own count (3 of the 9
   lighthouses around Sydney), pin colour and rule. A group above kinds, for display, is not
   built now.
4. **A kind's rule is clean from the start.** A place no kind fits leaves the kind it was
   misfiled in. It is not kept there until its own kind exists:
   - the Anne Frank House and Federal Hall wait for historic houses or museums;
   - the Temple of Literature waits for historic buildings;
   - Sanabria Lake waits for nature;
   - the Way of Saint James waits for routes;
   - the Villa d'Este waits for gardens.

   Kryptos is not visitable and does not return.
5. **An object shown at a place stays in the nearest kind for now.** This covers the Tsar Bell
   and the Tsar Cannon in the Kremlin, and the Rondanini Pietà in the Castello Sforzesco. Each
   moves to the card of the place that shows it once a part-of relation covers any place, and
   not only a serial site's components (ADR-0100).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep Public Art & Monuments as one kind, with monument and art as types | The traveller looks for "monuments" and "public art" as different things, and the sources separate them. A type keeps the misfiled places in one list. |
| One Towers & landmarks kind for everything built for use | It mixes a tower one climbs, a lighthouse one walks to and a stepwell one goes down into. "Landmark" is a catch-all in the sources that have it. |
| One Structures kind with towers, lighthouses, gates and waterworks as types | A type is a filter and has no count of its own. People collect lighthouses or towers as a set. |
| Keep a misfiled place where it is until its kind exists | A lake among monuments is the junk the milestone removes. The rule stays clean, and the place returns with its kind. |

## Consequences

**Positive:**
- Each kind's list reads as one thing to a traveller, and its count means something.
- The Public Art split reuses the classes its rule already reads, so no new source is needed.

**Negative / Trade-offs:**
- About 20 places leave the catalogue until their kinds exist, among them the Anne Frank House.
- A commemorative statue that Wikidata types only as a sculpture (the Statue of Liberty) lands in
  Public art until a curator moves it.
- Six new kinds are proposed, and each needs its own source and rule. Their order is set on
  their issues.
- A wall that stands in parts and lies in ruins elsewhere (the Theodosian Walls) is judged by what
  a visitor walks; the rule of City gates & walls draws that line when it is built.

## References

- Related ADRs: ADR-0045 (decision 1, kinds and types), ADR-0100 (part-of for serial sites),
  ADR-0102 (a work refused by one kind goes to the kind that holds it)
- Related docs: `docs/tech/catalogue-coverage.md`, `docs/research/2026-10-21-how-maps-and-guides-sort-sights.md`
- Issues: #1163, #754 (narrowed here), #1807 (the Public Art split), #1808 to #1813 (Towers, Bridges &
  engineering, Squares & streets, Lighthouses, City gates & walls, Historic waterworks), #1160, #876 (a kind control that survives many kinds),
  #1664 and #1665 (palaces and castles, split the same way)
