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

For every entry the section names as absent and not judged. Under a kind with a sitelinks line those are the absent entries at or over it. World Heritage and Art Museums have no line, since neither admits a place on its own sitelinks, and the section names every absent entry of theirs, the most named first. Each is judged once, into `db/catalogue-coverage/judgements.jsonl` (ADR-0116; the format and the causes are `docs/tech/catalogue-coverage.md` § `judgements.jsonl`), never into a comment:

- **Offered through another kind.** The entry is filed under two kinds and one holds it. Check that the second filing is one a traveller would make; if it is not, remove it from the list and judge nothing. If it is, and the product's rules give the thing to the kind that offers it (ADR-0102), judge it `offered-elsewhere`.
- **Absent.** Find out why before judging: read the item with the lookup's `facts` (its classes, its coordinates, its sitelinks) and look for the source's refusal in the run's changeset (`experience_sync_changes` by the item's id). Then:
  - the catalogue offers the place it is part of, or the run folded it into one: `part-of-offered`;
  - the list's identifier is the wrong one of two items, a building and the museum inside it: name the other in the entry's `same_as` and judge nothing;
  - a rule that runs today should have admitted it: `rule-defect`, with the issue that owns the rule. Search the open issues (`gh issue list --state open --limit 500 --search "<place or cause>"`); a cause an issue already owns gets the place as a named example in a comment there, and a cause no issue owns gets an issue through `/issue-create`, the place named in its Description. Several places of one cause are one issue, never one each;
  - no rule the product runs would admit it yet, the regional tier or readership: `door-missing`, with that door's issue (#628 for a museum with no work over the works line, #881 for a dig, #1436 for readership);
  - a traveller would look for it under a kind the register has and the product does not: `kind-missing`, the kind named in the note and added to the entry's filing;
  - a visitor misses nothing by the kind not offering it, a commercial gallery, a workshop: `not-a-must`.
- **Held.** A place waiting for a curator is the review queue's and is not judged; one a rule refused is judged like an absent one.

The count under the line is the regional tier's: name the count, judge nothing per place.

Then read the two things the ledger cannot see on its own. The report's section *Judgements whose gap has closed* lists the lines to remove: remove each. And for every issue the ledger names, `gh issue view <n> --json state -q .state`; a judgement whose issue is closed is stale too: the gap is either closed with it, or open again under another cause.

### 5. What a region offers that no guide names

The section *Offered within reach and named by no guide* lists, per region, the offered places no entry names, least known first (#1601). Read each unjudged one as a traveller who knows the region and judge it once into the ledger, by its Wikidata id with `row`, `entry` and `kind` null:

- **A traveller would go, though no guide names it**: `worth-a-visit`. The gap is the guides', not the catalogue's; the row is listed no more.
- **A visitor misses nothing by it**, a stump, a road, a course that runs underground: `not-a-must`. It stays in the panel as a finding until the kind's rule or a curator turns it away.
- **The rule that admitted it should not have**, by what the row's classes and sitelinks say: `rule-defect`, with the issue that owns the rule, found or filed as step 4 does. Several rows of one cause are one issue.

A place with no Wikidata id on the line cannot be judged; say so. A region the maintainer knows on the ground is theirs to read: Berlin and Moscow are, so their lists are put to the maintainer rather than judged here. Then remove the stale row judgements the report lists, as step 4 removes the stale entry ones.

### 6. What the surveys expect of proposed kinds

Read the ordering: the kinds the most regions ask for come first. For each of the first ten:

- **It has an issue.** Read the issue's Priority and milestone (`gh issue view <n>`, and the fields as `/feature` § 1 reads them). Where the ordering and the priority disagree, say so and propose the change. Do not change a priority: the report is evidence, and the maintainer decides (ADR-0081 decision 8).
- **It has no issue.** Propose one: a Low Epic with no milestone, in the words of `/issue-create`, its Description opening with the named examples the report gives and the count of regions. File it only when the user says so, then write its number into the kind's `issue` in `kinds.jsonl`.

Say for each kind what a member of it is. A kind of dish, festival or route asks for more than a new sync, because a catalogue record is a place today; say that where it applies.

### 7. Unsorted, and held

- **Not sorted into a kind yet.** File each under a kind of the register, or propose the kind it needs, as `/coverage-survey` § 9 does.
- **In the catalogue and not offered.** A place waiting for a curator is the review queue's; a refused or lost one is named to the user with the reason the catalogue records, since a guide still sends people there.

### 8. Report

Tell the user, in this order: the share offered and what moved since the last report; the judgements made, by cause, and the defects among them with their issues; what each region offers that no guide names, how many were judged and how many findings stand; the stale judgements removed; the proposed kinds in the report's order with their issues and any change of priority proposed; what was changed in the list files. Changes to the ledger and the list files are committed through `/commit`, as data.
