# ADR-0105: The Wikidata subset follows containment chains, and is kept compact and swapped in whole

**Date:** 2026-10-14
**Status:** Accepted — decision 4 narrowed by [ADR-0107](0107-a-subset-build-cut-in-its-second-pass-is-picked-up-not-started-again.md)

---

## Context

ADR-0101 decision 2 keeps Wikidata locally as a wide subset cut by entity: the seeds (every item with a coordinate, every class), the classes a seed is an instance of, and the items one hop from a seed through a place, part or collection property, in both directions. #1434 builds it from the entities dump of 2026-10-05 (`wikidata-20261005-all.json.gz`, 156.5 GB). Three things the first build met are not settled there.

**One hop loses the objects in rooms.** A museum's object often names a room or a gallery, and the room has no coordinate of its own:
- The Hathoric capital N 384 (Q106692454) is in Room 325 (Q19119449).
- Room 325 has no coordinate and is in the Sully Wing (Q17309954), which has one.
- The capital is two hops from the nearest seed through its location statement.

Its collection statement happens to reach the Egyptian Antiquities department in one hop. Many objects state only their room. The resolver #1445 plans reads such a chain up to the first item with a coordinate, so the subset has to hold the whole chain.

**The dump is mostly what no reader asks for.** Measured on the dump's first 900,000 lines (the earliest ids, which are richer than the average item):
- References are 32% of the bytes.
- Labels, descriptions and aliases come in up to 300 languages, where the code reads eight.
- Every snak repeats its property, its datatype and the item value's three spellings of one id.
- An item kept in the form below is 20% of its dump line: 3.0 KB against 15.0 KB on average.

**A pass over the dump is long.** Decompressing and splitting the 1.5 TB of JSON into lines runs at about 180–200 MB/s on this machine, so one pass takes about two hours. `JSON.parse` runs at about 90 MB/s, and a scan for the main snaks at over 1 GB/s.

## Decision

1. **A containment chain is followed to the first item with a coordinate.** An item is kept when a chain of its location (P276), part of (P361) and collection (P195) statements reaches an item with a coordinate within eight steps. Every item on the way is kept too. A chain that never reaches a coordinate keeps nothing, so a series' episodes and a gene's parts stay out. This narrows ADR-0101 decision 2's "one hop from a seed and never further" for these three properties. The other place properties (P131, P527, P189) stay one hop.
2. **An entity is kept in a compact form.** The form keeps:
   - every statement at every rank, with its statement id, its rank (left out when `normal`) and its qualifiers' values;
   - every sitelink, as its title;
   - the labels and descriptions in the subset's languages (`SUBSET_LANGUAGES`);
   - a property's datatype.

   It leaves out references, aliases, other languages' terms and each snak's datatype. An item value is written as its id (`"Q19675"`), and `somevalue` and `novalue` as `{"somevalue": true}` and `{"novalue": true}`.
3. **The entities are the source, and the rest is derived from them in SQL.**
   - `wikidata_entities` holds each kept entity, with `lz4` compression and a low TOAST threshold so that small entities are compressed too.
   - These tables are derived from it by SQL statements:
     - `wikidata_claims`: a row per statement of the properties the catalogue reads (`CLAIM_PROPERTIES`), with an item value apart from any other, told by the property's datatype;
     - `wikidata_labels`;
     - `wikidata_sitelinks`;
     - `wikidata_class_closure`, which holds every class a kept item is an instance of, with every class above it through subclass of.

   A property a reader starts to need is added to the list and arrives with the next build, without a new pass over the dump.
4. **A build reads the dump twice and swaps its tables in whole.**
   - **The first pass** scans each line without parsing it and keeps only ids and edges. It decides the scope and says what the kept lines weigh.
   - **The second pass** parses the kept lines and writes them. It also writes every other item's terms to a compressed spool beside the dump. The labels ring (ADR-0101 decision 2) is known only once every kept item has been read, so its labels are read back from the spool afterwards.
   - **The tables.** The build writes a `_next` copy of each table, derives and indexes it, then drops the live tables and renames the copies in one transaction. `wikidata_subset_builds` records which dump build is in place and what it kept.
   - **A failure** drops the copies and leaves the live subset as it was.
5. **The subset's tables are unlogged.** Each is rebuilt from its dump. Writing tens of gigabytes through the write-ahead log would double what a build writes, for nothing a reader needs. A crash empties them, and the next build or a published release (#1438) fills them again.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep the dump's own JSON per entity | Five times the disk. The references, aliases and 300 languages are read by nothing. |
| A third pass for the labels ring | Two more hours a build, where a spool of the other items' terms costs a few gigabytes of disk for the length of a build. |
| Derive every statement into `wikidata_claims` | Hundreds of millions of rows for properties no reader asks for. They are in the entity and can be read from it, or derived on the next build. |
| One hop for chains too, as ADR-0101 decided | It loses the objects that name only their room. The resolver of #1445 would have to ask the live service about each one. |
| Logged tables | The write-ahead log carries the whole subset a second time on every build, and a derived table gains nothing from it. |

## Consequences

**Positive:**
- An object in a room of a museum is in the subset with its room and its museum, and #1445's resolver reads the chain locally.
- A new property, qualifier or rank on a kept item is a query, and a new hot property is one line of code and a build.
- A reader never sees half a build, and a failed build changes nothing.

**Negative / Trade-offs:**
- A build reads the dump twice, about two hours each, plus the derivations.
- A crash of the database empties the subset until the next build.
- Statements of properties outside `CLAIM_PROPERTIES` are read from the entity JSON, which is slower than the claims table.

## References

- Narrows: ADR-0101 decision 2
- Related ADRs: ADR-0101, ADR-0064 (row types from the schema)
- Related docs: `docs/tech/dumps.md` § The local Wikidata subset
- Issues: #1434, #1445, #1438, #1439
