---
slug: am-visit-yerevan
name: "Visit Yerevan"
publisher: "Yerevan Municipality (\"the official tourism website of Yerevan Municipality\"; the footer: \"Powered by TMCYC\")"
urls:
  home: https://visityerevan.am/en/
  dataset: none
  api: none
  terms: https://visityerevan.am/terms-of-use/en/
family: tourism-board
kinds: [public-art, places-of-worship, architecture, art-museums, history-museums, entertainment-venues, squares-and-streets, parks-and-gardens]
tier: regional
unit: { level: city, code: AM, name: Yerevan }
row:
  identity: "a number per place in the page's address (/places/details/<number>/<language>/); the place page read also gives the monument's state index"
  wikidata_link: none
  coordinates: address-only
  languages: [hy, ru, en]
  signal: "none in the listings, which index every place of a type; the home page features eight"
terms:
  licence: "none named; Terms of use: \"Reference to www.visityerevan.am is obligatory\"; the photographs are reserved"
  database_right: not-asserted
  attribution: "www.visityerevan.am, named as the terms ask"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date; the footer reads 2021 - 2026"
  volume: "196 places linked from the Monuments page; a listing per type beside it"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: unknown
  identity: 1
  coordinates: 1
  names: 2
  signal: 0
  terms: 1
  access: 1
  cadence: 0
  total: unknown
  verdict: provisional
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Visit Yerevan

"The official tourism website of Yerevan city", published by the municipality in Armenian,
Russian and English. Looked at on 2026-10-02 because the Yerevan survey fetched it in its second
pass and counted it for nothing: "its listings are an index of every monument and museum (230
monuments)". What makes it useless to a survey of what a traveller expects is what the register
looks for: it enumerates.

**What it sorts its places into.** Culture: Monuments, Places of Worship, Historical Buildings,
Museums and Galleries, Theatres, Squares and Parks. Entertainment: Tours, Cuisine, Drinks,
Restaurants, Hotels, Bars, Pubs, Clubs, Cinemas, Health, Wellness, Sport. Shopping & Souvenirs.
The Monuments page links 196 places, each with its year and street. A place has a page under a
number (`/places/details/80/en/` is Republic Square): its type, a text, dates, the architect and
"State index: 1.6.96", which reads as the monument's number in a state list. The page loads a
Yandex map; no point stands in its markup. The kinds in this record's front matter are read off
those headings, not measured.

**Terms ([the access table](../site-access.md), 2026-10-02).** `visityerevan.am`: `allowed` (no
robots file; terms are about photographs). `robots.txt`: none (/robots.txt answers 200 with the
site's HTML page, not a robots file). Terms: silent on automated reading, at
https://visityerevan.am/terms-of-use/en/. About the photographs: "It is strictly forbidden to
copy, misuse, spread, exemplify, adjust the photos or use them for any other purposes before
prior written permission of the Yerevan Municipality". Nothing on automated access. The terms
page, read for this record, opens: "Reference to www.visityerevan.am is obligatory." The privacy
policy on the same page "comes into force on 11.11.2021".

**What decides it.** Not yet decided: completeness against the city's canon was not measured, so
the total is `unknown` and the verdict `provisional`. It has a number of its own per place and,
on the page read, what looks like a state list's index for the monument: together the identity a
sync needs, if the index proves to be on every monument. It has no signal of which of its places
matter, which is the cut the survey's list or a global source would have to supply. The terms
ask for a reference and reserve the photographs, which the catalogue does not take; whether the
reference is all they ask of the text is the question to put to tmcyc@yerevan.am, the address
the page gives.

**What the survey measured.** Nothing was counted for it, as a directory.
