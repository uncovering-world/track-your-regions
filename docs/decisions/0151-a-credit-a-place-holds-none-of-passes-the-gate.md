# ADR-0151: A credit for the picture a place shows passes the gate where it holds none

**Date:** 2026-10-26
**Status:** Accepted
**Issue:** [#1966](https://github.com/uncovering-world/track-your-regions/issues/1966)
**Narrows:** [ADR-0099](0099-a-rewrite-a-visitor-would-not-notice-passes-the-gate.md) decision 1

---

## Context

A hosted picture carries its credit (ADR-0043): most Commons licences ask for the author to be
named wherever the work appears. Some places show a picture with no credit. Stonehenge shows
`Stonehenge Total.jpg` with nobody named, and Archaeology and Public art both bring that file's
credit, Stefan Kühn. Both gated runs held it for a curator.

ADR-0099 lets a credit pass the gate as `same-file-credit` only when it is re-read for the same
file under the same licence, with a credit on both sides. A credit that appears where the place
holds none is "a value that appears", which that rule leaves to a curator. Yet the picture does not
change, and a reader only gains the author's name. A part's empty credit is already filled without
a question (ADR-0089 decision 2).

Measured on the development catalogue:

- On 2026-10-24, 17 open held cards on 16 places held such a credit, among them Stonehenge, the
  Cave of Altamira, the British Museum and the Egyptian Museum. Each of these places also failed the
  `picture-with-nobody-credited` check.
- On 2026-10-25, after a curator had answered most of them, 7 were left. Hollywood Walk of Fame and
  the National Museum of Denmark held only the credit. The Denmark museum's credit was published by
  a curator on 2026-10-03, was missing from the place by 2026-10-15, and was held again by each of
  the 25 runs after that, while the card hid it as already answered.
- All 5 credits a curator refused on a place are on places that hold a credit.

## Decision

**1. A credit for the picture a place shows, arriving where the place holds none, passes the
gate.** It is filed as `same-file-credit`, the class ADR-0099 gives a credit for the same file,
since that is what it is. It passes when all of these hold:

- the place keeps its picture;
- no curator claims that picture: a claimed picture's credit is the claim's;
- the credit names a licence. A credit that names none says nothing about the terms.

Like the other passing classes, it raises no question, sets no held pointer and demotes no verified
membership.

**2. The rest of ADR-0099's credit rule stands.** These still wait for a curator:

- a credit beside another picture;
- a credit that replaces one under a different licence;
- a credit on a place whose picture a curator claimed.

**3. A work's credit needs no change.** The works writer already writes a credit beside the work's
unchanged picture, held or not, and files no question about it. It freezes the credit only beside a
claimed picture or a held change of the picture.

**4. The held credits of this shape are written once** (migration 174), as a run under this rule
would write them. A card that held nothing else closes. A credit a curator refused stays refused.
A credit a curator published that is still missing from the place is written. Where two cards
propose a credit for one place, the newest card's is written. On dev the migration writes two
credits and closes both cards.

## Alternatives Considered

- **A class of its own** (say, `first-credit`). It would tell a first credit from a re-read one in
  the record. No reader asks that question, and the class names what the gate weighs: the credit
  belongs to the file the place keeps.
- **Keep holding it as ADR-0099 says.** A curator would read a credit beside an empty one, for a
  picture readers already see uncredited. The only answer that keeps the licence is to publish it,
  so the question has one answer.
- **Pass any first credit, beside a new picture too.** A new picture is the place's face and stays
  a question for the object's gate (ADR-0025). Its credit goes with it.

## Consequences

- A gated run no longer asks about the credit of a picture a place already shows uncredited. A
  card that held the credit with something else loses its credit row with that source's next run.
- The `picture-with-nobody-credited` check loses the places whose credit only waited on this gate.
- A curator who refuses such a credit no longer stops a later run from writing it. A refusal
  matters only beside a credit the place already holds, where the rule does not apply.
