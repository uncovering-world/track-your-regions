# ADR-0055: Readership is read from Wikimedia's monthly dumps, and a country the data does not show is unobserved, not unread

**Date:** 2026-09-11
**Status:** Draft

---

## Context

#807 measured Wikipedia readership as a signal for the art-museum kind. It opens a second door
to the world tier (ADR-0056) and a door to a regional tier that has no native source
(ADR-0057). Both doors read the same numbers. Where those numbers come from, how they are
cleaned and what they cannot show is decided once, here.

**What has to be read.** The measured pool is every artwork the museum import places, plus the
works of 4 to 9 sitelinks below the import's own pool that carry a location or collection
statement: 9,967 works at 1,005 venues, placed by the import's own stages on 2026-09-10. Their articles number 65,795 in the 81 Wikipedia editions
with more than 15 million views a year and at least 50 views per article. Each article needs
twelve months of views, and so does every title that redirects to it.

**Two routes exist.**

- The Pageviews REST API answers one article at a time. Wikimedia's published limits give an
  anonymous client 10 requests a minute and at most 3 concurrent connections. One pass over the
  pool and its redirects is over 100,000 calls, which is more than a week at that rate. Burst
  tests that looked faster were answered from the cache.
- The monthly `pageview_complete` dumps carry every title of every edition, with its month
  total, its access method (desktop, mobile web, mobile app) and its count for each day. The user
  files for a year are 12 files and 61.8 GB (`pageviews-YYYYMM-user.bz2`). Read as a stream, a
  year takes about four hours on four cores. The two routes agree: English Wikipedia totals
  81.08 billion views both ways, and 4,256 of 4,260 titles measured both ways agree within 5 %.

**What the raw numbers get wrong.** Measured on September 2025 to August 2026:

- *Renamed articles.* Views stay under old titles. *Wanderer above the Sea of Fog* has 3,738
  views under its current English title and 388,094 under a redirect that differs by one capital
  letter. Joining rows by page id instead is dirty. For Millais's *Ophelia* it adds 369,000 views
  to the 550,000 under the title, mostly from rows that carry no title. The *Lion-man* of
  Hohlenstein-Stadel receives a row of the article on Kei Nishikori's career statistics, because
  page ids pass between articles after a deletion. Page-id matches add 0.53 % of all views.
- *One title, three spellings.* The dumps write a title raw, percent-encoded, and in the
  `%uXXXX` form of old JavaScript, each in its own row with its own count.
- *A stream that stops is a clean end of file.* Three months were once written as finished after
  their download was cut.
- *Automated traffic.* The Top 25 Report's rule treats an article as automated when 6 % or less,
  or 94 % or more, of its views come from phones. It was written for English Wikipedia, which is
  read on phones about two thirds of the time. Persian Wikipedia is read on phones 87–92 % of the
  time in ordinary months, and Arabic 73–86 %. Applied as written, the rule sets aside 57
  (work, edition) pairs, and 48 of them are ordinary Persian readers. Compared with each edition's
  own yearly norm instead (a difference of 2.5 or more in log-odds, at 5,000 views a year or
  more), 17 pairs are set aside, 0.13 % of all views. Bouguereau's *The Birth of Venus* in Persian
  is read 99.5 % on phones against an edition norm of 88 %. Ingres's *The Princesse de Broglie* in
  Chinese is read 4 % on phones against a norm of about half. The norm moves within a year: in
  April 2026, during Iran's shutdown, Persian Wikipedia's phone share fell to 66 %.
- *Bursts.* Read as the world door reads it, in every language, 264 of the 2,919 works with more
  than 10,000 views a year have a quarter of their year in one week or a monthly coefficient of
  variation of 0.5 or more, and 77 have the week. The sharpest is a Mughal miniature, *The Death
  of Inayat Khan*, with 91 % of its year in one week. Measured on the
  door ADR-0056 adopted, a trimmed monthly mean admits exactly the same sixteen museums and holds
  together better between the halves of the year, 0.72 against 0.61, while capping every day at
  five times the median drops two of them — the Pera Museum and the Art Mill Museum, the two the
  burst flag marks — and agrees at 0.69.
- *Pipeline incidents.* Wikimedia's hourly data stalled on 22–26 May 2026 (T427171) and went
  missing on 14–16 August 2026 (T435038). The monthly files were built after the backfill and show
  those days at 87–100 % and 93–104 % of their month's median day. They have no hole.

**The reader-country dataset.** Wikimedia publishes daily, differentially private views by
reader country, project and article, with the article's Wikidata item (`country_project_page`,
one file a day, about 7 GB a year). A page needs more than 150 views worldwide that day. A row
for a country is published above 90 views from a lower-risk country, 550 from a medium-risk one
and 1,000 from a higher-risk one. Over the year it shows 2,203 of the pool's 9,967 works. What it
cannot show was measured, and the causes were checked against Wikimedia's code and pages:

- *Policy.* Countries on the Foundation's Country and Territory Protection List are not
  published. There are 16 now, among them China, Iran, Vietnam, Hong Kong and Macao. The
  reference table's change of 26 January 2026 moved Russia, Belarus, Saudi Arabia, Venezuela,
  Afghanistan and Turkmenistan to "not published", and they are present only until 25 January.
- *A join on names.* The publishing job matches MaxMind's country names to its own table's names.
  MaxMind writes "Türkiye", "Czechia" and at times "The Netherlands". Turkey, which the policy
  publishes, and Czechia have no full day in the year. The Netherlands is full only from
  10 February to 10 March and from 9 April to 8 May 2026. Without these countries, Turkish
  Wikipedia appears to be read 31 % in the United States and 31 % in Germany, and Czech
  Wikipedia 59 % in Slovakia.
- *Thresholds.* Egypt is present every day but never with more than 100 rows. Most of
  sub-Saharan Africa shows three to fifteen times fewer visible views per internet user than a
  typical country. 3 March 2026 has 174,000 rows against a median of 326,000.
- *Real access loss, and readers behind VPNs.* China has blocked every edition since
  25 April 2019. Iran was cut off on 8 January 2026 and ran at about 1 % from 28 February to
  26 May. Persian Wikipedia's readers "in Germany" fell from 114,000–242,000 a week in autumn 2025
  to 16,000–22,000 a week during the shutdown, and came back after it: about nine in ten of them
  were in Iran behind VPN servers in Germany. Russian Wikipedia shows no such move after
  26 January. Russia was unpublished, not relocated.
- *No substitute is open.* Baidu Baike, Namu Wiki (a non-commercial licence), Similarweb (no
  automated collection without consent) and Cloudflare Radar (non-commercial, whole sites only)
  offer no per-article readership the catalogue may use.

## Decision

**1. Readership is read from the monthly `pageview_complete` user dumps, over the last twelve
complete months, once a year.** A pass over the pool never goes through the per-article API. A
month file that ends early is an error, not a short month. Wikimedia publishes no checksums for
these files, so completeness is checked three ways: the downloaded size against the server's
`Content-Length`; the decompressor's own exit status, carried through `set -o pipefail`, because a
stream that stops reads to the filter as a clean end of file; and, as a last sanity check, the
line and edition counts, where a month under 50 million lines or 80 editions is refused.

**2. A work's views in an edition are the views of its article's title and of every title that
redirects to it, with all three spellings summed.** Rows matched only by page id are not counted.
A sitelink that leads to an article about something else, or to nothing, is *no article* — never
zero, the rule of ADR-0023. A work with no article in any counted edition is unmeasurable, never
last.

**3. The extract keeps the access method and the daily series, and automated traffic is set aside
against each edition's own norm.** At 5,000 views a year or more, a (work, edition) pair whose
phone share differs from its edition's yearly phone share by 2.5 or more in log-odds does not
count. A pair that does not count adds nothing to its work's sums, so a work's total is the rest
of its editions, and it is left out of the per-language medians that ADR-0057 divides by; it is
never read as zero there. The Top 25 Report's absolute rule is not used.

**4. A burst is a flag, never a correction, and it is read on the series its door reads.** A work
with a quarter of its year in one week, or a monthly coefficient of variation of 0.5 or more,
carries a flag a curator sees: over every language for the world door of ADR-0056, and over the
language that admitted the museum for the regional door of ADR-0057, so that a flag never comes
from a series its door does not read. A museum whose works peak in the same fortnight carries the
flag too. The incidence above is the world door's cohort; a regional admission clears a far lower
bar — about 500 views in Georgian — and its bursts are its own. The level a door reads stays the
plain annual sum unless its own adoption slice changes it; ADR-0056 and ADR-0057 both leave
that choice to #628, each with its own numbers beside it, and the flag stands either way.

**5. The reader-country dataset is a check, never a signal.** It confirms where a work is read
only where ADR-0057 asks, with each country's share computed inside the period that country is
published. A country the dataset does not show is *unobserved*. Nothing is inferred from its
absence: a work from it is neither dropped nor favoured, it carries an "unverified" flag, and the
product says "no data", never "rarely read".

**6. No other readership source is used without its publisher's permission.** Baidu Baike, Namu
Wiki, Similarweb and Cloudflare Radar stay out until their terms are read and permission is given
(ADR-0048 decision 6).

**Not decided here:** which works qualify (ADR-0056, ADR-0057), and where a run stores the extract
or when it schedules the pass. Those belong to the implementation, documented in `docs/tech` with
its code.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| The per-article REST API | 10 requests a minute for an anonymous client and at most 3 concurrent; over 100,000 calls a pass, more than a week, and every redirect needs its own call |
| Hourly dumps | 24 times the files for nothing the monthly files lack: a monthly line already carries each day |
| Joining renamed articles by page id | Dirty: *Ophelia* gains 369,000 views, mostly from untitled rows, and the *Lion-man* gains a row of a tennis article |
| The Top 25 Report's absolute phone-share rule | 48 of its 57 flags are ordinary Persian readers; the edition's own norm flags 17 pairs |
| A trimmed monthly mean, or days capped at five medians, as the level | On the adopted door the trimmed mean admits the same sixteen museums (the halves agree at 0.72 against 0.61) and capping drops the two the flag already marks, the Pera Museum and the Art Mill Museum (14 museums, 0.69). On the reading without English both moved the door by one museum at most and lowered the halves from 0.82 to 0.69 and 0.77. A flag keeps the information either way, and which level to read is the adoption slice's call |
| The reader-country dataset as the signal itself | It shows 2,203 of 9,967 works in a year, and it cannot show China, Iran, Turkey, Czechia, or Russia after 25 January 2026 |
| Reading an unpublished country as zero, or estimating it (a residual of the world total, VPN exits reassigned) | Absence is a policy, a name mismatch or a threshold, not an absence of readers; readers behind a VPN cannot be told from a diaspora except during a shutdown |
| Other encyclopedias or traffic panels for China, Korea and Russia | None publishes per-article views the catalogue may use; the terms forbid it or are unread |

## Consequences

**Positive:**
- Every article in every counted edition has a year of numbers, read inside Wikimedia's limits
  and reproducible from the files `docs/tech/filling-a-kind.md` § 8 names.
- Both doors read one cleaned extract, so a museum's reason traces back to one set of numbers.
- Automated traffic is removed without removing a country's ordinary readers.

**Negative / Trade-offs:**
- A year lags. A work in this year's news counts next year, and a work read mostly in Persian
  reads low for 2025–26.
- About 62 GB of downloads and four hours of decompression a year, where the world tier's
  sitelinks cost a few hundred queries.
- The file format is Wikimedia's and can change. The extractor guards the known traps — three
  spellings, a stream that stops — and is the one place that must follow a change.
- Among the countries that came up in this measurement, the country check cannot run for China,
  Iran, Vietnam, Myanmar, Turkey and Czechia, nor for Russia, Belarus and Saudi Arabia after
  25 January 2026; the full set is Wikimedia's protection list, 16 countries and territories, plus
  whatever the name join loses. Works in them stand on local fame alone.
  A report to Wikimedia about the name join would bring Turkey, Czechia and the Netherlands back;
  that is an outward-facing request, and the maintainer decides it.

## References

- Related ADRs: ADR-0023, ADR-0048, ADR-0056, ADR-0057
- Related docs: `docs/tech/filling-a-kind.md` § 7.4, § 8
- Wikimedia: `https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits`,
  `https://dumps.wikimedia.org/other/pageview_complete/readme.html`,
  `https://analytics.wikimedia.org/published/datasets/country_project_page/00_README.html`,
  `https://foundation.wikimedia.org/wiki/Legal:Country_and_Territory_Protection_List`,
  T427171, T435038
- Issues: #807
