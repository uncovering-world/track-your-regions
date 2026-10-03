---
slug: in-delhi-tourism
name: "Delhi Tourism"
publisher: "Delhi Tourism and Transportation Development Corporation (DTTDC), an undertaking of the Government of the National Capital Territory of Delhi"
urls:
  home: https://delhitourism.gov.in/
  dataset: none
  api: none
  terms: https://delhitourism.gov.in/dttdc/website-policy.html
family: tourism-board
kinds: [places-of-worship, markets, historic-hotels-and-restaurants, palaces-and-castles, tombs-and-mausoleums, public-art, entertainment-venues, squares-and-streets, architecture, landmarks, parks-and-gardens, art-museums, history-museums, famous-peoples-places, world-heritage, neighbourhoods, observatories-and-planetariums, science-and-nature-museums]
tier: regional
unit: { level: city, code: IN, name: Delhi }
row:
  identity: "the portal's own page per place (a file name under /tourist_place/ or /heritage/); no id exposed"
  wikidata_link: none
  coordinates: none
  languages: [en]
  signal: "being listed under one of its headings: Popular Monuments, Unexplored Delhi, Delhi For Kids and the like"
terms:
  licence: "the portal's Copyright Policy: reproduction free of charge after permission by mail, accurately, with the source acknowledged"
  database_right: not-asserted
  attribution: "Delhi Tourism (DTTDC), acknowledged prominently, as its Copyright Policy asks"
  scraping: permitted
access:
  mode: scrape
  format: html
  cadence: "unknown: the pages read carry no date"
  volume: "10 monuments on the Popular Monuments page"
  rate: unknown
scorecard:
  date: 2026-10-02
  completeness: 1
  identity: 0
  coordinates: 0
  names: 1
  signal: 1
  terms: 1
  access: 1
  cadence: 0
  total: 5
  verdict: curator-list
status: looked-at
issue: 1213
looked_at: 2026-10-02
---

# Delhi Tourism

"Official Tourism Website for Government of NCT of Delhi", published by the Delhi Tourism and
Transportation Development Corporation, incorporated in 1975 "to promote tourism in Delhi" (its
About page). Looked at on 2026-10-02 because the Delhi survey read it in its second pass as the
city's own source.

**What it sorts its places into.** The home page's tiles: Heritage Walks, Explore the City,
Unexplored Delhi, Stay in Delhi, Entertainment & Fun, Delhi For Kids, Delhi Delicacies, Food
Tours, Shop in Delhi, Health Walks, Biodiversity Parks, Festivals in Delhi. The menu has
"Tourist places" and "Suggested Itinerary". Heritage › Popular Monuments, the page read for the
row, lists ten monuments with a short text and a "more details" link each; a place has a page
under its own file name and no id. The page loads a Google map script; no point was seen in its
markup.

**Terms ([the access table](../site-access.md), 2026-10-02).** `delhitourism.gov.in`: `allowed`
(no robots file; website policy silent on automated reading). `robots.txt`: none (HTTP 404).
Terms: silent on automated reading, at https://delhitourism.gov.in/dttdc/website-policy.html.
Copyright policy: "Material featured on this Portal may be reproduced free of charge after
taking proper permission by sending a mail to us." Nothing on automated access. The Copyright
Policy goes on, as read for this record: "However, the material has to be reproduced accurately
and not to be used in a derogatory manner or in a misleading context. Wherever the material is
being published or issued to others, the source must be prominently acknowledged." Linking needs
no permission. Footer: "Copyright © Delhi Tourism, All Rights Reserved."

**What decides it.** Identity 0, so the verdict is `curator-list` whatever the total of 5. The
terms are the plainest of the family: free with permission and acknowledgement, which is ask
first. The policy says to send a mail and the page read gives no address; the site has a contact
page (`dt/contact-us.html`), not read.

**What the survey measured.** It could be read: the home page, Popular Monuments, the tourist
places index, "Spiritual Delhi", Unexplored Delhi, Food Tours, Festivals in Delhi, Delhi For
Kids and seven itineraries. Six listing pages were read and counted for nothing, as directories.
The Delhi survey of 2026-10-02 counted it on 116 of the 220 entries of
`db/catalogue-coverage/expectations/delhi.jsonl` (by type: place 90, event 9, food 8, activity
4, route 4, drink 1). On 10 of them nothing else but the surveyor's own list names the entry.
Places among those: Gauri Shankar Temple. The kinds in the front matter are those under which
the survey filed two or more of the entries it is named on.
