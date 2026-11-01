---
slug: pt-visit-lisboa
name: "Visit Lisboa"
publisher: "Turismo de Lisboa – Associação Turismo de Lisboa, Visitors & Convention Bureau (ATL)"
urls:
  home: https://www.visitlisboa.com/en
  dataset: none
  api: none
  terms: https://www.visitlisboa.com/en/p/terms-and-conditions
family: tourism-board
kinds: [squares-and-streets, neighbourhoods, historic-hotels-and-restaurants, beaches-and-swimming, shops, viewpoints, world-heritage, parks-and-gardens, towns-and-villages, palaces-and-residences, monuments-and-memorials, art-museums, regional-food, regional-drinks, places-of-worship, castles-and-fortresses, markets, specialty-museums, public-art, live-music-venues, national-parks-and-reserves]
tier: regional
unit: { level: region, code: PT, name: Lisbon region }
row:
  identity: "the site's page per place (/en/places/<slug>)"
  wikidata_link: none
  coordinates: unknown
  languages: [pt, en, es, fr, de, it]
  signal: "being featured on its See & Do and Culture & Outdoors pages, on one of its sixteen cultural routes (Fado, Azulejo, Baroque, Statuary, Urban Art, Codfish, Nature, Shops with History, Wine, Tagus, Pessoa, Saramago, Almada, Portuguese Paving, African Lisbon, Industrial) or in its Only in Lisbon articles; its /en/places/filter directories carry none"
terms:
  licence: "none named; the terms put the whole text and image content under copyright, allow viewing and printing, forbid altering it, and reserve legal action against any copy, reproduction or other unauthorised use"
  database_right: unknown
  attribution: "Turismo de Lisboa (Visit Lisboa), named with a link to the page quoted"
  agent: allowed
  agent_rests_on: "site-access.md, www.visitlisboa.com, read 2026-11-01: robots.txt holds no directive, the terms are silent on robots, automated access, scraping, mining and AI; a bar on copying is no bar on reading, names only recorded"
  program: unknown
  program_rests_on: "no sync is proposed from this record"
  model: none
access:
  mode: scrape
  format: html
  cadence: "continuous: its What's On page is dated to the current season"
  volume: "a directory per type of place (museums and monuments, viewpoints, beaches, fado, eat and drink, shopping, where to stay) and, beside it, sixteen cultural routes, an Only in Lisbon article series (48 articles) and themed pages"
  rate: none
scorecard:
  date: 2026-11-01
  completeness: unknown
  identity: 1
  coordinates: unknown
  names: 2
  signal: 1
  terms: 1
  access: 1
  cadence: 2
  total: unknown
  verdict: provisional
status: looked-at
issue: 2232
looked_at: 2026-11-01
---

# Visit Lisboa

The official site of Turismo de Lisboa, the Lisbon region's tourism association and convention
bureau, in Portuguese, English, Spanish, French, German and Italian. Looked at on 2026-11-01
because the Lisbon survey (#2232) read it as the source from inside the country. Its reach is the
region, not the city: its areas are Lisboa, Lisboa Centro, Lisboa Oriente, Belém, Ericeira, Mafra,
Sintra, Cascais, Tejo, Caparica and Arrábida.

**What it sorts its places into.** Two things. Directories of every place of a type, reached
through `/en/places/filter?c=…` (museums and monuments, sunsets and viewpoints, beaches, fado
houses, restaurants, golf, shopping, hotels), with a page per place (`/en/places/<slug>`), which
the survey did not count: an index of everything recommends nothing. And editorial pages: the
featured picks on *See & Do* and *Culture & Outdoors*, sixteen *Cultural Routes* under
`/en/lisbon-stories/` (Fado, Azulejo, Baroque, Statuary, Urban Art, Codfish, Nature, Shops with
History, Wine, Tagus, Pessoa, Saramago, Almada, Portuguese Paving, African Lisbon, Industrial), the
*Only in Lisbon* article series (48 short pieces on a place or a story each), the *Lisbon Areas*
pages (`/en/regions/belem` is the one that answers; the other areas are named without a link) and
the *Lisbon Flavours* pages (`/en/p/lisbon-flavours` answers 404; its pastel de nata page answers).
No page is labelled a top list or an itinerary. A place page was not read for its row, so whether
one carries a coordinate is owed.

**Terms ([the access table](../site-access.md), 2026-11-01).** `www.visitlisboa.com`: `allowed`.
`robots.txt` holds a comment and no directive, read through the fetch tool and as an ordinary
client alike; the home page sends no usage signal and `/.well-known/tdmrep.json` answers 500.
Terms, at https://www.visitlisboa.com/en/p/terms-and-conditions ("Terms and Conditions | Visit
Lisboa"): "The entire text and image content of the Platform is published with protection of
copyright"; viewing and printing are permitted and "the content of the Platform may not be
altered"; ATL "reserves the right to file for legal action against the authors of any copy,
reproduction or other unauthorised use of the content of the Platform". Silent on robots,
automated access, scraping, mining and AI.

**What decides it.** Not yet decided: completeness against the region's canon is measured when the
Lisbon list is merged, so the total is `unknown` and the verdict `provisional`. It has a slug per
place and no identifier beyond it; its editorial pages are a selection and its directories an
enumeration. The terms ask for no reproduction, which a sync of its texts would need; names read for
a survey are not its texts.

**What the survey measured.** Twenty-two pages by fetch, one at a time: the home page, the terms,
See & Do, Culture & Outdoors, the first page of Only in Lisbon, What's On, the Belém area page, the
Cultural Routes index and fifteen of the routes (Fado, Azulejo, Baroque, Statuary, Urban Art,
Codfish, Nature, Shops with History, Wine, Tagus, Pessoa, Saramago, Almada, Portuguese Paving,
African Lisbon), and the pastel de nata page. The Lisbon survey of 2026-11-01 counted it on
96 of the 251 entries of `db/catalogue-coverage/expectations/lisbon.jsonl`. The kinds in
the front matter are those under which the survey filed two or more of the entries it is named on.
