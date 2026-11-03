# A guide for a bridge in the surroundings tier (2026-11-03)

The question #2324 asked: Bridges & engineering marvels admitted road bridges a traveller only drives
across. On the blind double reading of #2297, 12 of the 20 places graded noise by either reader were
such crossings, and the noise #2297 attributed to the kinds' rules was mostly here (#2255).

**Short answer.** A bridge the surroundings tier admits needs a Wikivoyage edition that uses it, as a
tunnel, a dam or a lock already does, unless a heritage designation (`P1435`) still holds. At the live
point it shows 146 places fewer, cuts judged noise from 6.67 % to 5.00 %, and moves neither the demand
the surveys make nor the canon. The maintainer chose the heritage exception on 2026-11-03.

## The measurement

The 2177 harness (`docs/research/2026-11-02-one-admission-frame-for-the-place-kinds.md` § Method),
copied to `data/cache/2324-bridges/` on the development machine (`bridges2324.py`, output
`bridges2324-2026-11-04.txt`; read first with every non-deprecated designation and again, with the same
figures and the same 20 bridges kept, with only those that still hold, as the rule reads them), at the live point: the density neighbourhood of ADR-0181
(`dr150k20a4`), guide share 0.25, readers share 1.5. Judged noise is read on every reader's grades,
#2297's blind reading among them (`judgements-blind2297.jsonl`, built from its two readers' sheets).

| Variant | Shown | Demand, development | Demand, held out | Canon | Judged noise |
|---|---:|---:|---:|---:|---:|
| a guide for a tunnel, a dam, a lock (before) | 12,653 | 299/451 | 52/129 | 0.8599 | 26/390, 6.67 % |
| a guide for a bridge too | 12,487 | 299/451 | 52/129 | 0.8599 | 19/379, 5.01 % |
| a bridge too, unless a heritage designation holds | 12,507 | 299/451 | 52/129 | 0.8599 | 19/380, 5.00 % |

A guide for every surroundings-tier bridge drops 166 shown bridges. None of them is a canon top, a
demanded entry or a bridge graded worth a visit. Of the graded ones, 7 are noise and 4 of local
interest:
- noise: the Rạch Miễu, Fifth Thai–Lao Friendship, Sunda Strait, Van Stadens, Yachi River, Eko and
  Berbice bridges;
- local interest: the Deer Isle, Helgeland, Rakaia and Siuslaw River bridges.

The rest are mostly long road crossings: the Astoria–Megler and Arthur Ravenel Jr. bridges, the
Saudi–Egypt Causeway, the Malaysia–Singapore Second Link.

## The heritage exception

20 of the 166 carry a heritage designation that still holds. They are sights no survey list or canon
names: the Anping Bridge, a component of Quanzhou's World Heritage property; the Luding Bridge; the
Double Dragon Bridge; the Latidan Bridge; the Kawarau Gorge Suspension Bridge; the Kate Shelley High
Bridge. The exception keeps them at the same noise. The point rule of
the frame (canon at least 85 %, judged noise at most 7 %, then the fewest places) picks the plain
variant by those 20 places, so the metrics cannot tell the two apart: the choice was the maintainer's,
who kept the exception.

## How to rerun

On the development machine, in a copy of the 2177 harness: `cp -a data/cache/2177-admission
data/cache/2324-bridges`, never the original, which another session works in. The script is
`bridges2324.py`, a copy of which lives in `docs/local/research/2324-bridges/`. Its inputs are the
harness's own: `signals/`, `verdicts/`, `regions-split.json`, `point-final.json` and the density
neighbourhood `gradient-nbr-dr150k20a4.tsv` of #2297, plus two files built for this measurement:

```bash
P=~/projects/track-your-regions/cv-python/.venv/bin/python
cd ~/projects/track-your-regions/data/cache/2324-bridges
# The heritage designations that still hold, as the rule reads them (`subsetStandingFacts`):
# a best-ranked P1435 with no end time (P582), one item per line.
docker exec -i tyr-ng-db psql -U postgres -d track_regions -At -c "SELECT DISTINCT c.subject
  FROM workbench.wikidata_claims c
 WHERE c.property = 'P1435' AND c.rank >= 0 AND NOT (COALESCE(c.qualifiers, '{}'::jsonb) ? 'P582')
   AND NOT EXISTS (SELECT 1 FROM workbench.wikidata_claims h
                    WHERE h.subject = c.subject AND h.property = 'P1435' AND h.rank > c.rank)" > heritage.txt
# #2297's blind reading as judgements (judgements-blind2297.jsonl), from the two readers' sheets:
#   kind from blind2297-sample.tsv, grade from blind2297-grades-reader{1,2}.tsv, one line per reader.
export JUDGEMENTS=judgements.jsonl,judgements-maintainer-2026-11-02.jsonl,judgements-sample2-2026-11-02.jsonl,judgements-blind2297.jsonl
flock ~/.cache/tyr-heavy.lock $P bridges2324.py > bridges2324-2026-11-04.txt
```

It prints the three variants' figures, the bridges the plain variant drops (graded ones by grade,
the rest over 20,000 readers), the canon tops among them (none), and the bridges the heritage
exception keeps.

## What this does not show

- The graded sample holds 39 shown bridges; noise per kind rests on few places.
- *Carries* (`P2505`) is not in the subset's claims table, so a bridge's traffic was not read.
- The figures are the harness's replay at the live point, not a run: the next places pass applies the
  rule and its changeset names what it refuses.
