# ADR-0121: English Wikipedia's structure is kept as articles, categories and their links

**Date:** 2026-10-18
**Status:** Accepted
**Narrows:** [ADR-0101](0101-bulk-reads-come-from-public-dumps-and-wikidata-is-kept-as-a-wide-subset.md) decision 6 (which tables of Wikipedia's structure are read: `linktarget` joins them, `langlinks` is not kept)

---

## Context

ADR-0101 decision 6 says Wikipedia's structure comes from its SQL dumps. On the live API today, the Archaeology run asks English Wikipedia two things:

- what an article is filed under (`prop=categories`, `fetchWikipediaCategories`);
- what a category holds (`list=categorymembers` and `generator=categorymembers`, `fetchCategoryMembers`).

The nature walk alone read 121 categories and 1,148 articles on 2026-09-13. Open issues (#889, #882, #930, #881) measure the same structure across many more categories.

The dumps of 2026-10-01 hold the structure in five files: `page` (2.43 GB gzipped), `page_props` (0.48 GB), `linktarget` (1.44 GB), `categorylinks` (2.55 GB) and `langlinks` (0.59 GB).

Since MediaWiki moved category links onto link targets, a row of `categorylinks` names its category by `cl_target_id`, a `linktarget` row (namespace 14 and the title), not by title. Since 2026 the dumps also write each row of an `INSERT` on a line of its own.

Read whole, `categorylinks` is about 27 GB of SQL and some 280 million rows: on the first 30 MB of the file, 3.33 million rows, 99.9 % of them `page` and the rest `file`. Many of those rows are links nothing here reads:
- links from user, talk, template and file pages;
- links into hidden categories. A hidden category is a maintenance or tracking one, such as *Articles with short description*, and the live `prop=categories` call leaves it out with `clshow=!hidden`.

## Decision

**1. One build keeps the four tables of one dump date, swapped in together.** The keeper sits on `enwiki-page`. Its build reads `page`, `page_props`, `linktarget` and `categorylinks` from the same dated directory, in that order.
- Each file is verified by the checksum and size in the directory's `dumpstatus.json` before the next file is read.
- The rows go to `_next` copies. These are indexed and swapped in with the build's record in one transaction, as the Wikidata subset's are (ADR-0105 decision 4).
- A category and the articles filed under it therefore always come from the same dump.

**2. What is kept is what a walk and a vote read.**
- **Pages:** articles (namespace 0) and categories (14) that are not redirects, by page id and title (`enwiki_pages`).
- **Wikidata items:** each kept page's item from `page_props.wikibase_item` (`enwiki_page_items`).
- **Categories:** every category a link may name, by its link target id, except hidden ones (`enwiki_categories`).
- **Links:** each article's and each category's link to a kept category, marked as a subcategory where the filed page is itself a category (`enwiki_category_links`).

Redirects, other namespaces, files, links into hidden categories and the sort keys are not kept.

**3. `langlinks` is not kept.** An article's articles in other editions are what Wikidata's sitelinks already say, and the local subset keeps them (`wikidata_sitelinks`, ADR-0105). A second copy from Wikipedia's side would be one more thing to keep current, and nothing reads it.

**4. The tables are unlogged, the record of the build too.** Each table is rebuilt from its dump. A crash of the database empties the record together with the tables, so the panel asks for a build rather than naming one whose rows are gone (the rule readership follows, #1436).

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Load each table whole, as the dump holds it | About 280 million category links and every namespace's pages, many of them user, talk and tracking links nothing here reads, at a cost of many gigabytes beside the subset for no reader. |
| A keeper per file, each swapped in on its own | A category's members could then come from one dump and its pages from another. The walk joins all four, so they must share one date. |
| Resolve a category link's target by title, joining `linktarget` after the load | The join would run over the whole links table after it is written. Reading `linktarget` first lets each link be filtered as it is read, and the hidden categories never enter the table. |
| Keep the hidden categories and filter them out when reading | The live vote never sees them, and keeping them only makes the largest table larger. |
| Keep `langlinks` as the issue first listed | Nothing reads it, and Wikidata's sitelinks hold the same pairing (decision 3). |

## Consequences

**Positive:**
- A walk or a vote over English Wikipedia's categories becomes a query over local tables of one dated dump, with no requests to the API.
- A new dump is one build of four files, and its first build's figures are recorded on #1440.

**Negative / Trade-offs:**
- A title asked for in a spelling that is a redirect finds no page, where the live API with `redirects=1` follows the redirect. Wikidata's sitelinks name the article itself, not a redirect, so a title read from the subset is not affected.
- Only English Wikipedia's structure is kept. Readership's redirects (ADR-0055 decision 2) need each edition's redirect table, which no build keeps.

## References

- Related ADRs: ADR-0101 (bulk reads come from public dumps, decision 6), ADR-0105 (the subset is swapped in whole), ADR-0055 (readership)
- Related docs: `docs/tech/dumps.md` § English Wikipedia's structure, `docs/sources/global/wikipedia-sql-dumps.md`
- Issue: #1440; Epic #1312
