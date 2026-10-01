---
name: coverage-check
description: "Check Catalogue Coverage: Load the survey lists, print what the catalogue holds of what a traveller expects, and say what each finding asks for."
---

# Check Catalogue Coverage

Compare the catalogue with the survey lists and turn the report into decisions (ADR-0081): which absent places are defects, which wait for a tier or a kind, and which proposed kind the surveys ask for most. Run it after a sync, after a change of an admission rule, after a new survey list, and before choosing which kind to build next.

## Arguments

$ARGUMENTS — optional: region slugs to narrow the check to, separated by spaces. With none, every surveyed region is read.

## Prerequisites

Read `docs/tech/catalogue-coverage.md` § What the report says: the verdicts and the three parts of the report.

## Instructions

### 1. Load and report

```bash
./scripts/catalogue-coverage.sh load
./scripts/catalogue-coverage.sh report            # add --region <slug> per region in $ARGUMENTS
```

The load reads `db/catalogue-coverage/` and replaces the tables; when it refuses, it names the file and the line, and that is fixed before anything else. The report reads the active database: say which one it is, since a development database and a published one hold different catalogues.

Save the report as `docs/local/research/catalogue-coverage/reports/<date>.txt`, with the command that produced it on the first line. A number without its command cannot be checked later.

### 2. Compare with the report before

When an earlier report is in that directory, say what moved, per region: the share offered, and each verdict's count. A region whose offered count fell lost something a guide names; find which entries by comparing the two reports' lists, and treat each as step 4 treats a defect.

### 3. Something else at its spot

Each line of that section is a place a live kind should hold, absent by identifier, with what the catalogue holds within reach. Read each one and decide, as a traveller who knows the place:

- **The same place under another Wikidata item** (a building and the museum inside it). Find that item's id with the lookup's `search`, add it to the entry's `same_as` in the list file, and say so. The next load finds the place.
- **A named point of a serial World Heritage row** (one temple of a city's monuments). The place has no card of its own. It stays as it is: the report keeps showing it until the kind it is filed under holds it.
- **A neighbour.** Nothing to change.

Do not decide by distance alone. Show the user the ones you could not settle.

### 4. What each live kind lacks

For every entry the section names. Under a kind with a sitelinks line those are the absent entries at or over it. World Heritage and Art Museums have no line, since neither admits a place on its own sitelinks, and the section names every absent entry of theirs, the most named first:

- **Offered through another kind.** The entry is filed under two kinds and one holds it. Check that the second filing is one a traveller would make; if it is not, remove it from the list. If it is, the place belongs to both kinds and the gap is real.
- **Absent.** A well-known place the kind's own rule should admit. Find out why before proposing anything: read the item with the lookup's `facts` (its classes, its coordinates, its sitelinks) and look for the source's refusal in the run's changeset. Then search the open issues (`gh issue list --state open --limit 500 --search "<place or cause>"`). A cause an issue already owns gets the place as a named example: show the user the comment and post it when they agree. A cause no issue owns is a bug to propose with `/issue-create`, the place named in its Description; that skill's own confirmation is where the user says yes. Nothing is posted or filed before the user has seen it.

The count under the line is the regional tier's: name the count, file nothing per place. For Art Museums read the names from the top and stop where a traveller would: a museum is absent because no work it holds is over the works' line, which is one cause and one issue (#628), not one per museum.

### 5. What the surveys expect of proposed kinds

Read the ordering: the kinds the most regions ask for come first. For each of the first ten:

- **It has an issue.** Read the issue's Priority and milestone (`gh issue view <n>`, and the fields as `/feature` § 1 reads them). Where the ordering and the priority disagree, say so and propose the change. Do not change a priority: the report is evidence, and the maintainer decides (ADR-0081 decision 8).
- **It has no issue.** Propose one: a Low Epic with no milestone, in the words of `/issue-create`, its Description opening with the named examples the report gives and the count of regions. File it only when the user says so, then write its number into the kind's `issue` in `kinds.jsonl`.

Say for each kind what a member of it is. A kind of dish, festival or route asks for more than a new sync, because a catalogue record is a place today; say that where it applies.

### 6. Unsorted, and held

- **Not sorted into a kind yet.** File each under a kind of the register, or propose the kind it needs, as `/coverage-survey` § 8 does.
- **In the catalogue and not offered.** A place waiting for a curator is the review queue's; a refused or lost one is named to the user with the reason the catalogue records, since a guide still sends people there.

### 7. Report

Tell the user, in this order: the share offered and what moved since the last report; the defects found, each with its issue; the proposed kinds in the report's order with their issues and any change of priority proposed; what was changed in the list files. Changes to the list files are committed through `/commit`, as data.
