# ADR-0030: What a source answers is kept, with an expiry a person can change

**Date:** 2026-08-21
**Status:** Accepted

---

## Context

Museum sync run 61 — the first with the curation gate switched on — failed in its collection
phase and wrote nothing. It had already spent eleven minutes building the artwork class closure
(1166 classes, 93 of them editions) when Wikidata's front end started answering 504, and after
four retries a 502 ended the run. The next attempt would have started at the first phase again.

The published rules of the service explain most of the rest:

| the rule | what we were doing |
|---|---|
| hard query deadline of **60 s** | asking for `timeout=120000`, which the server clamps — so a failing query burned their full minute and came back as a gateway error that says nothing |
| 60 s of processing per 60 s window, per user-agent + IP | four failed 504s spend most of that on nothing |
| **POST responses are not cached** by their front end | every query we send is a POST, including a class closure that does not move for months |
| assume the service is degraded; retry accordingly | we gave up after ~65 s of backoff |
| 5 parallel queries per IP | one at a time with a 1 s gap — already right |

Two of those are about manners and were fixed by changing constants. The third is structural: we
ask the same expensive questions on every run, we cannot benefit from their cache because of how
we send them, and we keep nothing ourselves — so a run that dies late pays for everything again.

## Decision

**1. A run keeps what the source answers, in `wikidata_query_cache`, keyed by the hash of the
query text.** The query is the question: change a filter and the key changes and the read misses,
rather than depending on somebody remembering to invalidate. The text is stored beside the hash so
a person can see what a cached row actually asked.

**2. Each answer carries its own expiry, written when it was fetched.** Not derived on read: the
rule that applied at fetch time stays with the row, and the admin panel shows the same expiry the
reader honours. Default lifetimes are the rates the facts change at — an ontology over months
(7 days), a pool of works over days (1 day), the venue graph over half a day, labels and images
over hours.

**3. A caller says what its question is, or it is not cached.** The descriptor (`kind`, `label`)
comes from the call site, because only the call site knows that this `SELECT ?c` is the class
closure. A cache that classified queries by pattern-matching SPARQL would be one refactor away
from filing a pool under `classes` and keeping it for a week. No descriptor means no caching,
which keeps every existing caller behaving exactly as it did.

**4. The cache belongs to a source, and only the kinds that source produces exist for it.** Every
question an admin asks about it is about one run — "why did the *museum* run answer that" — and
lifetimes differ per source as much as per kind. Today only the museum collector describes its
questions; the UNESCO run reads that source's own API and the landmarks run sends SPARQL without a
descriptor, so neither caches anything, and their panel says exactly that rather than offering to
clear a cache that does not exist.

**5. It can always be bypassed, and always be cleared.** A run started with `refreshCache` ignores
it entirely and deletes nothing; the panel clears any kind of any source. **A cache that cannot be
bypassed is a fork of reality rather than a cache**, and the catalogue's whole purpose is that new
things arrive.

**6. A cache failure costs the run nothing.** A read that throws falls through to the source; a
write that throws is logged and the answer still returned, because the source has already paid for
it. The catalogue must not stop importing because a cache table is unhappy.

**7. A lifetime can be changed per source and per kind, and the change re-dates what is already
kept** — from each answer's own fetch time, not from now. An admin shortening `pool` to an hour
means "stop using yesterday's pools"; a policy that governed only future writes would leave the
old ones in use while the panel showed the new number. A row fetched three days ago under a
one-week rule is four days from expiry; setting the rule to two days must expire it rather than
grant it two more.

**8. A broad pool question is asked sitelinks-first, in fame bands.** `ORDER BY DESC(?sl) LIMIT
3000` over every painting with an owner is what timed out, and measurement says the projection was
never the problem: without the sort it still timed out, and stripped to two columns it came back
502. What costs sixty seconds is reading a sitelink count for each of half a million instances of
`painting`. So the question is asked the other way round — `?w wikibase:sitelinks ?sl` under
Blazegraph's `hint:Query hint:optimizer "None"` and `hint:Prior hint:rangeSafe true`, which makes
the filter an index range scan and the class a probe on what it found. The top band went from a
gateway error to seven seconds. That scan is proportional to the width of the range (10–19 took
61 s, 10–11 took 33 s), so the bands cut the bottom finer than the top: 100+, 50–99, 30–49,
20–29, 15–19, 12–14, 10–11. They tile the range without gap or overlap and each is separately
cached, so a run that dies in the fourth band keeps the first three. **The ownership anchor is
gone with the old join order**: it was there to keep the query small, it is what made it
unaffordable once the order was fixed, and it had already cost the catalogue *Sunflowers* and the
*Burghers of Calais*. **Narrow classes are not banded** — a class with a few thousand instances
is cheap to scan directly, and banding them would turn thirty affordable questions into two
hundred. **A band that fails still fails the run**: the pool decides which museums this category
admits (ADR-0024), and a quietly short pool would withdraw real museums and report success.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Cache in process memory | Dies with the process, which is exactly when a run fails; and `tsx` restarts the dev backend on every file save |
| Cache by a name we invent (`museum-classes`) rather than by the query | The name and the query drift, and the failure is silent: an edited filter served from a row that answered the old one |
| One global TTL | The facts age at wildly different rates; a number that suits an ontology serves stale labels, and one that suits labels re-fetches an eleven-minute closure daily |
| No expiry, cleared by hand | Nobody clears a cache they cannot see failing, and this is a catalogue whose point is that new things arrive |
| Re-date from now when a lifetime changes | Shortening a lifetime would then *extend* the life of the oldest rows, which is the opposite of what the person asked for |
| Use their weekly RDF dumps instead of SPARQL | The right answer at a much larger scale, and a different project: it needs a store, an update pipeline and a query layer of its own |
| Tolerate a failed band and import what we have | A short pool silently withdraws museums, which is the failure the admission axis exists to prevent |
| Keep the class first and only narrow the projection | Measured: still a timeout without the sort, and a 502 with two columns. The scan, not the projection, is the cost |
| Fetch the band thin and hydrate details in `VALUES` batches | Unnecessary once the join order was fixed — the full projection on the worst band answers in 16 s — and it would have added forty round trips to save nothing |
| `FILTER EXISTS` for the ownership anchor, to avoid duplicate rows | Measured at 504 under a fixed join order, where binding the anchor answered in 13 s. Dropping the anchor is both faster and truer to what works-first means |

## Consequences

**Positive:**
- A collection that fails part-way resumes from the phase it reached rather than the first.
- The service is asked the same unchanged question far less often, which is what their guidance
  asks of a client that cannot use their edge cache.
- Each pool band is small enough to answer inside the deadline, so the query that killed run 61
  is no longer one query.
- An admin can see what is kept, how old it is, when it expires, and change or clear it.

**Negative / Trade-offs:**
- A second copy of somebody else's data now exists in our database, with the staleness that
  implies. The mitigations are decisions 5 and 7 and the panel; the risk is real regardless.
- `pg_column_size` on the cached results grows the database by whatever the source answers.
  Measured on the museum collection: hundreds of kilobytes per run, not megabytes — but nothing
  prunes expired rows today beyond an admin pressing Clear.
- Seven pool queries per broad root where there were two means more round trips and more cache
  rows. Each is measured affordable (7–16 s), but the run now spends tens of seconds of their
  cluster per band, so their own throttle — 60 s of processing per 60 s window — is the thing
  that will pace a cold run, arriving as 429s the client waits out. That is their mechanism
  working, and it makes a first-of-the-day collection slower rather than broken.
- Dropping the anchor grows the pool by works with no venue statement at all, which are homeless
  by construction and cost a slot in the venue-statement batches. Paintings almost always carry
  an owner or a location, so the measured growth is small — but it is growth in the direction of
  works the catalogue cannot place.
- The query now depends on two Blazegraph-specific hints. They are not standard SPARQL, and a
  future WDQS on a different engine would ignore them and time out again — silently, as a
  gateway error, which is exactly how this failure has presented every time.
- The `kind` of a question is now part of the code's vocabulary: a new sort of question needs a
  kind, a default lifetime and a line in the panel's descriptions, or it will read as "unknown".

## References

- Wikidata Query Service [User Manual](https://www.mediawiki.org/wiki/Wikidata_Query_Service/User_Manual),
  [Technical interactions](https://wikitech.wikimedia.org/wiki/Wikidata_Query_Service/Technical_interactions),
  [query limits](https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service/query_limits)
- Related ADRs: ADR-0023 (works-first museum selection — what the pool is for), ADR-0024 (a
  category may refuse what the source still lists — why a short pool is dangerous)
- Migration: `db/migrations/029-wikidata-query-cache.sql`
- Sync log 61, whose failure is the measurement behind every number here
