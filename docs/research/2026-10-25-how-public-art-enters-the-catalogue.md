# How public art could enter the catalogue past its editions line

Research for #1992. It was done on 2026-10-25 on the Wikidata dump of 2026-10-19, the local
Wikidata subset, the readership table of build 24 (months 2025-10 to 2026-09) and the development
catalogue as of that day.

## The question

Public art admits a work when its Wikidata item has at least 22 Wikipedia editions. Most of what a
traveller goes to see as public art falls under that line. Street art falls under it almost
entirely, because a mural or a painted lane has few articles. The calibration list of the kind
(`db/catalogue-coverage/calibration/public-art.jsonl`) has 66 entries since #2029 and #2030, 24 of
them street art. The coverage report of 2026-10-25 says 14 of the 66 are offered. The question has
five parts:

- which signal of fame admits the famous works under the line, and how much else it brings with them;
- whether the run can reach those works through their Wikidata classes at all;
- how a painted wall and its famous panels are held;
- which regional sources could fill the kind or check it;
- what the open cases named on the issue need: the sculpture gardens, the Kelpies, The Thinker,
  and works cast more than once.

## Method

**The pool.** Every item of the Wikidata dump whose class lies in the subclass closure
(`workbench.wikidata_class_closure`) of sculpture (Q860861), statue (Q179700), mural (Q219423),
fountain (Q483453), street art (Q17516), monumental sculpture (Q3476533), group of sculptures
(Q2293362) or sculptural set (Q107338575). There are 854 classes
and 196,140 items. The items were read from the compact records #1977 built
(`data/cache/1977-external-ids/places.jsonl.zst`, a record per item with a coordinate: editions,
classes, country, Atlas Obscura ID and the rest). The run itself follows sculpture one hop only
(`SCULPTURAL_ROOTS` in `backend/src/services/sync/publicArt/classes.ts`), so this pool is an
upper bound. It also holds a few items the run's other rules would refuse: a city gate, a
geographic centre, a museum.

**The signals,** each read per item:

- **A** is an Atlas Obscura place ID (P7772) on the item.
- **B** is a Wikivoyage edition using the item (`wikivoyage.tsv` of #1977).
- **C** is the item's readership. A year's user views are summed over every Wikipedia edition
  from `workbench.readership_months`, and the sum is compared with the pool items at 22 editions
  or more (186 of them): their median, 125,103 views, and their 35th percentile, 87,056. Those
  are the bars of the readership door of ADR-0056, approximated on the pool rather than on the
  kind's admitted works.

**The canon and the cities.** These are the 66 entries of the calibration list, and the 66
entries the 21 reference cities' lists (`db/catalogue-coverage/expectations/`) file under
`public-art`. For the street-art entries that no class reaches, the subset carries no genre
(P136) and no Atlas Obscura ID, so their statements were read live. That was one
`wbgetentities` call for 19 items on 2026-10-25.

The scripts are `pool.py` (the pool from the compact records), `sig.py` (the counts per signal)
and `sample.py` (the samples). They and their outputs are in `data/cache/1992-public-art/` on the
development host. That folder is not tracked; the rerun is described in § How to rerun it.

## The canon against the line

Of the 66 entries, 18 stand at 22 editions or more and 48 stand under the line or have no
item. Street art takes 21 of the 48.

Of those 48, **30 are reachable by the kind's classes** (5 of them street art), and **18 are not
reachable at all** (16 of them street art). The 18 are of two shapes:

- **Wikidata types the place as something other than a work.** It can be a street or lane
  (Q79007): Hosier Lane, Balmy Alley, Clarion Alley, Leake Street, Beco do Batman and Armenian
  Street in George Town. It can be a neighbourhood (Q123705): Wynwood, Cerro Alegre and the Arts
  District of Los Angeles. Or it is a staircase (Escadaria Selarón), a commune (Comuna 13), a
  village project (Djerbahood), a monument (Free Derry Corner) or a building (MaestraPeace on
  the Women's Building). Banksy's Flower Thrower is typed a two-dimensional visual artwork
  (Q110304307), a class under none of the kind's roots. Above the line the same is true of the East Side Gallery (art museum,
  open-air museum), Lennon Wall (wall) and Shoreditch (district).
- **The item has no coordinate of its own:** Robert Indiana's LOVE (8 editions), the Yellow
  Pumpkin of Naoshima (1), the Bushwick Collective (1), and above the line The Thinker (53),
  whose coordinates are on its casts. A group of casts enters the pool through its casts
  (`publicArt/castGroups.ts`, ADR-0145 decision 2b), so The Thinker is reached that way, and
  the open cases say why it is still refused.

A genre statement would let a run find a street-art place whatever it is typed as. Few carry
one. Of the 19 street-art items read live, only three state a genre:

- Clarion Alley and Djerbahood state street art (P136 = Q17516);
- the Flower Thrower states graffiti (Q17514).

The Atlas Obscura ID is the most common mark. It is on 9 of the 19: Escadaria Selarón, Leake
Street, Balmy Alley, Clarion Alley, Lennon Wall, Comuna 13, Beco do Batman, Djerbahood and the
East Side Gallery.

## A signal of fame

This table counts what each signal admits under the line. "Canon" is the 30 reachable entries
under the line. "Pool" is every other pool item with 1 to 21 editions that the signal admits.

| Signal | Canon (of 30) | Pool items with ≥1 edition | Pool items with ≥2 editions |
|---|---|---|---|
| A: Atlas Obscura | 21 | 744 | 510 |
| B: used by Wikivoyage | 18 | 1,736 | 1,155 |
| A or B | 26 | 2,264 | 1,478 |
| C at the median | 2 (the Kelpies, Maman) | 21 | 21 |

At one edition or more, B admits about 1,500 pool items that A does not. Most are statues and fountains a city's
Wikivoyage guide lists as a stop: an Italian war memorial, Piłsudski in Katowice, a Neptune
fountain in France. It adds five canon entries to A. It is a listing, not a cut.

An editions floor under A trades canon for pool:

| A with editions ≥ | Canon (of 30) | Pool |
|---|---|---|
| 1 | 21 | 744 |
| 2 | 18 | 510 |
| 3 | 14 | 371 |
| 5 | 13 | 225 |
| 10 | 8 | 101 |

**What A admits.** A random sample of 40 from the 510 at two editions or more was read. About 24
are sights a traveller would cross a town for:

- land and sound art: the Singing Ringing Tree, Desert Breath, Chillida's Elogio del horizonte;
- famous small works: the Kafka statue in Prague, the Posankka in Turku, the Wall of Love in
  Paris;
- murals: Orozco's Epic of American Civilization, Siqueiros' América Tropical;
- the Pestsäule in Vienna and the Cristo Roto.

About eight are roadside giants, such as Chicken Boy, the Big Trout and Hat 'n Boots. Whether
those belong is a taste call. About eight are not public art, or are an ordinary memorial the
pool's broad classes let in: the geographic centre of the contiguous United States, Traitors'
Gate, the Chicago rat hole, the Hakone Open-Air Museum, a Boy Scout tribute.

The canon entries A admits under the line include:

- the Crown Fountain, Cadillac Ranch, Salvation Mountain and Carhenge;
- Spoonbridge and Cherry, Puppy in Bilbao and the Sun Voyager;
- Mano del Desierto and Floralis Genérica;
- Tuttomondo, Crack Is Wack, We the Youth and Etnias.

Those A misses are Buckingham Fountain, the Chicago Picasso, the Bethesda Fountain, the Spirit of
Detroit, the Archibald Fountain, the Friendship of Peoples fountain, the Fontaine du Trocadéro,
the Grand Cascade of Peterhof and La Joute.

**What C admits.** At the median, the readership door admits 21 pool items under the line, and
most are outdoor sights a traveller knows:

- the Adiyogi statue, Cristo Rei in Almada, Mount Rushmore and the Vessel;
- the Chronicle of Georgia, an equestrian statue of the Duke of Wellington and the Garuda Wisnu
  Kencana Vishnu;
- the Kyffhäuser Monument, Fearless Girl and Gommateshwara;
- Maman and the Kelpies.

Five are indoor works the run already refuses as "inside X": the Veiled Christ, St Peter's
Baldachin, the Hoxne treasure, the Sleeping Hermaphrodite and the Giants of Mont'e Prama. At the
35th percentile, 49 items are admitted. That adds the Hachikō statue, the Statue of Decebalus,
Prada Marfa, the Cretto di Burri, the Tarot Garden, the Bear and the Strawberry Tree and Peter the
Great. **Public art does not open the readership door today.** Only the museum, worship and
archaeology runs call `readershipDoor.ts`, although Public art's curator gate is on.

**Commons photographs** were not measured. The compact records carry no image or category
statement.

## The reference cities

The 21 cities' lists file 66 entries under public art. 53 of them are under the line. Of those
53:

- 9 have no Wikidata item. Among them are eL Seed's Perception in Cairo, Blu's mural on Via del
  Porto Fluviale, the Singing Fountains of Republic Square in Yerevan and the steel portraits of
  Che Guevara and Camilo Cienfuegos in Havana.
- 13 are items no class reaches: Callejón de Hamel, Fusterlandia, Parque John Lennon, the Tsoi
  Wall, Teufelsberg, the Lodhi Art District, Tor Marancia, Quadraro, Newtown, the Monument to
  Pachacuteq, the Espacio Escultórico, the Dique do Tororó and the
  Babajanyan monument.
- 31 are reachable. A or B marks 20 of them. The 11 neither marks include El Caballito and the
  Fuente de Cibeles in Mexico City, Botero's Cat in Yerevan and the Kadıköy bull. Garuda Wisnu
  Kencana is one of them: Bali's entry names the cultural park, and its `same_as`, the statue
  (Q12498977, 15 editions), is a pool item that only C marks.

The cities with the most misses are Havana and Rome (10 each), Mexico City and Yerevan (5 each)
and Sydney (4).

## A wall and its panels

The East Side Gallery is in the catalogue as place 6285. Art Museums refuses it, because it is "a
stretch of the Berlin Wall that Wikidata types art museum". No kind offers it. It holds one
work, Vrubel's *My God, Help Me to Survive This Deadly Love* (Q2410932, typed mural, genre street
art). That is why #1444 names the panel as a loss. On Wikidata the wall item lists three panels as
its parts (P527).

The catalogue already has two models for a thing inside a thing:

- **A venue and its works** (`experience_treasures`). The work is shown on the venue's card,
  and a visit is to the venue. This is how Nefertiti is held at the Neues Museum.
- **A whole and its parts** (ADR-0100). Each part is a place with its own point, pin and
  visit, gathered by the whole's card. It was built for the components of a serial World
  Heritage site, which stand kilometres apart and are visited one by one.

On the ground the wall is 1.3 km long. A visitor walks it end to end, and the Fraternal Kiss is
one stop on that walk, about 100 m from the east end. Hosier Lane, Clarion Alley, the Lennon Wall
and Wynwood share that shape: the place is the walk, and its famous murals are what one stops in
front of.

## Regional sources

| Source | What it enumerates | Terms for a program | Verdict |
|---|---|---|---|
| Street Art Cities ([record](../sources/global/street-art-cities.md)) | Street artworks hunted by its users, per city, with coordinates and artists; monthly CSV/JSON per country | open data for academics only: "It is not allowed to use this data set to redistribute or integrate in any non-academic context" | veto |
| Bildhauerei in Berlin ([record](../sources/public-art/de-bildhauerei-in-berlin.md)) | 3,267 sculptures in Berlin's public space, with coordinates, artist and date, kept by HTW Berlin | no licence for the data; the photographs are CC BY 4.0 | not adoptable |
| City of Sydney | the City Art collection, said to be over 250 works | the council's site bars automated access (refused in `site-access.md`); its data hub holds no public-art dataset that a search found | none |

A register of a city's sculpture enumerates what the city owns and maintains, thousands of works,
with no cut of fame. The misses on the cities' lists are mostly street-art places and private
creations: Callejón de Hamel, Fusterlandia, Teufelsberg, RAW-Gelände. A council register does not
hold those. Of Berlin's three entries under the line, the RAW-Gelände and Teufelsberg are outside
Bildhauerei in Berlin's scope. Whether it holds the World Clock was not checked.

## The open cases

- **Sculpture gardens.** The run refuses the Vigeland installation (28 editions), the Gardens of
  Bomarzo (25) and the Rock Garden of Chandigarh (17) as "not public art: sculpture garden".
  Each is one artist's single work, and the calibration list's notes say so. A garden that
  gathers many artists' works, such as Storm King or the Hakone Open-Air Museum, is a
  collection. Both shapes are typed sculpture garden.
- **The Kelpies** (17 editions) are place 1610. Public art refuses them on the line.
  Monuments & memorials refuses them for "no monument or memorial class". So they are on no
  card. Signals A and C both admit them.
- **The Thinker** (Q18003128, 53 editions) is a group of casts with no coordinate of its own,
  and it enters the pool through its casts (ADR-0145 decision 2b, `publicArt/castGroups.ts`).
  The last run refused it as "inside Musée Rodin". The refusal follows what Wikidata states. The
  group's own location statements name the Musée Rodin, the Strasbourg Museum of Modern and
  Contemporary Art and Buenos Aires, and the nearest museum among them makes it a museum's
  work. The one cast with an item of its own in the subset stands at the Kyoto National Museum.
  On the ground the Paris cast is in the museum's garden, seen on a museum ticket. The casts a
  passer-by sees for free, such as the one on the Plaza del Congreso in Buenos Aires, have no
  item with a coordinate. A cast item would not change the verdict either. The verdict reads the
  group's own containers (`heldElsewhere` in `publicArt/publicArtTest.ts`). A cast's placements
  only name the cast, and `attachCasts` adds its point and classes but no containers. So an
  edition whose casts stand in a museum and outdoors is refused on the group's first museum.
  ADR-0145 makes it one place with a point at every cast, and a rule is missing for its verdict:
  judge each cast where it stands, and refuse the group only when every cast is held. Under that
  rule The Thinker stays refused today, because its one cast item is a museum's. It is offered
  once Wikidata holds a public cast as an item. LOVE's item has no coordinate, and the subset
  holds no cast of it.
- **Which item a work with many casts takes** is decided: the edition's item (ADR-0145). The
  calibration list already names The Thinker and Maman by their edition items.

## What it led to

- #2033: Public art opens the readership door, which admits the Kelpies and *Maman*.
- #2034: a door for the works Atlas Obscura lists, at a floor the maintainer chooses on the
  count it sends to the review queue.
- #2035: a street-art place is offered with its murals as its works, the East Side Gallery first.
- #2036: an edition is judged at each of its casts, and refused only when every cast is held.
- #2037: a sculpture garden made as one artist's work is offered.

Districts known for street art (Wynwood, Shoreditch) are left to the proposed Neighbourhoods &
districts kind.

## How to rerun it

On the development host, from `data/cache/1992-public-art/`:

1. Write the closure:

   ```sql
   SELECT class FROM workbench.wikidata_class_closure
   WHERE ancestor IN ('Q860861','Q179700','Q219423','Q483453','Q17516','Q3476533','Q2293362','Q107338575')
   ```

   to `closure.tsv`.
2. Build the pool:

   ```sh
   zstdcat ../1977-external-ids/places.jsonl.zst | python3 pool.py - closure.tsv ../1977-external-ids/wikivoyage.tsv pool.tsv
   ```

3. Write the readership: sum `views` from `workbench.readership_months` per item over the sites
   ending in `wiki`, leaving out commons, species, meta and wikidata, into `readership.tsv`.
4. Run `python3 sig.py` and `python3 sample.py` beside a copy of the calibration list
   (`public-art.jsonl`). `city-pa.jsonl` holds the cities' public-art entries the § The reference
   cities counts read.

## What this does not show

- **The pool is wider than the run.** The run follows sculpture one hop and refuses buildings,
  museums and works indoors, so every pool count is an upper bound. The counts on the run's own
  gather are smaller.
- **The readership bars are approximations.** They are taken on the pool items at 22 editions,
  not on the works the kind admits. They also omit the ~6,000 pool items with one edition and no
  readership row.
- **The sample is small.** The judgements on the sample of 40 are one reader's, and the sample's
  proportions are rough.
- **Regional sources were looked at for three cities only,** Berlin, Sydney and the street-art
  directory. Rome's and Mexico City's portals were searched without a public-art dataset found.
