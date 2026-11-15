# The venue share for streets read along their lines (2026-11-15)

Squares & streets lets a street in when the cafés, restaurants and bars around it reach a share of
the median of the ten liveliest places of the kind within 150 km (`venueShare` in
`SURROUNDINGS_REGISTER`, ADR-0192). The half was measured on the count within 200 m of a point
([2026-11-10](2026-11-10-a-walked-street-read-from-the-venues-around-it.md)). Since ADR-0194 a street
whose lines the OpenStreetMap layer keeps is read in venues per 100 m of its lines, against the
streets read the same way, and the share came over unchanged. This report derives it on that
reading, by the four steps of `docs/tech/filling-a-kind.md` § 11.3 (#2450).

## The question

In the densest cores the ten liveliest lined streets set a high reference, and walked streets fall
under half of it: Berwick Street in Soho reads 5.6 venues per 100 m against 14.3, Passage Jouffroy
6.2 against 19.4, Krystalgade 4.7 against 10.0. A lower share lets them in. The question is whether
it does so at a cost the frame accepts.

## The runs

Three one-kind dry runs (*Preview Squares & streets alone*) on the development catalogue, the same
builds and admitted rows, differing only in the line share. The point share stayed at a half in all
three.

| Line share | Run | Head | Created | Surroundings tier admitted |
|---:|---:|---|---:|---:|
| 0.5 | 987 | main f40da71b5 | 0 | 947 |
| 0.4 | 988 | f40da71b5 with the line share at 0.4 | 62 | 1,010 |
| 0.33 | 989 | f40da71b5 with the line share at 0.33 | 111 | 1,059 |

No place admitted at a half was lost at either lower share; each lower share only adds. The
one-kind run read the gather it kept from the first and remade the pool, about 25 minutes each.

## The frozen metrics

The admitted set of each run (the 1,746 places the kind admits today, plus the run's arrivals)
was read by the frozen metrics of the admission frame (#2177) on the development regions:

| Line share | Survey recall | Outside Europe and Oceania | Canon | Judged noise (V / L / N) | Admitted |
|---:|---:|---:|---:|---|---:|
| 0.5 | 66 of 94 | 31 of 47 | 73 of 85 (86 %) | 5 / 10 / 0 | 1,746 |
| 0.4 | 66 of 94 | 31 of 47 | 73 of 85 (86 %) | 5 / 10 / 0 | 1,808 |
| 0.33 | 66 of 94 | 31 of 47 | 73 of 85 (86 %) | 5 / 10 / 0 | 1,857 |

No street a survey of the development regions expects, and no top of the kind's canon, is among
the arrivals at either share. The judged sample holds none of them either, so its noise does not
move.

## What the added streets are

Read as a traveller, place by place:

- **At 0.4, 62 more.** About two thirds are streets walked for their life: Briggate, Buchanan
  Street, Calle de Fuencarral, Galerie Colbert and Passage Verdeau, Passage Brady, Krystalgade,
  Lee Tung Street, Limmatquai, Keupstraße, Hohe Straße, Grimmaische Straße, Rue Oberkampf, Shubert
  Alley, St Martin's Lane, Dean Street, Petrovka. About a third (21) are business and traffic
  streets: Fulton, Montgomery, Cortlandt and Pearl Streets, California Street, George Street in
  Sydney, Avenida Córdoba, Zagorodny prospekt, Solyanka.
- **From 0.4 to 0.33, 49 more.** Fewer than three in five are walked: Berwick Street, King's
  Parade, Elm Hill, Steep Hill, Stoleshnikov Lane, Sicilian Avenue, Rue Mazarine, Knutsford Terrace.
  The rest (21) are arteries and ordinary streets: Park Avenue, Via Laietana, Lindwurmstraße,
  Dachauer Straße, Shaul Hamelech Boulevard, Rue Saint-Lazare.

Of the traveller's labels the #2311 measurement kept (115 walked and 87 ordinary streets), 0.4
adds 4 walked and 4 ordinary, and 0.33 one walked more.

## The frontier

Over the three candidates the survey recall, the canon and the share outside Europe stand still,
and the load grows by 62 and then 111 places. The candidates are dominated in every frozen figure
by the half: they cost places and buy no figure the frame reads.

## The point

The maintainer's rule of 2026-11-02 asks for the canon at 85 % or more and the judged noise at
7 % or less, and of those the fewest places. All three meet the first two, so the rule chooses
the half, the fewest places at the same figures. The line share is therefore the point share, now
derived on lines rather than carried over: `venueShare` holds 0.5 for both readings, and the
register needs no value of its own for the lines.

## The control group

§ 11.3 adopts a change only if a control group no tuning has read improves. No change is adopted
here, so the control group of the test regions was not read and is not spent.

## Where the measurement stops

- The frozen surveys of the development regions name few streets in the dense cores where the
  lower shares act (Sydney expects 8 places of the kind and the catalogue holds 1 at every share).
  A walked street like Krystalgade or Passage Brady counts in no frozen figure, which is why the
  frontier cannot see what a traveller sees in the lists above. A survey that lists the walked
  streets of London, Paris, New York or Hong Kong would let the next derivation weigh them.
- About a third of what a lower share adds is traffic and business streets, which the venue count
  alone does not tell from walked ones. The artery rule (ADR-0194) catches a street whose every
  line is a road for through traffic, and Park Avenue or Via Laietana are not caught by it.
- A share trial remakes the pool, about 25 minutes per candidate on the development machine,
  because the pool is keyed by its own code and the register is part of it (ADR-0209).

## How to rerun

On the development machine:

1. Deploy a head whose `venueShare` (or a line share split from it) holds the candidate, and press
   *Preview Squares & streets alone* on the pass's card; note the run id.
2. Read the run's arrivals and the kind's admitted places, read-only:

   ```sql
   SELECT external_id FROM source_records
   WHERE kind_id = 9 AND admission = 'admitted' AND missing_since IS NULL;
   SELECT external_id FROM experience_sync_changes
   WHERE sync_log_id = <run> AND change_type = 'created';
   ```

3. Write `{"squares": {"<qid>": "<tier>", …}}` with both sets, and read it with the frame's
   metrics in `data/cache/2177-admission/`:

   ```bash
   ../../../cv-python/.venv/bin/python metrics.py adm-<share>.json --split dev --out sq2450-<share>.json
   ```

The admitted sets and reports of this derivation are kept there as `adm-050.json`, `adm-040.json`,
`adm-033.json` and `sq2450-*.json`; the traveller's labels are `data/cache/2311-streets/dry/labels_mine.py`.
