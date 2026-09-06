# The source register

One record per source that has been looked at for filling a kind — so that a search for a
unit, or for a new kind in a unit already searched, starts from what was found rather than
from nothing. The rules that produce a record are
[`docs/tech/filling-a-kind.md`](../tech/filling-a-kind.md) (§ 6); the decision that a source
is a record before it is code is
[ADR-0048](../decisions/0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md)
decision 7.

**This is not the list of sources.** It holds what a search left behind: the worked examples
of the rules' first version, and, from then on, every candidate a kind's issue looks at for a
unit, whatever the outcome. A sync is written *from* a record, never before one exists, and the
record stays as the source's provenance after adoption.

## Layout

```
docs/sources/
├── README.md                ← this file: the schema and the status vocabulary
├── museums/                 ← sources that enumerate museums (of any kind)
│   ├── fr-museofile.md
│   └── …
└── global/                  ← sources that enumerate any kind, read per unit
    ├── wikidata-by-class-per-unit.md
    └── …
```

A directory per *what the source enumerates* — `museums/` for a register of museums, which
serves the art, archaeology and history kinds alike; `public-art/` when the first monument
register arrives; `global/` for the sources that answer for any kind and any unit. A file per
source, named `<country code>-<slug>.md` for a native source and `<slug>.md` for a global one.

## The record

A YAML front matter of fixed shape, then a body of evidence in prose. Every claim in the front
matter is backed by something in the body — a count, a named place, a quoted licence line —
with the date it was taken.

```yaml
---
slug: fr-museofile                      # the file's name without the extension
name: Liste des Musées de France (Muséofile)
publisher: Ministère de la Culture, Service des musées de France
urls:
  home: https://…                       # the source's own page
  dataset: https://…                    # where the data is (a portal page, a file)
  api: https://…                        # an endpoint, if any
  terms: https://…                      # the licence or terms page quoted below
family: registry                        # registry | association | tourism-board | global | commercial | curator
kinds: [art-museums, archaeology-museums, history-museums]   # what it enumerates, by the kind's slug; [any] for a global source that answers for every kind
tier: regional                          # world | regional | none (a source refused before it reached a tier)
unit: { level: country, code: FR, name: France }   # the source's own unit: country | region | city | any (a global source read per unit, or one refused outright)
row:                                    # what one row of the source carries
  identity: "Identifiant Muséofile (M0369)"
  wikidata_link: P539                   # a Wikidata property (P539) linking to this source's id | itself (the source is Wikidata) | tag (a Wikidata tag on the row) | none | unknown
  coordinates: all                      # all | most | some | none | address-only
  languages: [fr]
  signal: "the Musée de France label — an editorial cut by the state"
terms:
  licence: "Licence Ouverte / Open Licence 2.0"
  database_right: waived                # waived (by the licence) | share-alike (waived on the condition a derivative database carries the same licence) | not-asserted | reserved | unknown
  attribution: "Ministère de la Culture, Liste des Musées de France, last updated <date>"
  scraping: not-needed                  # not-needed (an API or a dump exists) | permitted | reserved (a robots signal or terms reserve it: ask first) | forbidden — the detail (which signal, which clause) goes in the body
access:
  mode: dump                            # api | dump | scrape | document
  format: csv
  cadence: "punctual; register updated at least yearly"
  volume: "1,217 rows, 281 kB"
  rate: none                            # a rate limit, or none
scorecard:                              # docs/tech/filling-a-kind.md § 6.2, each 0–2
  date: 2026-09-06
  completeness: 2
  identity: 2
  coordinates: 2
  names: 1
  signal: 1
  terms: 2
  access: 2
  cadence: 1
  total: 13
  verdict: adoptable                    # adoptable | adoptable-with-curator-pass | not-adoptable | veto (terms 0) | curator-list (identity 0) | hold (share-alike unanswered) | provisional (nothing measured; criteria `unknown`)
status: looked-at                       # see below
issue: 799                              # the issue that last moved the record
looked_at: 2026-09-06
---
```

Fields a source does not have are written as `none` or `unknown`, never omitted: an absent
field reads as "not looked at", a `none` as "looked at and not there".

## Status

| Status | Meaning | Who moves it |
|---|---|---|
| `looked-at` | Found and described; the scorecard may be partial and the counts for a unit may be owed | any search (a kind's issue, or the rules' own examples) |
| `evaluated` | The scorecard is complete on the unit's canon of known places, with the misses named | the kind's issue, before adoption |
| `adopted` | A sync reads it; the record names the `experience_categories` row written from it and the issue that adopted it | the kind's issue that shipped the sync |
| `refused` | A terms veto (the verdict `veto`), or a score below the line once `evaluated`, with the reason in the body | the search that found the veto, or the evaluation |
| `expired` | Adopted once; no longer readable or no longer licensed; the sync is off | the issue that switched it off |

The verdict and the status say different things. An identity veto (`curator-list`), a
share-alike `hold`, a `provisional` scorecard and a `not-adoptable` total taken before the
unit's canon was measured all rest at `looked-at`: the verdict is what says the source is not
a sync's input today, and the record stays open because a measurement, a permission or a
merge rule can still change it (Museumsportal Berlin keeps the address to write to; Peru's
national registry is still to be read). `refused` is for what no measurement can rescue — the
terms — and for a score that stayed below the line after the canon was measured.

A record moves forward by an issue and says which in `issue`; the body keeps the history in
order, newest last. A refused record is kept, not deleted — it is what stops the same source
being found again next year with the same surprise.

## What reads the register

Nothing, today. It is files because no code reads it yet; the first sync written from a record
brings the validator of this shape and, if it needs one, the table. Until then the register is
reviewed the way a doc is — in a pull request, by a person — and grepped the way a doc is.
