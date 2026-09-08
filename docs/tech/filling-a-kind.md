# Filling a kind: two tiers, and how a source is found, judged and kept

The rules by which a kind of place is filled — which sources, chosen how — so that the next
kind (regional art museums, #628; archaeology and history museums, #581; the public art a
country holds below the world's line) is filled by applying them rather than by answering the
question again. The decisions that bind are
[ADR-0048](../decisions/0048-a-kind-is-filled-in-two-tiers-each-from-its-own-kind-of-source.md);
everything else here — the scorecard, the search procedure, the verdicts — is a **best effort
written before any regional source was adopted, and is expected to be revised** when the first
kinds and units are worked (§ What revises these rules). What a source *is* and what a *kind*
is are the glossary of [experiences.md](experiences.md#glossary) (ADR-0045).

Nothing here adopts a source. Adopting one is the issue of the kind it fills, applying these
rules and leaving a record in the [source register](../sources/README.md).

---

## 1. The two tiers

A kind is filled in two tiers, always both, in this order.

**The world tier** is what the world knows of the kind: a global source ranks the whole world
on one signal and a line is drawn across it. World Heritage is the UNESCO list itself — the
list *is* the tier; art museums are the venues holding a work at 22 Wikipedia-language
sitelinks or more (works-first, [ADR-0023](../decisions/0023-works-first-museum-selection.md));
public art is the sculptures and monuments above the same line — ADR-0023's, reused by #754
([experiences.md § Public Art](experiences.md#public-art--monuments-landmarksyncservicets-publicartts)). The
world tier carries the **Iconic** badge — the badge is the world tier of a kind, and nothing
else awards it ([ADR-0045](../decisions/0045-a-traveller-browses-by-kind-a-source-is-how-a-kind-is-filled.md)
decision 5). What the line leaves out is not a defect of the line: it is the next tier's job.

**The regional tier** completes the kind with what a region holds that a traveller standing
there would visit — "the iconic art museums *and some other art museums worth your time*", in
the vision's words. It comes from sources native to the region: a ministry's register, a
museum association's directory, a city's own list, a curator who has been there. It carries no
badge. Its **unit** is the source's own — a national register covers a country, a city list a
city — never a world-view region: the catalogue places each place into world-view regions by
coordinates afterwards, as it does today, so a country register fills every region that country
overlaps, and a region has a regional tier the moment any source covering it is adopted.

**How a reader sees them.** A region's list of a kind is its world-tier places and its
regional-tier places together, one list, the world tier's rows badged. Counts count both
(ADR-0046 decision 8: a kind counts memberships, a region counts places). Nothing on a card
says which tier brought a place except the badge.

**How the tiers meet.** A regional source that names a place already in the world tier names
*the same place* (ADR-0046: identity is ours; an equal Wikidata item merges without a
question, coordinates plus a name propose a merge for a curator). The place keeps its badge,
gains a second membership only if the second source fills a *different* kind, and counts once
per kind. So the Uffizi is not "in the regional tier too": it is in the art-museums kind,
badged, and Italy's register listing it changes nothing but the provenance recorded on its
membership.

**What complete means, per tier.** ADR-0045 decision 2 asks every kind for a rule of
completeness before it is shown; this doc narrows it to *one rule per tier*. The world tier is
complete when the ranking's own rule has been applied to the whole world — every venue holding
a work above the line, every item above the line in the classes the source reads — however many
that turns out to be (ADR-0023 decision 3: no cap). The regional tier is complete **per unit**:
the source's enumeration of the unit has been read whole, and the cut has been applied to it.
A unit with no adopted source has no regional tier, which the product says as "we do not cover
this yet" — never as an empty list pretending to be a full one.

**Enumeration first, cut second, never a world rank.** A regional source *enumerates* — every
museum the ministry recognises, every listing in the city guide — and the tier's rule then cuts
*within the unit* to what is worth a traveller's time: by the source's own editorial judgement
where it has one (the *Musée de France* label; Poland's state register, which admits only a
museum "of high merit"; a guide's See list), or by a within-unit signal (local-language
readership, visitors, a percentile of sitelinks within the unit) where the source has none,
with a floor on the group's size so that a unit with five museums does not make the fifth a
100th percentile. What the regional tier never does is rank the world and cut lower: a lower
line on the world signal is the rejected alternative of ADR-0023 and the mismeasurement #759
was closed for — it reaches the museums Wikipedia writes about, not the ones a region holds.
A curator may add to and remove from the cut.

**A curator is a source.** A curator's list for a unit is a source of the regional tier — or of
the world tier, where the curator says the place belongs there — judged by the same scorecard
as any other (identity, coordinates, a Wikidata item where one exists), and it is how a unit
with no native source gets filled at all. A curator may place an object in either tier and set
or clear the badge; the model has two tiers and one badge, and "top" is the world tier, not a
third status. The vision's "curators can promote or demote Iconic" is this sentence.

---

## 2. What a world-tier source must provide

- **One signal comparable across the world.** Sitelinks are one: a count that means the same
  thing for a museum in Lima and one in Paris. Visitor numbers are not — present on the Louvre
  and on none of the six regional museums measured on 2026-09-04 — and a composite that reads
  a missing datum as zero gates on documentation, not fame (ADR-0023's rejected alternative).
- **Identity**: a stable id per place, and a Wikidata item where one exists, since the world
  tier is what a regional source will later meet.
- **Coordinates**, or a way to find them (the works-first source finds a venue's from the venue's
  own item).
- **The cut**: a threshold on the signal (22 sitelinks) or a count (the top N), stated once and
  applied to the whole world. A threshold is preferred: it is a property of the data and moves
  only when the data does; a count is a quota that pads or trims.
- **Terms** that permit storing what is read and showing it (§ 5). Wikidata is CC0; the UNESCO
  list is read through its own API and its photographs are never shown (ADR-0043).

The two live world-tier sources answer these as ADR-0023 and #754 record (the public-art line
is the museums' own, reused); the UNESCO list is the degenerate case in which the source's own membership is the tier and the only signal is
"inscribed".

## 3. What a regional-tier source must provide

- **An enumeration of the kind for its unit** — every place of that kind the unit holds, or a
  stated subset ("state museums", "registered museums", "worth seeing") whose rule is written
  down by the source. A world ranking read for one country is not an enumeration: Wikidata's
  museums-with-22-sitelinks in Peru number 0 and in Estonia 5, measured 2026-09-06 (§ 7), and
  neither number is what those countries hold.
- **A stable identity per place** — an id the source keeps between editions — and a **Wikidata
  item** where one exists, because that is how the regional row is recognised as the world-tier
  place it may already be (ADR-0046 decision 2). A source with neither is a source whose rows a
  curator confirms one by one.
- **Coordinates**, or an address precise enough to geocode; the catalogue places by coordinates.
- **Names in the unit's languages** — a museum in Tartu has an Estonian name before an English
  one, and a reader in Estonia reads it. (#809 is where a region learns which languages its
  public reads.)
- **A signal of significance within the unit, or an editorial judgement** — a category, a label,
  a visitor count, a "state museum" flag, or the fact of being listed by a guide that lists what
  is worth seeing. Without either the cut has to come from elsewhere (§ 4, the fallback).
- **Terms** that permit reading the list, storing what it says and showing it with attribution
  (§ 5), and an **access mode** the catalogue can pay for (§ 6.2).

## 4. Which kind of source each tier prefers, and why

**The world tier prefers a global source; the regional tier prefers a source native to its
unit.** The reason is the signal: a world tier needs a signal that means the same everywhere,
and only a global source has one; a regional tier needs to know what the unit *holds*, and only
something native to the unit — a ministry, an association, a guide written for the region, a
person who lives there — knows that. Wikidata knows 30 museums in Lima and 32 in Tbilisi
(2026-09-06); Peru's ministry alone administers 56; Wikipedia's own list for Tbilisi has some
90 rows. The global source is the yardstick a regional source is measured against, not the
regional source.

**The exception, named: a global source read per unit.** Where no native source exists, or none
can be read (terms, access, a register the law establishes but nobody publishes — Georgia,
§ 7), a global source read *for the unit* is a regional-tier candidate: Wikidata by class
within the unit, ranked by a within-unit signal (local-language readership as measured on
2026-09-04, or a percentile of sitelinks within the unit, #761); Wikivoyage's See listings for
the unit's articles; OpenStreetMap's `tourism=museum` objects as the enumeration. It is enough
when three things hold, each measured before adoption: (1) **coverage** — the canon of places a
person who knows the unit names (its national museum, its art museum, the house museum every
guide mentions) is found, with the misses listed; (2) **identity** — the share of rows with a
Wikidata item is known and the rest go through the gate as proposals; (3) **a floor** — the
group is large enough for a within-unit cut to mean something, and where it is not, the whole
enumeration is offered and a curator cuts. A global source read per unit is adopted *for that
unit*, recorded as such in the register, and replaced when a native source arrives.

---

## 5. Terms of use

Reading a list and showing what it says are two different permissions, and both are needed.

- **Licence to store and show.** Open licences with attribution are the rule: Licence Ouverte
  2.0 (France: free reuse including commercial, modification and redistribution; attribution
  names the grantor and the date of the last update; compatible with CC BY and ODC-BY), CC BY
  (Italy's cultural-places data, CC BY 3.0), CC0 (Poland's state register on dane.gov.pl;
  Wikidata), CC BY-SA (Wikivoyage's text, 3.0), ODbL (OpenStreetMap). A licence that forbids
  storage, combination with other data, or display outside the provider's own surface is a
  **veto** whatever the coverage: Google Places (Maps Platform Terms § 3.2.3 — no Places
  content on a non-Google map, no point-in-polygon use of its coordinates, no caching beyond the
  place id) and Tripadvisor's Content API (Master Terms § 3.4.3 caching only per its policy,
  which permits caching nothing but the location id; § 3.4.4(iv) no commingling with third-party
  content; § 3.5.2(c) no transforming; § 3.1.2 display to end users only; § 3.1.3 no model
  training) are excluded for both tiers and for curator screens alike.
- **Share-alike.** ODbL and CC BY-SA bind a *derivative database* to the same licence. Storing
  OSM's museum rows beside rows from a CC BY register makes a derivative database whose ODbL
  obligations reach the whole; ADR-0002 noted the same for boundaries. Reading OSM to *find*
  and *count* (a yardstick, § 6.1) binds nothing; adopting it as a source of rows is a decision
  that has to answer the share-alike question first.
- **Database right.** In the EU a database's maker has a right of its own, apart from copyright
  (Directive 96/9/EC, article 7): extracting or re-utilising a substantial part of a database
  needs a licence even where no single entry is copyrighted. A ministry's register under an
  open licence has waived it; a tourism board's or a publisher's list has not, and scraping a
  substantial part of it — every museum it lists — is extraction. The text-and-data-mining
  exception (Directive 2019/790, article 4) covers lawfully accessible content unless the holder
  has reserved it in a machine-readable way, which is what a `robots.txt` content signal is:
  Museumsportal Berlin's reads `Content-Signal: search=yes,ai-train=no,use=reference` and
  disallows a dozen crawlers by name (2026-09-06). A reservation like that is read as "ask first".
- **Attribution** is carried per source, in the wording the licence asks for, and shown where
  the source's rows are shown — the same rule as a picture's credit (ADR-0043): the register
  record holds the attribution sentence.
- **Pictures are Commons only**, whatever the source says about its own photographs
  (ADR-0043). A source's picture URL is not stored; the picture, if any, is found on Commons
  through the place's Wikidata item.
- **Scraping** is the access mode of last resort (§ 6.2): it needs the terms and the robots
  signals to permit it, a stable page shape, and a rate the site's own guidance allows.

## 6. Finding and judging a source

### 6.1 The search, per (kind, unit)

Run afresh for every new kind and every unit, and every hit written into the register (§ 6.3)
whatever its outcome, so the next search for the same unit starts from records rather than from
nothing.

1. **Take the yardstick first**: how many places of the kind the unit holds according to the
   global sources — Wikidata by class within the unit (the query in § 8), OpenStreetMap's
   count, the national statistics office's figure where it publishes one (Statistics Estonia:
   160 museums in 2024). The three disagree, and the disagreement is the first thing learned:
   Estonia is 46 museum items with a Wikidata location chain to the country, 346 by `country`,
   350 objects on OSM, 160 by the statistics office.
2. **Look for a native enumerator, in this order**: the law — most countries' museum acts
   establish a register (France's Code du patrimoine, Poland's *ustawa o muzeach*, Georgia's
   law *On Museums*), and the register is the first candidate whether or not it is published;
   the ministry's open-data portal (data.gouv.fr, dane.gov.pl, dati.cultura.gov.it,
   datosabiertos.gob.pe, stat.ee); the national museum association or council's directory; the
   national or city tourism board's list; then a regional guide.
3. **For each candidate, fill a register record** (§ 6.3) with what is measured: the count for
   the unit, the fields a row carries, the terms, the access mode, and the scorecard with its
   evidence — named places, not adjectives.
4. **Stop** when a native enumerator scores as adoptable (§ 6.2), or when the candidates are
   exhausted: then declare the global-read-per-unit fallback for the unit (§ 4) and record that
   too, so the unit is not searched again until something changes.

### 6.2 The scorecard

Each criterion scores 0, 1 or 2 with the evidence the record has to show. The weights are
deliberately flat; the vetoes are what decides.

| Criterion | 0 | 1 | 2 | Evidence |
|---|---|---|---|---|
| **Completeness** for the unit | enumerates something else (a world rank read locally; the state's own museums only) | the kind, with known gaps | the kind whole, or a stated subset with its rule written | the unit's canon of known places, found and missed by name |
| **Identity** | none stable | an id of its own | an id of its own and a Wikidata item on most rows | the id's shape; the share of rows with an item |
| **Coordinates** | none, and no geocodable address | an address | coordinates on every row | the share with coordinates |
| **Names** | none in the unit's languages | one language | the unit's languages | a row |
| **Signal** | none | an editorial cut (a label, a category, being listed) | a measured within-unit signal (visitors, readership) | what the cut would be for the unit |
| **Terms** | forbids storing, combining or showing — **veto** | permits with obligations (share-alike, no derived database, ask first) | open with attribution | the licence page, quoted |
| **Access mode** | documents only, by hand | scraping, or documents read with a model | an API or a dump | the endpoint or file; the volume and rate |
| **Cadence** | unknown, or older than two years | yearly or irregular | monthly or continuous | the last update and the stated frequency |

**Vetoes**: Terms 0 excludes the source outright — the verdict is `veto`; Identity 0 excludes
it as a *source* and leaves it as a *list a curator reads* — the verdict is `curator-list`,
whatever the total. **Hold**: a source whose terms score 1 *because of share-alike* (ODbL;
CC BY-SA on what would be copied) is `hold`, whatever its total, until the catalogue has
answered what a derivative database would bind (§ 5). **Provisional**: a scorecard filled from
the publisher's own description with nothing measured is `provisional` — its unmeasured
criteria are written `unknown`, and it adopts nothing. With none of those: **adoptable** at 11
of 16 or more; **adoptable with a curator's pass over every row** at 8–10; **not adoptable**
below 8. These lines are the first guess and are revised by the first adoptions (§ 9).

**Access mode, in more detail**, because it is where the cost lives and where the gate is
involved:

- **API or dump** (Muséofile's CSV; dane.gov.pl's spreadsheet; a SPARQL endpoint): a sync
  reads it the way the live sources read theirs, cached per source (ADR-0030,
  ADR-0047); the cheapest to build and the only mode that runs unattended.
- **Scraping** (a portal listing 205 museums over nine pages): needs terms and robots signals
  that permit it, a page shape a parser can hold on to, and a rate inside the site's guidance;
  brittle, and every change of the site is a run that reads nothing. What a scraper reads
  enters through the gate as a proposal (ADR-0025) rather than a direct write.
- **Documents read with a model** (a PDF register, a scanned annual list, a guide's chapter): a
  model extracts rows — name, address, what the source says about the place — and every row is
  a **proposal a curator confirms** through the same gate; the extraction is recorded with the
  document's identity (URL or file, its date) so it can be re-run and compared. Never a direct
  write, because a model's reading of a scan is a claim about the world with no one standing
  behind it until a curator does. Effort per row is the highest of the three, and it is the mode
  that reaches sources nothing else reaches.

### 6.3 The source register

What a candidate becomes once it has been looked at — so that a search for the same unit, or
for a new kind in a unit already searched, starts from what was found. **A source is a record
before it is code** (ADR-0048 decision 7): a sync is written from the record, and the record
stays as the source's provenance.

The register lives in [`docs/sources/`](../sources/README.md) — one file per source, a YAML
front matter of fixed shape and a body of evidence, grouped by the kind it enumerates. The
shape, in short: what the source is (slug, publisher, URLs), the kinds it enumerates and the
tier, the unit (level and code), what a row carries (identity, Wikidata link, coordinates,
languages, signal), the terms (licence, database right, the attribution sentence, whether
scraping is permitted), the access mode and cadence, the scorecard with its evidence and date,
a **status** — `looked-at`, `evaluated`, `adopted`, `refused`, `expired` — and the issue that
moved it. The full schema and the status vocabulary are the register's README. It is files
rather than a table because nothing reads it yet; the first sync that does brings the validator
and, if it needs one, the table.

The register **is not the list of sources**. It starts with the worked examples of § 7 so
the shape is proven, and each kind's own issue fills it for the units it works.

---

## 7. Source families, and the rules tried once on the canon

A verdict per family and per tier, each grounded in a source looked at on 2026-09-06 for a
unit of the canon — Florence, Paris, Berlin, Kraków, Lima, Tbilisi, and Estonia (Tallinn and
Tartu), the country added because it has a strong local-language Wikipedia and no museum in
the world tier. The numbers are the day's; the queries are in § 8. This is a smoke test of the
rules — enough to show they decide something — not the evaluation that adopts a source, which
is #628's.

**The yardstick** (Wikidata, any museum class, located in the unit; OSM `tourism=museum` inside
the unit's boundary; Wikivoyage See listings of the unit's main article):

| Unit | Wikidata museums (with coordinates) | of them art museums | sitelinks ≥ 22 / ≥ 10 | OSM museums (with a Wikidata tag) | Wikivoyage See listings (with `wikidata=`) |
|---|---|---|---|---|---|
| Paris | 236 (220) | 63 | 30 / 71 | 146 (120) | 29 (1) on the city article, split into districts |
| Florence | 162 (137) | 50 | 17 / 35 | 110 (73) | 30 (30) |
| Berlin | 233 (214) | 39 | 25 / 58 | 247 (144) | 71 (63) on *Berlin/Mitte* |
| Kraków | 116 (116) | 31 | 3 / 13 | 89 (51) | 43 (0) on *Kraków/Old Town* |
| Lima | 30 (28) | 3 | 0 / 4 | 109 (35) in the metropolitan box | 99 (30) on *Lima/Central Lima* |
| Tbilisi | 32 (30) | 3 | 2 / 9 | 43 (25) | 54 (36) |
| Estonia | 346 by country (43); 46 by location chain | 1 | 5 / 22 | 350 (104) | Tallinn 36 (4), Tartu 28 (5) |
| Peru, by country | 187 (157) | 18 | 0 / 4 | — | — |
| Georgia, by country | 124 (82) | 9 | 5 / 16 | — | — |
| Poland, by country | 1,792 (1,769) | 185 | 14 / 64 | — | — |

Two things the yardstick already shows. A Wikidata *location chain* to the unit is not
guaranteed — Tallinn counts one museum through `located in the administrative territorial
entity` because Kumu (Q919611, 30 sitelinks) and its neighbours point at a second item
labelled "Tallinn" (Q4450503) that is not the city's item (Q1770) — so a country is read by
`country` (P17) and a city by coordinates inside its boundary, never by the chain alone. And the world
tier's line reaches almost nothing below Paris: 0 museums at 22 sitelinks in Lima, 2 in
Tbilisi, 3 in Kraków, 5 in all of Estonia — which is the case for the regional tier in one row.

### 7.1 National and regional registers — the regional tier's first choice

**France — *Liste des Musées de France* (Muséofile).** Ministère de la Culture; Licence
Ouverte 2.0; 1,217 rows, every one with latitude and longitude, 1,132 with a website; an id of
its own (`M0369`, musée de Montmartre), which Wikidata links as property P539 on 1,363 items;
Paris (département) holds 50 rows; the CSV is 281 kB, dated 2025-08-27, updated "punctually"
(the register itself at least yearly). The list is the *appellation* — a museum has applied
for and been granted the label under the Code du patrimoine — so the source carries its own
editorial cut. The list CSV has no theme column; the Muséofile base behind it has the thematic
domains, which is what tells an art museum from a history museum. **Scorecard**: completeness 2
(the labelled museums, with the rule written), identity 2, coordinates 2, names 1 (French),
signal 1 (the label), terms 2, access 2, cadence 1 — **13, adoptable**. On Wikidata 70 of
Paris's 236 museums carry the Muséofile id, so most rows will meet the world tier by an equal
item and the rest by coordinates and name. Verdict: world tier — no (no world signal); regional
tier — **yes**, the shape every other register is measured against.

**Poland — *Państwowy Rejestr Muzeów*.** Ministry of Culture and National Heritage, via
dane.gov.pl; CC0 1.0; a spreadsheet (xlsx, 2026-01-16) of 135 registered museums, 12 of them
since struck off; columns: name, postal code, town, street, organiser, dates of entry and
removal — no coordinates, no id but a running number, no Wikidata. Registration is a quality
mark ("a high level of merit … collections of significance for Polish culture"), so the source
*is* an editorial cut, and a narrow one: Kraków has 9 rows — the National Museum, Wawel, the
city's history museum, the archaeological, aviation, ethnographic and photography museums,
the Jagiellonian University museum, Manggha — against 116 museums on Wikidata and 89 on OSM,
of which 51 carry a Wikidata tag. **Scorecard**: completeness 2 (a stated subset with its
rule), identity 1, coordinates 1 (addresses), names 1, signal 1, terms 2, access 2, cadence 1 —
**11, adoptable**, with the identity work (matching 135 names to Wikidata items, which OSM's
tags already do for five of Kraków's nine) done once. Verdict: regional tier — **yes, as the
cut**; the wider enumeration (the ministry's second list of museums with agreed statutes, and
NIM's museum database) is the next candidate for the units the register leaves thin.

**Italy — *Luoghi della cultura* (Cultural-ON DBUnico 2.0).** Ministero della Cultura; CC BY
3.0; 6,603 visitable cultural sites — museums, libraries, archives, archaeological areas — in
eleven macro-categories, with address, province, coordinates, description and the supervising
authority, updated monthly through SPARQL endpoints at `dati.beniculturali.it` and
`dati.cultura.gov.it`. Both endpoints, and `cultura.gov.it`, refused or timed out from two
network vantage points on 2026-09-06, so Florence was not measured; the record is `looked-at`
with the counts owed. Verdict: regional tier — the strongest candidate on paper (typed,
coordinated, licensed, monthly), pending a day on which it answers.

**Peru — the ministry's museums directory and the *Registro Nacional de Museos*.** The
directory at `museos.cultura.pe` lists the 56 museums the Ministry of Culture administers —
state museums — with virtual tours and collection links but no addresses, coordinates, licence
or download; the national registry of public and private museums (2015) sits on the open-data
portal, whose host did not resolve from here on 2026-09-06. The case matters for what the
state's list cannot hold: Lima's museums a traveller goes to — the Larco Museum (18 sitelinks, the best known of
Wikidata's three art museums in Lima, tagged with its item on OSM), the Lima Art Museum (10,
untagged on OSM), Pedro de Osma — are private, and a state directory enumerates the state's
own. Verdict:
completeness 0 for the art-museums kind — **not a source of the regional tier on its own**;
the national registry is the candidate, to be measured.

**Georgia — the state register established by law, unpublished.** The law *On Museums* has the
Ministry of Culture register every museum; no public list of it was found. The Georgian
National Museum is an umbrella of the country's leading museums — the Janashia museum, the
Museum of Fine Arts, the Open Air Museum of Ethnography, the Museum of Soviet Occupation,
house museums — with one website, which is the Louvre problem of ADR-0023 one country over: an
umbrella is not the venue a traveller stands in.
Verdict: no native register readable → the global-read-per-unit fallback (§ 7.4) and a
curator's list; the record says so, so Tbilisi is not searched again for a register until one
is published.

**Estonia — statistics, a collections system, and an association.** Statistics Estonia counts
160 museums and 102 expositions in 2024 (table KU05) — the yardstick, not a list. MuIS, the
museum information system, publishes open data as RDF over persistent URIs, but of *collection
objects*, not of museums: it enumerates works, not venues. The Estonian Museums Association
keeps an alphabetical directory of museums; its terms and shape were not measured. Verdict: no
register found yet that enumerates *museums* with terms and coordinates; the association's
directory is the next candidate, then the fallback.

**Germany — a statistical database, and a city portal.** The Institut für Museumsforschung
holds the addresses and collection areas of some 6,300 museums for the annual statistics; no
open dataset of it was found. Berlin's *Museumsportal* is § 7.3.

### 7.2 Museum associations and umbrella institutions

A national committee of ICOM, a museums association (Deutscher Museumsbund, the Estonian
Museums Association), an umbrella such as the Georgian National Museum. They enumerate their
*members*, which is a bias the record has to state (a private house museum that never joined
is absent), and they rarely publish terms or coordinates. Verdict for both tiers: a list a
curator reads and a way to reach a registry that is not online; a source only where the
directory is licensed and machine-readable, which none of the three looked at is.

### 7.3 Tourism boards' and city lists

*Museumsportal Berlin* lists 205 museums, memorials and collections of the city, 24 to a page,
with addresses, opening hours and an editorial description — an enumeration with the "worth
seeing" judgement built in, which is exactly the regional tier's shape. Its `robots.txt`
carries a content signal (`search=yes,ai-train=no,use=reference`) and disallows a dozen
named crawlers, and the page carries no licence: under the database right (§ 5) reading all 205 is extraction, so
the mode is *ask first*, and until asked the portal is a list a curator reads, not a source.
The same holds for a tourism board's "top museums" page anywhere: editorial cut 1, terms 0 or
1, access 1, and no identity of its own — the family lands between 6 and 10 (Berlin's portal
scores 10), and identity 0 makes the verdict `curator-list` whatever the total; it enters the
register as `looked-at` with the address to write to. Verdict: regional tier — **a cut worth having, on
permission**; world tier — no.

### 7.4 Global open data read per unit — the fallback, and the yardstick

**Wikidata by class within the unit.** Identity 2, coordinates 1–2 (137 of 162 in Florence,
220 of 236 in Paris, 43 of 346 in Estonia), names 2, terms 2 (CC0), access 2, cadence 2 — and
completeness 1 at best: it enumerates what
somebody wrote an item for, which in Lima is 30 museums against 109 on OSM. Its within-unit
signal is sitelinks ranked *inside the unit* (Tbilisi: Museum of Soviet Occupation 27, Art
Museum of Georgia 23, Simon Janashia Museum 20, the National Gallery 14 — the order a resident
would give), or local-language readership (2026-09-04: Kumu 1,889 Estonian views in twelve
months, the Niguliste Museum 406 with two sitelinks and no English article at all). With a
floor on the group it is the fallback of § 4 and scores 13 for a unit like Tbilisi; the record
names the unit it was adopted for. Verdict: world tier — the source it already is; regional
tier — **the fallback, per unit, with its coverage measured** (§ 4's three conditions).

Read *by class for the whole world*, rather than within a unit, Wikidata is now the world tier of
three kinds: art museums through the works they hold (ADR-0023), public art and monuments by the
sculptural and commemorative classes (#754), and places of worship through both at once — the
building's own fame and the fame of a work inside it, one source at one line (#753, ADR-0052;
[`wikidata-places-of-worship`](../sources/global/wikidata-places-of-worship.md) is the register's
first world-tier record).

**Wikivoyage See listings.** CC BY-SA 3.0; a listing carries a name, coordinates and, where an
editor added it, a `wikidata=` item — 30 of 30 in Florence, 63 of 71 in Berlin/Mitte, 36 of 54
in Tbilisi, 0 of 43 in Kraków/Old Town, 1 of 29 on the Paris city article, which is split into
twenty district articles. An editorial "worth seeing" cut by construction, in the unit's
guide, and the reason it is not the first choice: coverage depends on which editor last walked
the city, and share-alike on the text binds what is copied — the coordinates and the item are
facts, the description is not ours to store. Verdict: regional tier — **a cut and a fallback,
where its `wikidata=` coverage is measured high**; never the description.

**OpenStreetMap through Overpass.** ODbL; the most complete *enumeration* of what stands —
350 museums in Estonia against the statistics office's 160, because a farm museum and a
school's museum room are `tourism=museum` too — with a Wikidata tag on 30 % (Estonia) to 82 %
(Paris) and pictures on almost none. Identity is the weakness (ids move on re-mapping; the tag
is the only stable one) and share-alike is the question (§ 5). Verdict: **the yardstick and the
finder** for both tiers — what the unit holds that no register lists — and a source of rows
only once the ODbL question is answered for the catalogue as a whole.

**Wikipedia pageviews** enumerate nothing and are the within-unit signal of the fallback
(2026-09-04's measurement: order of magnitude apart between the Louvre and Kumu, so a log and a
percentile within (unit, kind), and "no article" is never zero). #807 measures it on the works
pool. Verdict: a signal, for the regional tier's cut; not a source.

### 7.5 Commercial catalogues and guides

Google Places is excluded by its terms for both tiers and for curator screens (§ 5); the
Tripadvisor Content API forbids storing, combining and transforming what it returns, which is
everything a catalogue does; a printed guide (Michelin, Lonely Planet) is copyright and has no
data interface; a museum pass's list (the Paris Museum Pass names its venues) is a small
editorial cut whose terms are the pass's. Verdict: **no** as sources; a guide's list is what a
curator reads before writing their own.

### 7.6 What the rules choose on the canon, for the regional tier of art museums

What the world tier holds there today (the development catalogue, 2026-09-06): Florence —
the Uffizi, the Galleria dell'Accademia, the Bargello, the Galleria Palatina; Berlin — the
Alte Nationalgalerie and the Gemäldegalerie, and nothing else; Kraków — the Czartoryski
Museum alone; Paris — the Louvre and its peers; Lima, Tbilisi, Tallinn, Tartu — nothing.

| Unit | The rules choose | The rules refuse | The canon place that decides it |
|---|---|---|---|
| Paris | Muséofile's 50 Paris rows (the source scores 13), to be filtered to the art domains of the Muséofile base — the list CSV carries no theme | OSM as rows (share-alike); the city article of Wikivoyage (1 of 29 items) | musée Zadkine, M1115 — a Musée de France no world line reaches |
| Florence | Luoghi della cultura, once it answers; until then Wikivoyage's 30 fully-itemed listings as the cut over Wikidata's 50 art museums | a lower sitelinks line (17 of 162 museums at 22) | the Museo Stibbert — 11 sitelinks, on the guide's list with its item, not on the world's |
| Berlin | a register to be found (IfM's database is statistics); Museumsportal's 205 on permission; Wikidata's 39 art museums with Mitte's 63 itemed listings as the cut meanwhile | scraping the portal against its signal | the Berlinische Galerie — 21 sitelinks, one short of the line, the city's own museum of modern art |
| Kraków | Państwowy Rejestr's 9 as the cut, identity through OSM's Wikidata tags | OSM's 89 as rows | Manggha — registered by the state since 2013, 13 sitelinks, below any world line |
| Lima | the national registry (unmeasured); until then Wikidata-per-unit (30 items) plus Central Lima's 99 listings, with a curator's cut | the ministry's 56 state museums alone | the Larco Museum — private, absent from the state's list |
| Tbilisi | Wikidata-per-unit ranked by sitelinks (32 items, 30 with coordinates) plus a curator's list | waiting for a register the law names and nobody publishes | Art Museum of Georgia, 23 sitelinks; the Georgian Museum of Fine Arts, 11 |
| Estonia | the association's directory, to be measured; Wikidata by `country` (346, 43 with coordinates) ranked by Estonian readership | OSM's 350 as rows; the location chain (46) | the Niguliste Museum — 2 sitelinks, 406 Estonian readers, Notke's *Danse Macabre* |

Every row above is a decision the rules make with the numbers of one day, and every one is
overturned the moment a native source that scores higher is found — which is the point.

---

## 8. The queries behind § 7

Recorded so the numbers can be re-taken. All read on 2026-09-06.

Wikidata, museums located in a unit (QLever's Wikidata endpoint, `https://qlever.dev/api/wikidata`;
the Query Service timed out on the same pattern that day):

```sparql
PREFIX wd: <http://www.wikidata.org/entity/>  PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>  PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT (COUNT(DISTINCT ?m) AS ?n) WHERE {
  ?m wdt:P31/wdt:P279* wd:Q33506 .      # any museum class
  ?m wdt:P131* wd:Q31487 .              # Kraków; a country reads wdt:P17 instead
  ?m wikibase:sitelinks ?sl . FILTER(xsd:integer(?sl) >= 22)   # one band at a time
}
```

The art-museum subtree is `wdt:P31/wdt:P279* wd:Q207694`; coordinates `wdt:P625`; the
Muséofile link `wdt:P539`.

OpenStreetMap (Overpass, `https://overpass-api.de/api/interpreter`, one unit per call, fifteen
seconds apart):

```
[out:json][timeout:120];
area["wikidata"="Q31487"]->.a;
nwr["tourism"="museum"](area.a);
out tags;
```

Lima's boundary relation was not found by its item, so its box was
`(-12.25,-77.20,-11.85,-76.80)`.

Wikivoyage: `https://en.wikivoyage.org/w/api.php?action=parse&prop=wikitext&format=json&page=<title>`,
listings counted as `{{see … }}` templates across lines, `wikidata=` and `lat=` read from them.

Muséofile: `https://www.data.gouv.fr/api/1/datasets/liste-des-musees-de-france/` names the CSV;
Poland: `https://api.dane.gov.pl/1.4/datasets/4345/resources` names the spreadsheet.

---

## 9. What revises these rules

This document was written before any regional source was adopted, and each first adoption is
expected to rewrite part of it:

- **The first register adopted** (#628, Muséofile or Luoghi della cultura): the scorecard's
  lines (11 and 8), the cut rule for a source with its own label, and how the regional rows meet
  the world tier's in practice — § 6.2, § 1, § 7.1.
- **The first fallback adopted for a unit** (Tbilisi or Lima): § 4's three conditions and the
  floor, and what the curator's cut looks like on a screen — § 4, § 7.4.
- **The first source read from documents with a model**: § 6.2's access modes and the shape of
  the proposal the gate receives.
- **The first curator list**: what the curator screen asks for and how a curator's tier and
  badge are recorded (the badge is #603's).
- **The first non-museum kind** (public art below the world's line; churches with works, #753):
  whether the scorecard's criteria are the kind's or the family's. **Answered** by the
  places-of-worship adoption — the family's, with two criteria read on their world-tier sense;
  see the log row below.

Changes are logged here:

| Date | What changed | Why |
|---|---|---|
| 2026-09-06 | First version (#799) | The rules before the first adoption |
| 2026-09-08 | First non-museum kind (#753, ADR-0052): the scorecard's criteria held for a world-tier source read on the world-tier reading of Signal and Completeness; the two doors are one source | Places of worship adopted `wikidata-places-of-worship` — the criteria are the family's, not the kind's, and § 6.2's wording, which is the regional tier's, needed reading rather than rewriting: Signal 2 is a signal comparable across the world, Completeness 2 is a stated subset with its rule written. A place admitted for its own fame and one admitted for a work it holds are two admissions of one source at one line, so they are one record, not two |

## 10. Out of scope

Adopting any source (#628, #581, the public-art regional tier); the list of sources per unit
(each kind's issue fills the register); thresholds per kind and the exact within-unit signal per
source (#628's slices, #761); the readership measurement on the works pool (#807); the
Pilgrimage badge (#808); which languages a region reads (#809); the curator screen for tier and
badge (#603 for the badge); any code for the register, which arrives with the first sync that
reads it.
