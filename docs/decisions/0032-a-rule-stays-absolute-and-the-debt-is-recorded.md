# ADR-0032: A rule about the catalogue stays absolute, and the debt is recorded beside it

**Date:** 2026-08-24
**Status:** Accepted

---

## Context

Nothing in this repository looks at what the catalogue **holds**. `npm run check` reads the
source, Semgrep and Trivy read it again, the schema guards compare two SQL files as text, and the
E2E smoke drives a browser over a fixture. A defect that writes wrong rows into an otherwise
healthy database is therefore invisible until a person looks at a screen: from 2026-08-10 the
catalogue held a withdrawn point for Bilbao Fine Arts Museum whose replacement stood 1.2 cm away,
every sync run reported `success` — correctly, since a withdrawal plus an arrival is an ordinary
outcome — and it surfaced nine days later only because a human read a card that happened to print
the distance (#543).

Asking the question is easy: assertions over the live database that should return no rows. What
that runs into is the catalogue itself. Measured on the dev catalogue the day this was written:

| Assertion | Rows |
|---|---|
| An object offered to readers that no region holds | 28 |
| A place the source still offers that no region holds | 173 |
| A picture shown with nobody credited | 2911 |

None of these is a rule anybody disputes. All three are true of the catalogue today, and two of
them are the known consequence of open work — a point that falls outside every boundary (#469) or
lies offshore (#470) is placed nowhere, and 1414 of the uncredited pictures have their
photographer already fetched and held by the curation gate. Every rule added later will arrive to
find rows that predate it: points without coordinates, geometry covering nothing, whatever a new
kind of data brings.

So the question is not whether to assert. It is what a lane does when the answer is "yes, and we
know".

Three shapes were considered:

- **Fail on any row.** Red from the first morning and red for ever, which is how a check becomes
  wallpaper. The rules that hold get no attention because the ones that do not drown them.
- **Report without failing.** Nothing to distinguish 28 objects that have been in no region for
  months from 31 the placement run broke this morning, so nobody reads it either.
- **Weaken the rules to what passes today.** "No more than 28 objects may be unplaced" is not a
  claim about the product; it is a claim about the state of one database, written into the code
  where nobody can tell it from a rule.

## Decision

**1. The rule stays at zero and the debt is recorded separately.** An assertion says what should
be true of the catalogue, without qualification and without a tolerance baked into it. What a
person accepts is the *number that rule currently returns*, recorded beside it, and what the lane
reports is the comparison: a count that stands still is debt being carried, a count that has grown
is something writing those rows now.

**2. The accepted number lives in the database it describes.** `data_assertion_acceptances`, in
the same database as the rows it is about. The numbers describe one catalogue's rows, so a dump
restored elsewhere carries its own accepted debt and a fresh checkout of the code inherits none —
which is the opposite of what a file in the repository would do, where one machine's catalogue
would be imposed on everybody else's and a dev database re-synced weekly would churn it.

**3. It is a ledger, not a setting.** One row per act of accepting, never updated: the newest row
per assertion is the number in force, and the rows behind it are the history of what this
catalogue was carrying and who said so. Accepting a number is a judgement about the product — it
is how a rule the catalogue cannot pass today stops blocking everything else, and equally how a
defect gets quietly buried — so it carries an author and a date for the same reason every curator
action does (ADR-0020).

**4. The number is measured by the server, one assertion at a time.** The client names an
assertion; the server re-runs it and records what it returns. A count supplied by a browser would
let a screen minutes out of date — or a hand-made request — record a number the catalogue never
held, and the whole design rests on the accepted figure being a measurement rather than a claim.
One at a time, because a single control that accepted everything would make the run where somebody
answers for a newly added rule also the run that re-baselines a regression standing beside it,
which is the one thing this exists to catch.

**5. A count that is expected to be non-zero is a `watch`, and cannot be accepted.** Visits
recorded against a place no reader-facing read offers are legitimate by ADR-0022 — a traveller who
stood somewhere stood there, and the record cannot depend on a source still listing the place. Its
rows are not debt, so there is nothing to answer for; what carries meaning is the number moving.
Refusing to accept one is the honest answer to a button that should not exist.

**6. The lane answers to the admin panel.** An admin starts runs there and reads their outcome
there; being asked to open a terminal to find out what the catalogue holds would hand a product
role a developer's tool. A command-line entry point was built first and removed before this
shipped, on exactly that reasoning.

## Consequences

A rule that the catalogue cannot pass can be added the day it is understood, rather than waiting
until the data deserves it: its first appearance states the debt it found, somebody accepts it or
fixes it, and from then on it guards the direction of travel. The cost is a decision per rule per
database, which is the point rather than an overhead — an unanswered assertion is loud until a
person answers for it.

Two things this deliberately does not do. It does not fail a build: the per-commit gates read
files and assume no database, and a lane that needed a populated catalogue could not join them. It
does not tell anybody anything as it happens: that is the per-run anomaly report (#497), and this
one watches the resting state — what the database holds right now, whoever put it there and
whenever.

The accepted numbers travelling with the database has one sharp edge: a dump restored from
production onto a developer's machine brings production's accepted debt with it, and a database
restored from before an acceptance loses it. Both are correct — the numbers are facts about those
rows — but a developer comparing two databases has to read which one they are looking at, which is
why the panel states the number, its date and its author rather than only its verdict.
