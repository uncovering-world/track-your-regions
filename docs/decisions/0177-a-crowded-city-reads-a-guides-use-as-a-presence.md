# ADR-0177: A crowded city reads a guide's use as a presence, not a count

**Date:** 2026-11-02
**Status:** Accepted

---

## Context

ADR-0172 shows a place unless ten better-known places of its kind and type stand within 10 km. Its
fame is the mean of three percentile ranks among the kind and type's candidates worldwide: readers
a year, the count of Wikivoyage editions that use the item, and its Wikipedia editions.

The Wikivoyage count is coarse. Rome's churches carry 0 to 7, and a guide that names a place under
another item gives it 0. Each step of the count moves the mean by a large step. On dev on
2026-11-02, after the coverage report began to name what the display hides (#2246):

| Place | Readers a year | Wikipedia editions | Wikivoyage editions | Better-known within 10 km |
|---|---|---|---|---|
| Ortaköy Mosque, Istanbul | 106,612 | 37 | 2 | 11 |
| Nanzen-ji, Kyoto | 80,644 | 22 | 4 | 10 |
| Piazza della Rotonda, Rome | 33,783 | 18 | 0 | 11 |

Saint Paul outside the Walls, with 515,201 readers, ranked under Santa Maria in Trastevere, with
186,306, for three guides against five. ADR-0172 measured other orders and found they hide the same
places within ±10. That was before a survey was read the way the map shows it (#2246, ADR-0175).

## Decision

This narrows ADR-0172 decision 1.

**A place's fame reads whether a Wikivoyage edition uses its item, not how many do.**
- The fame is the mean of three percentile ranks among the candidates of the same kind and type
  worldwide: readers a year, the guide's use as a presence, and Wikipedia editions
  (`refresh_crowding()`).
- `membership_fame.guide_editions` keeps the count. Only the rank reads it as present or absent.

Four orders were measured. Each was taken at ADR-0175's point, on what the map shows, against the
surveys' demanded places of the development regions (451):

| Order | Demanded places hidden | Judged noise shown |
|---|---|---|
| the count of guides (until now) | 20 | 6.0 % |
| readers, then editions | 24 | 5.7 % |
| readers' and editions' ranks, the guide count as a tie-break | 17 | 6.1 % |
| **the guide as a presence** | **16** | **6.1 %** |

The two noise shares are the same 17 judged places graded noise among the 281 and the 280 the two
orders show: the share moves by its denominator, not by a place of noise.

The demanded places each order hides, by development region (the harness does not see ADR-0173,
so San Luigi dei Francesi and Santa Maria della Vittoria count as hidden in it):

| Order | Rome | Kyoto | Istanbul | Elsewhere |
|---|---|---|---|---|
| count of guides | Saint Paul outside the Walls, Piazza Farnese, Piazza della Rotonda, San Luigi, Santa Maria della Vittoria, Santa Maria in Aracoeli | Chion-in, Daikaku-ji, Jingo-ji, Kōdai-ji, Nanzen-ji, Tōfuku-ji | Arap Mosque, New Mosque, Ortaköy Mosque | Cairo: Al-Aqmar, Aqsunqur; Berlin: Nollendorfplatz; Moscow: Ivanovsky Convent; Beijing: Zhenjue Temple |
| readers, then editions | Piazza Farnese, Piazza della Rotonda, San Luigi, Santa Maria del Popolo, Santa Maria della Vittoria, Santa Maria in Aracoeli, Piazza Barberini | the six above and Kōzan-ji | Arap Mosque, Rüstem Pasha Mosque | Cairo: Al-Aqmar, Aqsunqur; Berlin: Hackescher Markt, Nollendorfplatz; Moscow: Church of the Deposition of the Robe, Ivanovsky Convent; Beijing: Guangji Temple, Zhenjue Temple |
| ranks with the guide as a tie-break | Piazza Farnese, Piazza della Rotonda, Santa Maria della Vittoria, Santa Maria in Aracoeli, Piazza Barberini | the six above | Arap Mosque, Rüstem Pasha Mosque | Cairo: Al-Aqmar, Aqsunqur; Beijing: Dongyue Temple, Zhenjue Temple |
| **guide as a presence** | Piazza Farnese, Piazza della Rotonda, Santa Maria della Vittoria, Piazza Barberini | the six above | Arap Mosque, Rüstem Pasha Mosque | Cairo: Al-Aqmar, Aqsunqur; Beijing: Dongyue Temple, Zhenjue Temple |


Read once on the control regions, today's order shows 57 of their 79 demanded places, and the
presence order 58: Bangkok's Wat Mahathat comes back.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Keep the count | It hides Saint Paul outside the Walls, Santa Maria in Aracoeli, the New Mosque and Ortaköy, which the presence order shows. |
| Drop the guide from fame | Readers then editions hides the most demanded places, 24. A guide's use is the signal that a traveller goes there. |
| The guide as a tie-break only | It hides 17, one more than presence, at the same noise. |

## Consequences

**Positive:**
- On dev the display rule shows Ortaköy, the New Mosque, Nanzen-ji, Daitoku-ji, Santa Maria in
  Aracoeli and the Catacombs of Rome that it hid (migration 204). The crowded-out count goes from 115
  to 114.

**Negative / Trade-offs:**
- **Other places go into the tail as these come out.** Rome's Santa Sabina, San Clemente and Santa
  Prassede, Istanbul's Rüstem Pasha and Nuruosmaniye, and Kyoto's Hongan-ji and Mii-dera are
  newly crowded out on dev. They are read alongside the places that come back, which is how the
  measurement above counts them.
- **At the point, Kyoto's six hidden temples are hidden under every order.** The measurement holds
  the point's admitted set, where Kyoto's densest temple ground has more temples a guide names than
  ten; the maintainer kept ten (2026-11-02). On today's development catalogue, which holds fewer of
  Kyoto's temples, Nanzen-ji and Daitoku-ji come back (above).

## References

- Related ADRs: ADR-0172 (decision 1 narrowed), ADR-0173 (a place holding works is always shown),
  ADR-0175 (the point and the method)
- Research: `docs/research/2026-11-02-one-admission-frame-for-the-place-kinds.md`
- Issues: #2262, #2177
