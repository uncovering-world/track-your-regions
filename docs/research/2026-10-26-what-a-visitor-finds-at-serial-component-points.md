# What a visitor finds at a serial World Heritage site's component points (2026-10-26)

A serial World Heritage site is drawn as one point per component, and nobody had checked what a visitor finds at those points (#2058). This report takes a stratified sample of 120 component points from the development catalogue, establishes what each one is on the ground from sources independent of UNESCO's and Wikidata's coordinates, checks the Wikidata item each one is bound to, and runs the four visit witnesses of `backend/src/services/sync/visit/witnesses.ts` over the same sample. The question it answers is whether components with nothing to see exist, how often each kind of defect occurs, and which signals find them.

## Summary

- **Most points are fine.** Weighted to the population, about 62% of component points stand on something a visitor can see.
- **Components with nothing to see exist, and they are rare.** Four of the 120 points (about 5% weighted) are components whose remains are buried or built over. The clear cases are Köln-Alteburg (1631-078), the Roman fleet base under a residential district, and Burgäschisee Ost (1363-029), a pile-dwelling village under a lakeshore reed belt. UNESCO lists such components, so the visit question for components (#2059) has real cases to ask about.
- **A component shown only inside a larger place is rarer still**: two points, about 2% weighted. The Praetorium under Cologne's city hall (1631-076) is the clear one.
- **Large areas are the largest group after visible points**: about 23% weighted. A national park, a marsh, a stretch of road or a cluster of rice terraces has a nominal centre, and nothing in particular stands there.
- **About 7% of points are wrong coordinates**: the component exists elsewhere, from 300 m to 111 km away. Four cheap signals find most of them: a coordinate rounded to whole minutes, a coordinate shared by several components, an OpenStreetMap object tagged with the component's `ref:whc` more than 500 m away, and, for a bound component, an item that is a single building or site standing 1 km or more from the point. The last finds the most, 12 of the 19.
- **About 8% of bound components are bound to the wrong item.** The worst cases are matches by name: the Danish ring fort Trelleborg (1660-004) is bound to the Swedish namesake 119 km away, and El Silencio (1453-003) to a village of that name 234 km away.
- **The witness rule does not predict *nothing remains* on components.** Every component's item carries a heritage designation, so the formal witness always says yes. Of the 46 bound points with fewer than two witnesses, 2 are *nothing remains*, and 22 are visible components.

## Classes

Each point got one class:

- **visible**: at the point or within about 250 m, a visitor finds the component and can see it.
- **inside a larger place**: the component is there, but a visitor meets it only as part of a larger place, such as a museum or an archaeological zone.
- **nothing remains**: the component is at the point, but nothing of it can be seen.
- **wrong coordinate**: the component exists and can be seen, but the point is not on it.
- **large area**: the component is itself a large area or a long line, and the point is a nominal centre.

The issue's fifth class, *broad object*, is "the point's item names something wider than the component, as with a city". That is a property of the binding, not of the place, so this study records it in the binding column as **broader**. The class *large area* is a different finding: the component itself is wide, whatever item it is bound to.

The binding of each point to its Wikidata item is one of:

- **component**: the item is this component;
- **broader**: the item contains the component, such as the whole city or the whole route;
- **narrower**: the item is a part of the component;
- **other**: the item is something else, such as a namesake or a neighbour;
- **none**: no item.

## Result

### Rates per class

The sample is 120 points. The weighted share scales each band's sample back to its share of the population. The interval is a 95% interval for the weighted share, from 10,000 resamples of each band's points (seed 2058): a rough measure of how much a sample this small can tell.

| Class | Points | Weighted share | 95% interval |
|---|---|---|---|
| visible | 63 | 62.3% | 52–72% |
| large area | 32 | 23.4% | 15–33% |
| wrong coordinate | 19 | 7.3% | 4–12% |
| nothing remains | 4 | 5.0% | 0.6–10.5% |
| inside a larger place | 2 | 1.9% | 0–5.1% |

The bands were sampled unevenly on purpose (see Method), so the unweighted counts over-represent far points. The weighted shares are the estimate for the catalogue.

| Binding | Points | Weighted share |
|---|---|---|
| component | 85 | 67.7% |
| none | 20 | 26.7% |
| broader | 4 | 2.9% |
| other | 8 | 1.8% |
| narrower | 3 | 1.0% |

Of the 100 bound points, 15 are bound to something other than the component. Weighted, that is 5.7% of all components, or about 8% (95% interval 3–14%) of the 73% that have an item.

Agents rated 69 verdicts high confidence, 36 medium and 15 low. A visitor's access was rated open for 91 points, restricted for 18 (a booked tour, a closed reserve, a private house) and unknown for 11.

### Class by distance band

The band is the distance from the component's point to its item's own coordinate.

| Band | Points | visible | large area | wrong coordinate | nothing remains | inside a larger place |
|---|---|---|---|---|---|---|
| under 100 m | 25 | 18 | 5 | 1 | 1 | 0 |
| 100 m – 1 km | 25 | 17 | 4 | 2 | 1 | 1 |
| 1 – 5 km | 20 | 3 | 9 | 8 | 0 | 0 |
| over 5 km | 20 | 8 | 5 | 7 | 0 | 0 |
| item has no coordinate | 10 | 5 | 4 | 1 | 0 | 0 |
| no item | 20 | 12 | 5 | 0 | 2 | 1 |

Beyond 1 km, 29 of 40 points are not visible ones. Of the 8 visible points beyond 5 km, 5 stand on the right spot with a wrong binding (Trelleborg, El Silencio, Mesu 'e Montes, Trewavas, Cité du Pont). The other 3 are Pueblo Pintado (353-004), whose item's own coordinate is 5.4 km off, the Fuji Omuro Sengen Shrine (1418-008), whose two precincts lie 12 km apart, and Kalabsha (88-004), a temple moved to a new site (see *Data defects found on the way*).

### Nothing remains

| # | Component | What is there |
|---|---|---|
| 3 | Köln-Alteburg (1631-078) | The Roman fleet base lies under a residential district of Köln-Marienburg. The Rhineland's cultural landscape register says: "Heute erinnert kaum noch etwas an dieses große römische Kastell". |
| 4 | Burgäschisee Ost (1363-029) | A Neolithic lakeshore village excavated in 1944, after the lake was lowered. What is left lies in the ground and the reed belt; the shore path has information boards. Most of the 111 components of *Prehistoric Pile Dwellings around the Alps* are of this nature. |
| 101 | Tarentum (1708-015) | The point is a 19th-century square in Taranto. No source read describes visible Roman remains there. Low confidence; see also *Data defects found on the way*. |
| 103 | Chiuiești – Muncelul (1718-164) | A Roman watchtower site of the Dacian frontier, located only to the whole minute. Nothing is mapped or photographed within 500 m. Low confidence. |

### Inside a larger place

| # | Component | What is there |
|---|---|---|
| 1 | Köln-Praetorium (1631-076) | The governor's palace lies under the city hall. It is shown inside the Archäologische Zone / MiQua route, closed until the museum opens. |
| 108 | Tongji canal, Xiayi section (1443bis-005) | The excavated canal bed is shown in a site exhibition hall at Jiyang. Where the hall stands could not be confirmed. Low confidence. |

Agents may have under-used this class. Naracoorte (698-005), one parcel of a national park visited as a whole, and Mirozhsky Monastery (1523-002), a church inside a monastery, were classed *large area* and *visible* though they sit near the line.

### Wrong coordinates

| # | Component | Off by | What went wrong |
|---|---|---|---|
| 76 | Vredefort Dome, pseudotachylite quarry (1162-004) | 111 km | One degree of latitude |
| 74 | Probota, Church of St Nicholas (598-005) | 66 km | Longitude 27.5 for 26.62; rounded to whole minutes |
| 87 | Veracel Station (892-003) | about 20 km | Rounded to whole minutes; low confidence |
| 90 | Biertan (596bis-001) | 19.4 km | Longitude only |
| 85 | Plopiș, Church of the Holy Archangels (904-005) | 12.3 km | Longitude only |
| 84 | al-Balid (1010-003) | 8.1 km | Rounded to whole minutes |
| 73 | Dobšinská Ice Cave (725ter-007) | 5.4 km | — |
| 65 | Wandu Mountain City (1135-003) | 3.5 km | — |
| 59 | Hagi, Ebisugahana shipyard (1484-002) | 1.9 km | Rounded to whole minutes |
| 92 | Kumagai House, Iwami Ginzan (1246bis-001h) | 1.8 km | Shared by several components |
| 51 | Dazu, Nanshan carvings (912-002) | 1.6 km | Rounded to whole minutes |
| 54 | Kežmarok articular church (1273-003) | 1.1 km | — |
| 66 | Ming Xiaoling (1004-005) | 1.1 km | The point is on the Sun Yat-sen Mausoleum's plaza |
| 61 | Sękowa, Church of St Philip and St James (1053-006) | 1.1 km | Rounded to whole minutes |
| 55 | Thessaloniki, city walls (456-001) | 755 m | — |
| 58 | Musawwarat es-Sufra (1336-003) | 600 m | Rounded to whole minutes |
| 29 | Tarraco, Centcelles (875-012) | 550 m | — |
| 32 | Taüll, Santa Maria (988-003) | 470 m | — |
| 6 | Solana de las Covachas (874-741) | 300 m | Shared by several components |

Three kinds of error recur:

- **A slip in one figure.** Probota, Biertan and Plopiș have the right latitude and a longitude off by tens of kilometres. Vredefort is off by exactly one degree of latitude. These look like transcription errors in the source list.
- **Rounding to whole minutes.** A minute of latitude is about 1.85 km, so a rounded point can land a kilometre or two from a church or a shipyard.
- **A centre for a wide object, reused for one part.** The Kumagai House shares a point with other components of Iwami Ginzan; Ming Xiaoling's point sits on the neighbouring mausoleum's plaza.

Gračanica Monastery (724-004bis) is not in the table though UNESCO's coordinate for it, rounded to whole minutes, is 1.9 km off. The catalogue has merged that point into the monastery's own (`experience_locations` 13724), and draws the monastery's, which stands on it. It is counted as visible.

### Wrong bindings

| # | Component | Bound to | Binding | Cause |
|---|---|---|---|---|
| 79 | Trelleborg (1660-004) | Q2451282, *Trelleborg ring fort*, in Sweden, 119 km away | other | A namesake. The Danish fort is Q2303857, which OpenStreetMap tags on it. |
| 88 | El Silencio (1453-003) | Q5352180, *El Silencio*, 234 km away | other | A namesake village. |
| 71 | Necropolis of Mesu 'e Montes (1730-004) | Q1945735, *Monte Baranta*, 18.8 km away | other | A different prehistoric site. OpenStreetMap tags the necropolis with Q1664717. |
| 64 | Agumbe Reserved Forest (1342rev-034) | Q607045, *Agumbe*, the village | other | Matched by name to the village the forest is named after. |
| 52 | Kaesong Walls (1278rev-002) | Q12583238, *Chomsongdae* | other | The observatory of the neighbouring component, Manwoldae. |
| 75 | Mongol Daguur (1448rev-002) | Q64787575, the Russian Daursky reserve, 78 km away | other | The same serial site's component across the border. |
| 81 | Trewavas (1215-004) | Q64810745, *Wendron Mining District*, 13 km away | other | Another area of the same serial site. |
| 72 | Cité du Pont (1360-059) | Q64829603, an item with no English label, 23.6 km away | other | Probably another component of the Mining Basin, through a numbering conflict. OpenStreetMap's `ref:whc` puts 059 and 060 in different places from the list. |
| 1 | Köln-Praetorium (1631-076) | Q23048, *Colonia Claudia Ara Agrippinensium* | broader | The whole Roman city. Its Commons picture is St. Maria im Kapitol. |
| 20 | Old Great North Road (1306-006) | Q1544323, *Great North Road* | broader | The whole road, of which the component is one section. |
| 60 | Naracoorte (698-005) | Q1135796, *Naracoorte Caves National Park* | broader | The whole park, of which the component is one parcel. |
| 78 | El Salvador (1008-005) | Q1026982, *El Salvador*, the town | broader | Matched by name to the town that contains the component. |
| 30 | Kroměříž, Castle Garden and Castle (860-001) | Q200693, *Kroměříž Castle* | narrower | The castle only, without the garden. |
| 82 | The route, including Avdat (1107-001) | Q791665, *Avdat* | narrower | The one town the route component names. |
| 90 | Village of Biertan (596bis-001) | Q16743875, *Biertan fortified church* | narrower | The church, for a component that is the whole village. |

Nine of the 20 unbound points have a candidate item in OpenStreetMap's `wikidata` tag on the object at the point:

- Iža – Kelemantia (1608ter-075): Q1309695.
- Trajan's Arch and the Concordia Temple in Mérida (664-006): Q30919150, the arch alone, so a narrower binding.
- Quinta and Molino de Presa (500ter-003): Q6095062.
- uKhahlamba Drakensberg Park (985ter-001): Q2744060.
- Istanbul's Land Walls (356bis-004): Q89917, the whole Walls of Constantinople, so a broader binding.
- Zenemonyama Kofun (1593bis-019): Q66124367.
- Maisons La Roche et Jeanneret (1321rev-001): Q3278824 and Q3843577, one per house.
- Yafteh Cave (1744-004): Q8046666.
- Bisesero (1586-005): Q24964531.

These were read from the map data only and not checked on Wikidata.

### The witnesses

The four witnesses were computed for the 100 bound points with the rules in `witnesses.ts`: `guide` from the Wikivoyage usage build, `formal` from the item's best-ranked statements, `map` from the OpenStreetMap objects tagged with the item, and `photos` from the files of the item's Commons category taken within 1 km. A point with no item cannot be witnessed by item, and was left out.

**The formal witness is always yes for a component.** Every bound component's item carries P1435 (heritage designation) = Q43113623 (part of UNESCO World Heritage Site). Only 18 of the 100 items also state an official website (P856) or a visitor count (P1174), and none states opening hours (P3025). So for a component the rule "two of four" reduces to "one of guide, photos and map".

| Class (bound points) | Points | Fewer than two witnesses | guide | photos | map |
|---|---|---|---|---|---|
| visible | 51 | 22 | 21 | 15 | 19 |
| large area | 27 | 16 | 11 | 3 | 1 |
| wrong coordinate | 19 | 6 | 12 | 7 | 8 |
| nothing remains | 2 | 2 | 0 | 0 | 0 |
| inside a larger place | 1 | 0 | 0 | 1 | 0 |

- **"Fewer than two witnesses" does not predict *nothing remains*.** It flags 46 points. It catches both bound *nothing remains* points, but they are 2 of the 46; the rest are 22 visible components, 16 large areas and 6 wrong coordinates. A component's item is often obscure: no Wikivoyage article uses it, it has no Commons category, and no mapper tagged it. That says little about whether anything stands there.
- **The witnesses do not find wrong coordinates.** They read the item, not the point: a well-known church with a wrong point still has its guide, its photographs and its map object. The guide said yes for 12 of the 19 wrong coordinates.
- **They are weak on large areas.** The map witness is yes for 1 of 27 and photos for 3 of 27, since the rule looks for something that stands. A national park has no such object.

### Signals worth building on

These were measured on the 120 points from data the catalogue's workbench already holds.

| Signal | Points it flags | What they are |
|---|---|---|
| Coordinate rounded to whole minutes | 13 | 7 wrong coordinate, 5 large area, 1 nothing remains; no visible point |
| Coordinate shared by several components | 3 | 2 wrong coordinate, 1 large area |
| An OpenStreetMap object tagged with the component's `ref:whc` lies more than 500 m from the point | 8 | 5 wrong coordinate, 1 large area, 1 visible point with a numbering conflict (Cité du Pont), and Gračanica, whose UNESCO coordinate the catalogue already replaced |
| The point and its item disagree by 1 km or more, and the item is a church, building, cave, fortification or archaeological site | 21 | 12 wrong coordinate, 5 wrong binding; 4 others: the item's own coordinate is wrong (Cueva de la Peña de Candamo), a shrine with two precincts (Fuji Omuro Sengen), a moved temple (Kalabsha), and Gračanica |
| No OpenStreetMap object tagged `historic`, `tourism` or as a place of worship within 250 m | 49 | 25 of the 32 large areas, 13 of the 19 wrong coordinates, 9 of the 63 visible points |
| No Commons file taken within 250 m | 64 | 25 of the 32 large areas, 14 of the 19 wrong coordinates, 22 of the 63 visible points |

- **A coordinate check.** The first four signals together flag 33 points and find 16 of the 19 wrong coordinates. Only 7 visible points are among them: 3 have a wrong binding instead, and Gračanica's UNESCO coordinate is wrong, though the point drawn is not. The three wrong coordinates no signal found are Centcelles (550 m), Santa Maria de Taüll (470 m) and Vredefort, whose item coordinate is as wrong as the point. Where the OpenStreetMap `ref:whc` object lay within 310 m, all 15 points were visible.
- **A binding check.** Distance flags the binding defects too: all 8 *other* bindings lie 1 km or more from their item, and so do 4 of the 7 *broader* and *narrower* ones. Distance does not tell which side is wrong, so a check has to show a curator both the point and the item. A name match to an item in another country (Trelleborg, Mongol Daguur) or 100 km away is the clearest case.
- **An empty map at the point** marks large areas and wrong coordinates, not components with nothing to see. Only 1 of the 4 *nothing remains* points had an empty map at 250 m. The others had a board, an unnamed dig or a modern square.
- **The item's class** helps tell a large area from a wrong coordinate. A protected area was a large area in 8 of 12 cases, and a road in 3 of 5. A church was a wrong coordinate in 6 of 13.

## Data defects found on the way

- **Truncated component names.** Two Tarraco components, 875-012 and 875-013, are stored with the name "The" (`experience_locations` 7828 and 7829). Their Wikipedia links point to Centcelles and Els Munts. Two Via Appia components, 1708-003 and 1708-004, have an empty name. The name is read by `componentName` in `backend/src/services/sync/unescoSyncService.ts`; whether the source list or the parser cuts it was not checked.
- **A moved monument has two coordinates.** Kalabsha's item, Q1721920, holds two P625 statements of equal rank: the temple's new site at New Kalabsha and its original, now flooded site 36 km south. The point is right; a distance to "the item's coordinate" is ambiguous for such items.
- **A component reference in doubt.** The catalogue holds 1708-015 as Tarentum. Italian Wikipedia's component table lists Tarentum as 1708-013. A news report on the inscription says components 003, 004 and 015 of the nomination were excluded, in a numbering where 015 is Altamura-Castellaneta. It is not settled here which numbering the catalogue follows.
- **A numbering conflict.** For Cité du Pont (1360-059), OpenStreetMap's `ref:whc` objects for 059 and 060 lie elsewhere than the list puts them.

## What this does not show

- **The rates are rough.** The share of *nothing remains*, 5%, has an interval from about 1% to 11%. The sample answers whether a class exists and about how common it is, not its exact rate.
- **The verdicts are agents' readings of public sources**, with a confidence on each. Fifteen are low confidence. A curator who has stood at a point would settle them better.
- **"Inside a larger place" is probably under-counted.** The line between it and *visible* or *large area* is a judgement, and agents leaned away from it.
- **The witnesses were computed for the components' items**, as the code computes them for a place. A component's point and its item can disagree, as this report shows.

## Method

### Population and sample

The population is every component of a serial site with a live point in the development catalogue on 2026-10-26: 5,605 components. The issue counted 5,710 parts; the difference is components with no live point. The query joins `experience_parts` (reason `component`) to its point in `experience_locations` by the component reference, preferring a point merged into a neighbour's, and reads the bound item's P625 from the workbench's Wikidata subset (`workbench.wikidata_claims`, best rank, Earth globe). The item's class is read from P31 through `workbench.wikidata_class_closure` into the buckets the issue names.

A merged point carries UNESCO's coordinate, while the catalogue draws the point it was merged into. The agents checked UNESCO's coordinate. Seven sampled points are merged. For six of them the class is the same at the drawn point. Gračanica's drawn point stands on the monastery, so it is counted as visible, while the agents found UNESCO's coordinate 1.9 km off. Its map and photographs were read at UNESCO's coordinate, so it counts among the visible points with no map object and no photograph within 250 m.

| Band | Population | Sample |
|---|---|---|
| under 100 m | 2,495 | 25 |
| 100 m – 1 km | 798 | 25 |
| 1 – 5 km | 371 | 20 |
| over 5 km | 219 | 20 |
| item has no coordinate in the subset | 228 | 10 |
| no item | 1,494 | 20 |

Within a band, points were drawn at random (seed 2058), at most one per site, plus the three Cologne components the issue names. The sample covers every item class the issue lists: 15 archaeological sites, 13 churches, 13 settlements, 12 protected areas, 11 buildings, 9 caves, 5 fortifications, 5 roads and 17 items of other classes.

### Map and photographs at the point

For each point, the OpenStreetMap objects within 500 m that carry `historic`, `tourism`, `heritage`, `ref:whc`, a `wikidata` tag or are a place of worship were read from `workbench.osm_objects`, the 15 nearest per point. The objects whose `ref:whc` names the component were read wherever they lie. Commons files taken within 500 m of each point were read with the Commons geosearch API, and the files of each item's Commons category with their camera coordinates, one request at a time, under a research User-Agent with the project's address and no personal data.

### Ground truth

Six research agents took 20 points each. Each got the point, its item, the witnesses, the map and the photographs at the point. They were told not to use UNESCO's pages or coordinates, Wikidata's coordinates, or the coordinate boxes of Wikipedia and GeoHack, since those derive from the data under test. They read guides, Wikipedia's article text, heritage registers, the sites' and cities' own pages, archaeology reports and news, and recorded for each claim the page, how it was read, and what it says. Each agent looked a site up in `docs/sources/site-access.md` before reading it, and judged and recorded a site the table did not hold. Those verdicts are added to the table in the same change as this report.

Some reads did not follow those rules:

- One agent sent one Overpass API query before reading its `robots.txt`, which closes `/api/`. The answer gave nothing usable and was not used.
- One agent read four sites before checking their terms; all four were cleared afterwards. It also sent one search to the closed path `fr.wikipedia.org/w/api.php`.
- Two agents cited a search-result title on a refused site: Historic England (point 37) and Lonely Planet (point 48). Those two pieces of evidence are dropped. Both verdicts stand on the other evidence.
- One agent relied on another agent's verdict for `www.kuladig.de` before that verdict was in the table.
- Atlas Obscura, which the table allows, answered 403 to one page on 2026-10-26. Its line is left as it is, and nothing of it was used.

Where an agent cited only a search-result title on a site the table does not hold, the title is not counted as a reading, and the verdict rests on the page and the map evidence beside it.

### Witnesses

The witnesses were computed on the development database with the rules in `witnesses.ts`: `guide` from `workbench.wikivoyage_usage`, `formal` from the best-ranked P1435, P3025, P1174 and P856 in `workbench.wikidata_entities`, `map` from the item's objects in `workbench.osm_objects` with the code's `objectWitnesses` rule, and `photos` from the item's Commons category, 10 or more files within 1 km.

## The sample

"Off by" is the agent's estimate of the distance from the point to the component; for a large area it is 0 when the point falls inside it. "Evidence" is the first page read for the point, or the map or the photographs at the point where no page was read.

| # | Site | Ref | Component | Band | Class | Binding | Off by | Conf. | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Frontiers of the Roman Empire – The Lower Germ… | 1631-076 | Köln-Praetorium | 100 m-1 km | inside a larger place | broader | 30 m | high | [de.wikipedia.org](https://de.wikipedia.org/wiki/Praetorium_%28Köln%29) |
| 2 | Frontiers of the Roman Empire – The Lower Germ… | 1631-077 | Köln-Deutz | 100 m-1 km | visible | component | 0 | high | [de.wikipedia.org](https://de.wikipedia.org/wiki/Kastell_Deutz) |
| 3 | Frontiers of the Roman Empire – The Lower Germ… | 1631-078 | Köln-Alteburg | 100 m-1 km | nothing remains | component | 0 | medium | [kuladig.de](https://www.kuladig.de/Objektansicht/KLD-312719) |
| 4 | Prehistoric Pile Dwellings around the Alps | 1363-029 | Burgäschisee Ost | <100 m | nothing remains | component | 0 | medium | [so.ch](https://so.ch/fileadmin/internet/bjd/bjd-ada/img/Archaeologie/AS-Sonderheft/pdf/6_as2021-2_Burgaeschisee.pdf) |
| 5 | Pearling, Testimony of an Island Economy | 1364rev-005 | Al-Ghūṣ House | <100 m | visible | component | 0 | high | [khaleejtimes.com](https://www.khaleejtimes.com/world/revamped-al-ghous-house-opened-in-bahrain) |
| 6 | Rock Art of the Mediterranean Basin on the Ibe… | 874-741 | Zona 8 (Solana de las Covachas) | <100 m | wrong coordinate | component | 300 m | medium | [prehistour.eu](https://www.prehistour.eu/portfolio-item/nerpio-rock-shelters/) |
| 7 | Ephesus | 1018rev-004 | House of Virgin Mary | <100 m | visible | component | 40 m | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/House_of_the_Virgin_Mary) |
| 8 | Maratha Military Landscapes of India | 1739-006 | Rajgad | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Rajgad_Fort) |
| 9 | The Ahwar of Southern Iraq: Refuge of Biodiver… | 1481-004 | The West Hammar Marshes | <100 m | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Hammar_Marshes) |
| 10 | Archaeological Border complex of Hedeby and th… | 1553-004 | Main Wall Areas 2 to 3 | <100 m | visible | component | 0 | high | [haithabu-danewerk.de](https://haithabu-danewerk.de/en/?p=2803) |
| 11 | Qhapaq Ñan, Andean Road System | 1459-001 | Segment Quebrada Grande-Las escaleras | <100 m | large area | component |  | medium | [lagaceta.com.ar](https://www.lagaceta.com.ar/nota/1133146/turismo/caminar-sobre-nubes-legendario-sendero-4000-metros-patrimonio-humanidad.html) |
| 12 | Historic Centre of Macao | 1110-002 | Zone 2 (Guia Hill) | <100 m | visible | component | 180 m | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Guia_Fortress) |
| 13 | Roman Monuments, Cathedral of St Peter and Chu… | 367-002 | Moselle Bridge | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Roman_Bridge_%28Trier%29) |
| 14 | City of Vicenza and the Palladian Villas of th… | 712-018 | Villa Barbaro | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Villa_Barbaro) |
| 15 | Tomioka Silk Mill and Related Sites | 1449-004 | Arafune Cold Storage | <100 m | visible | component | 0 | high | [visit-gunma.jp](https://visit-gunma.jp/en/spots/arafune-cold-storage/) |
| 16 | Routes of Santiago de Compostela: Camino Franc… | 669bis-020 | Monastère de Santo Toribio de Liébana | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Santo_Toribio_de_Liébana) |
| 17 | Venetian Works of Defence between the 16th and… | 1533-005 | Fort of St. Nikola, Šibenik-Knin County | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/St._Nicholas_Fortress) |
| 18 | China Danxia | 1335-007 | Longhushan: Longhushan Section | <100 m | large area | component | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Danxia_landform) |
| 19 | Hyrcanian Forests | 1584bis-008 | Vaz (East) | <100 m | large area | component | 0 | medium | [fa.wikipedia.org](https://fa.wikipedia.org/wiki/منطقه_حفاظت‌شده_واز) |
| 20 | Australian Convict Sites | 1306-006 | Old Great North Road | <100 m | large area | broader | 950 m | medium | [nationalparks.nsw.gov.au](https://www.nationalparks.nsw.gov.au/things-to-do/walking-tracks/old-great-north-road-world-heritage-walk/visitor-info) |
| 21 | Camino Real de Tierra Adentro | 1351-031 | Historic ensemble of the city of Sombrerete | <100 m | visible | component | 0 | high | [es.wikipedia.org](https://es.wikipedia.org/wiki/Sombrerete) |
| 22 | Champaner-Pavagadh Archaeological Park | 1101-012 | JLS 16 Chandrakala Vav | <100 m | visible | component | 0 | low | [en.wikipedia.org](https://en.wikipedia.org/wiki/Champaner-Pavagadh_Archaeological_Park) |
| 23 | The 20th-Century Architecture of Frank Lloyd W… | 1496rev-005 | Fallingwater | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Fallingwater) |
| 24 | Cultural Landscape and Archaeological Remains… | 208-003 | Qoul-I Akram Caves in the Fuladi Valley | <100 m | visible | component | 36 m | medium | [whav.univie.ac.at](https://whav.univie.ac.at/ic/25) |
| 25 | Sacri Monti of Piedmont and Lombardy | 1068-009 | Sacro Monte di Belmonte, Valperga Canavese | <100 m | visible | component | 0 | high | [it.wikipedia.org](https://it.wikipedia.org/wiki/Sacro_Monte_di_Belmonte) |
| 26 | Complex of Hué Monuments | 678-014 | Tran Hai Fortress | <100 m | visible | component | 0 | low | [vi.wikipedia.org](https://vi.wikipedia.org/wiki/Trấn_Hải_thành) |
| 27 | San Millán Yuso and Suso Monasteries | 805-002 | Suso Monastery and Archaeological Sites | <100 m | visible | component | 0 | high | [es.wikipedia.org](https://es.wikipedia.org/wiki/Monasterio_de_Suso) |
| 28 | Jeju Volcanic Island and Lava Tubes | 1264bis-007 | Seongsan Ilchulbong Tuff Cone | <100 m | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Seongsan_Ilchulbong) |
| 29 | Archaeological Ensemble of Tarraco | 875-012 | The | 100 m-1 km | wrong coordinate | component | 550 m | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Archaeological_Ensemble_of_Tárraco) |
| 30 | Gardens and Castle at Kroměříž | 860-001 | Castle Garden and Castle | 100 m-1 km | visible | narrower | 0 | high | [cs.wikipedia.org](https://cs.wikipedia.org/wiki/Podzámecká_zahrada) |
| 31 | Prehistoric Sites and Decorated Caves of the V… | 85bis-003 | Font de Gaume (Les Eyzies-de-Tayac-Sireuil) | 100 m-1 km | visible | component | 90 m | high | [fr.wikipedia.org](https://fr.wikipedia.org/wiki/Grotte_de_Font-de-Gaume) |
| 32 | Catalan Romanesque Churches of the Vall de Boí | 988-003 | Eglésia de Santa Maria | 100 m-1 km | wrong coordinate | component | 470 m | high | [ca.wikipedia.org](https://ca.wikipedia.org/wiki/Santa_Maria_de_Taüll) |
| 33 | Hill Forts of Rajasthan | 247rev-005 | Amber Fort | 100 m-1 km | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Amber_Fort) |
| 34 | Historic Centre of Saint Petersburg and Relate… | 540-007b | The Park «Alexandrova Datchs» | 100 m-1 km | visible | component | 0 | medium | [ru.wikipedia.org](https://ru.wikipedia.org/wiki/Александрова_дача) |
| 35 | Atlantic Forest South-East Reserves | 893-006 | Guaraguacu Ecological Station | 100 m-1 km | large area | component | 0 | high | [iat.pr.gov.br](https://www.iat.pr.gov.br/sites/agua-terra/arquivos_restritos/files/documento/2020-07/ee_guaraguacu_3intro.pdf) |
| 36 | University of Coimbra – Alta and Sofia | 1387bis-002 | Rua da Sofia | 100 m-1 km | visible | component | 30 m | high | [pt.wikipedia.org](https://pt.wikipedia.org/wiki/Rua_da_Sofia) |
| 37 | Frontiers of the Roman Empire | 430ter-169 | Rudchester Roman fort, associated civil settlement and a section of Hadrian's Wall and vallum from the A69 to the March Burn in wall mile 13 | 100 m-1 km | large area | component | 0 | medium | [keystothepast.info](https://keystothepast.info/Site-Details?PRN=N10856) |
| 38 | Prehistoric Rock Art Sites in the Côa Valley a… | 866-006 | Meijapão | 100 m-1 km | visible | component | 0 | low | [arte-coa.pt](https://www.arte-coa.pt/visitas/) |
| 39 | Royal Tombs of the Joseon Dynasty | 1319-002 | Hongyureung Cluster | 100 m-1 km | visible | component | 0 | high | [english.gg.go.kr](https://english.gg.go.kr/blog/daily-news/3252/) |
| 40 | Silk Roads: the Routes Network of Chang'an-Tia… | 1442-028 | Maijishan Cave-Temple Complex | 100 m-1 km | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Maijishan_Grottoes) |
| 41 | White Monuments of Vladimir and Suzdal | 633-007 | Monastery of Our Savior and St Euthymius | 100 m-1 km | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Monastery_of_Saint_Euthymius) |
| 42 | Kunta Kinteh Island and Related Sites | 761-003 | Fort Bullen | 100 m-1 km | visible | component | 250 m | medium | [my-gambia.com](https://www.my-gambia.com/mymagazine/fort-bullen/) |
| 43 | Medina of Essaouira (formerly Mogador) | 753rev-002 | L'Archipel d'Essaouira | 100 m-1 km | visible | component | 0 | high | [fr.wikipedia.org](https://fr.wikipedia.org/wiki/Îles_Purpuraires) |
| 44 | Paraty and Ilha Grande – Culture and Biodivers… | 1308rev-002 | Ilha Grande State Park | 100 m-1 km | large area | component | 0 | high | [pt.wikipedia.org](https://pt.wikipedia.org/wiki/Parque_Estadual_da_Ilha_Grande) |
| 45 | Champagne Hillsides, Houses and Cellars | 1465-012 | Avenue de Champagne | 100 m-1 km | visible | component | 0 | high | [fr.wikipedia.org](https://fr.wikipedia.org/wiki/Avenue_de_Champagne) |
| 46 | Old Havana and its Fortification System | 204-001 | Old Havana | 100 m-1 km | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Old_Havana) |
| 47 | Cultural Heritage Sites of Ancient Khuttal | 1627-002 | Kalai Hulbuk | 100 m-1 km | visible | component | 0 | high | [trektajikistan.com](https://trektajikistan.com/blog/hulbuk-fortress/) |
| 48 | Fujian Tulou | 1113-008 | Huaiyuan Lou | 100 m-1 km | visible | component | 120 m | high | [asiaculturaltravel.co.uk](https://www.asiaculturaltravel.co.uk/?p=2652) |
| 49 | Sassanid Archaeological Landscape of Fars Region | 1568-007 | Bishapur: Shapur cave | 100 m-1 km | visible | component | 150 m | medium | [livius.org](https://www.livius.org/articles/place/bishapur/bishapur-cave/) |
| 50 | Churches of the Pskov School of Architecture | 1523-002 | Ensemble of the Spaso-Mirozhsky Monastery: the Transfiguration Cathedral, 12th century | 100 m-1 km | visible | component | 0 | high | [ru.wikipedia.org](https://ru.wikipedia.org/wiki/Мирожский_монастырь) |
| 51 | Dazu Rock Carvings | 912-002 | Nanshan Cliffside Carvings | 1-5 km | wrong coordinate | component | 1.6 km | medium | [en.wikivoyage.org](https://en.wikivoyage.org/wiki/Dazu) |
| 52 | Historic Monuments and Sites in Kaesong | 1278rev-002 | Kaesong Walls | 1-5 km | large area | other | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Kaesong_city_walls) |
| 53 | Cave of Altamira and Paleolithic Cave Art of N… | 310-002 | La Peña de Candamo | 1-5 km | visible | component | 50 m | high | [turismoasturias.es](https://www.turismoasturias.es/es/descubre/cultura/arte-rupestre/rupestre-cueva-de-la-pena-de-candamo) |
| 54 | Wooden Churches of the Slovak part of the Carp… | 1273-003 | Kezmarok | 1-5 km | wrong coordinate | component | 1.1 km | high | [presovregion.travel](https://presovregion.travel/en/trip/wooden-articular-church-in-kezmark-unesco/) |
| 55 | Paleochristian and Byzantine Monuments of Thes… | 456-001 | City Walls | 1-5 km | wrong coordinate | component | 755 m | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Walls_of_Thessaloniki) |
| 56 | Rainforests of the Atsinanana | 1257-002 | Parc National de Masoala | 1-5 km | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Masoala_National_Park) |
| 57 | Xanthos-Letoon | 484-001 | Xanthos | 1-5 km | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Xanthos) |
| 58 | Archaeological Sites of the Island of Meroe | 1336-003 | Musawwarat es-Sufra | 1-5 km | wrong coordinate | component | 600 m | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Musawwarat_es-Sufra) |
| 59 | Sites of Japan’s Meiji Industrial Revolution:… | 1484-002 | Hagi Proto-industrial Heritage/ Ebisugahana Shipyard | 1-5 km | wrong coordinate | component | 1.9 km | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Ebisugahana_Shipyard) |
| 60 | Australian Fossil Mammal Sites (Riversleigh /… | 698-005 | Naracoorte (Caves-Edwards Rd) | 1-5 km | large area | broader | 0 | low | [en.wikipedia.org](https://en.wikipedia.org/wiki/Naracoorte_Caves_National_Park) |
| 61 | Wooden Churches of Southern Małopolska | 1053-006 | Church of St Philip and St James the Apostles, Sękowa | 1-5 km | wrong coordinate | component | 1.1 km | high | [gcatholic.org](https://gcatholic.org/churches/poland/5964) |
| 62 | New Zealand Sub-Antarctic Islands | 877-003 | Antipodes Islands | 1-5 km | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Antipodes_Islands) |
| 63 | Lake Turkana National Parks | 801-001 | Sibiloi National Park | 1-5 km | large area | component | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Sibiloi_National_Park) |
| 64 | Western Ghats | 1342rev-034 | Agumbe Reserved Forest | 1-5 km | large area | other | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Agumbe) |
| 65 | Capital Cities and Tombs of the Ancient Kogury… | 1135-003 | Wandu Mountain City | 1-5 km | wrong coordinate | component | 3.5 km | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Hwando) |
| 66 | Imperial Tombs of the Ming and Qing Dynasties | 1004-005 | Xiaoling Tomb including area from Treasure Mound to Shenlieshan Stele, including Plum Blossom Hill, and Big Golden Gate | 1-5 km | wrong coordinate | component | 1.1 km | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Ming_Xiaoling) |
| 67 | Medieval Monuments in Kosovo | 724-004bis | Gračanica Monastery | 1-5 km | visible | component | 0 | high | [en.wikivoyage.org](https://en.wikivoyage.org/wiki/Gračanica_%28Kosovo%29) |
| 68 | Socotra Archipelago | 1263-016 | Darsa | 1-5 km | large area | component | 0 | low | [en.wikipedia.org](https://en.wikipedia.org/wiki/Darsah) |
| 69 | Gondwana Rainforests of Australia | 368-026 | Spicers Gap State Forest | 1-5 km | large area | component | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Main_Range_National_Park) |
| 70 | Pergamon and its Multi-Layered Cultural Landsc… | 1457-001 | Pergamon, the Multi-Layered City | 1-5 km | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Pergamon) |
| 71 | Funerary Tradition in the Prehistory of Sardin… | 1730-004 | Necropolis of Mesu ‘e Montes | >5 km | visible | other | 95 m | high | [sardegnaturismo.it](https://www.sardegnaturismo.it/en/explore/necropolis-mesu-e-montes) |
| 72 | Nord-Pas de Calais Mining Basin | 1360-059 | Cité du Pont | >5 km | visible | other | 0 | high | [fr.wikipedia.org](https://fr.wikipedia.org/wiki/Liste_des_biens_du_bassin_minier_inscrits_sur_la_liste_du_patrimoine_mondial_dans_le_Nord-Pas-de-Calais) |
| 73 | Caves of Aggtelek Karst and Slovak Karst | 725ter-007 | Dobšinská Ice Cave | >5 km | wrong coordinate | component | 5.4 km | high | [naucnechodniky.eu](https://naucnechodniky.eu/nch-k-dobsinskej-ladovej-jaskyni/) |
| 74 | Churches of Moldavia | 598-005 | Church of St Nicholas and the Catholicon of the Monastery of Probota | >5 km | wrong coordinate | component | 66.0 km | high | [ro.wikipedia.org](https://ro.wikipedia.org/wiki/Mănăstirea_Probota) |
| 75 | Landscapes of Dauria | 1448rev-002 | Mongol Daguur SPNA | >5 km | large area | other | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Landscapes_of_Dauria) |
| 76 | Vredefort Dome | 1162-004 | The pseudotachylite (quarry) site | >5 km | wrong coordinate | component | 111.0 km | medium | [iugs-geoheritage.org](https://iugs-geoheritage.org/geoheritage_sites/vredefort-dome/) |
| 77 | Mountain Railways of India | 944ter-001 | Darjeeling Himalayan Railway | >5 km | large area | component |  | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Darjeeling_Himalayan_Railway) |
| 78 | Archaeological Landscape of the First Coffee P… | 1008-005 | El Salvador | >5 km | large area | broader | 0 | low | [ecured.cu](https://www.ecured.cu/Limonar_%28El_Salvador%29) |
| 79 | Viking-Age Ring Fortresses | 1660-004 | Trelleborg | >5 km | visible | other | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Trelleborg_%28Slagelse%29) |
| 80 | Fujisan, sacred place and source of artistic i… | 1418-008 | Fuji Omuro Segen-jinja Shrine | >5 km | visible | component | 0 | high | [ja.wikipedia.org](https://ja.wikipedia.org/wiki/富士御室浅間神社) |
| 81 | Cornwall and West Devon Mining Landscape | 1215-004 | Trewavas (A3ii) | >5 km | visible | other | 0 | high | [cornishmining.org.uk](https://www.cornishmining.org.uk/areas/tregonning-and-gwinear-mining-district) |
| 82 | Incense Route - Desert Cities in the Negev | 1107-001 | The route, including Avdat | >5 km | large area | narrower | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Incense_Route_–_Desert_Cities_in_the_Negev) |
| 83 | Chaco Culture | 353-004 | Pueblo Pintado | >5 km | visible | component | 150 m | high | [nps.gov](https://www.nps.gov/chcu/planyourvisit/outliers.htm) |
| 84 | Land of Frankincense | 1010-003 | Archaeological site of al-Balid | >5 km | wrong coordinate | component | 8.1 km | high | [omanobserver.om](https://www.omanobserver.om/article/70994/Local/frankincense-land-museum---a-prominent-cultural-landmark-in-dhofar) |
| 85 | Wooden Churches of Maramureş | 904-005 | Church of the Holy Archangels | >5 km | wrong coordinate | component | 12.3 km | high | [en.wikivoyage.org](https://en.wikivoyage.org/wiki/Maramureș) |
| 86 | Agave Landscape and Ancient Industrial Facilit… | 1209-001 | Zona nucleo 01, Valle de Tequila y Amatitán | >5 km | large area | component | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Agave_Landscape_and_Ancient_Industrial_Facilities_of_Tequila) |
| 87 | Discovery Coast Atlantic Forest Reserves | 892-003 | Veracruz Station | >5 km | wrong coordinate | component | 20.0 km | low | [veracel.com.br](https://www.veracel.com.br/en/rppn-estacao-veracel/) |
| 88 | Precolumbian Chiefdom Settlements with Stone S… | 1453-003 | El Silencio | >5 km | visible | other | 0 | medium | [semanariouniversidad.com](https://semanariouniversidad.com/?p=152837) |
| 89 | Nubian Monuments from Abu Simbel to Philae | 88-004 | Kalabsha | >5 km | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Temple_of_Kalabsha) |
| 90 | Villages with Fortified Churches in Transylvania | 596bis-001 | Village of Biertan | >5 km | wrong coordinate | narrower | 19.4 km | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Biertan) |
| 91 | Hopewell Ceremonial Earthworks | 1689-003 | Hopeton Earthworks | item, no coord | visible | component | 0 | medium | [nps.gov](https://www.nps.gov/hocu/learn/historyculture/hopeton-earthworks.htm) |
| 92 | Iwami Ginzan Silver Mine and its Cultural Land… | 1246bis-001h | House of the Kumagai Family | item, no coord | wrong coordinate | component | 1.8 km | medium | [mlit.go.jp](https://www.mlit.go.jp/tagengo-db/R1-00576.html) |
| 93 | Sado Island Gold Mines | 1698-003 | Aikawa-Tsurushi Gold and Silver Mine - Tsurushi area | item, no coord | visible | component | 0 | medium | [pref.niigata.lg.jp](https://www.pref.niigata.lg.jp/site/sado-goldmine/sg-290.html) |
| 94 | Islands and Protected Areas of the Gulf of Cal… | 1182-007 | Cabo San Lucas | item, no coord | large area | component | 0 | medium | [es.wikipedia.org](https://es.wikipedia.org/wiki/Área_de_Protección_de_Flora_y_Fauna_Cabo_San_Lucas) |
| 95 | Hidden Christian Sites in the Nagasaki Region | 1495-011 | Egami Village on Naru Island (Egami Church and its Surroundings) | item, no coord | visible | component | 0 | medium | [goto.nagasaki-tabinet.com](https://goto.nagasaki-tabinet.com/en/model/course9) |
| 96 | Rabat, Modern Capital and Historic City: a Sha… | 1401-001 | Ville nouvelle, Qasba des Oudaïa, Jardin d'Essais, Médina, Remparts et portes almohades, Site archéologique du Chellah | item, no coord | large area | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Rabat) |
| 97 | State Historical and Cultural Park “Ancient Me… | 886-010 | Greater and Lesser Kiz Kala | item, no coord | visible | component | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Merv) |
| 98 | Central Amazon Conservation Complex | 998-001 | Jau National Park, Amana Sustainable Development Reserve and Demonstration Area of Mamiraua Sustainable Development Reserve | item, no coord | large area | component | 0 | high | [pt.wikipedia.org](https://pt.wikipedia.org/wiki/Parque_Nacional_do_Jaú) |
| 99 | Ancient and Primeval Beech Forests of the Carp… | 1133quinquies-040 | Monte Cimino | item, no coord | visible | component | 0 | high | [it.wikipedia.org](https://it.wikipedia.org/wiki/Monte_Cimino) |
| 100 | Rice Terraces of the Philippine Cordilleras | 722-005 | Rice Terrace Clusters of Hungduan | item, no coord | large area | component | 0 | low | [en.wikipedia.org](https://en.wikipedia.org/wiki/Hungduan) |
| 101 | Via Appia. Regina Viarum | 1708-015 | Tarentum | no item | nothing remains | — |  | low | [it.wikipedia.org](https://it.wikipedia.org/wiki/Via_Appia._Regina_Viarum) |
| 102 | Frontiers of the Roman Empire – The Danube Lim… | 1608ter-075 | Iža – “Kelemantia”, rímsky vojenský tábor (kastel) | no item | visible | — | 0 | high | [sk.wikipedia.org](https://sk.wikipedia.org/wiki/Rímsky_vojenský_tábor_v_Iži) |
| 103 | Frontiers of the Roman Empire – Dacia | 1718-164 | Chiuiești – Muncelul Chiuieștiului | no item | nothing remains | — |  | low | [actualdecluj.ro](https://actualdecluj.ro/?p=245867) |
| 104 | Archaeological Ensemble of Mérida | 664-006 | Trajan's Arch, Concordia Temple | no item | visible | — | 0 | high | [es.wikipedia.org](https://es.wikipedia.org/wiki/Arco_de_Trajano_%28Mérida%29) |
| 105 | Silk Roads: Zarafshan-Karakum Corridor | 1675-008 | Sanjarshakh Settlement | no item | visible | — | 0 | medium | [international.ucla.edu](https://www.international.ucla.edu/apc/event/12913) |
| 106 | Historic Centre of Lima | 500ter-003 | Quinta and Molino de Presa | no item | visible | — | 90 m | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Quinta_de_Presa) |
| 107 | Maloti-Drakensberg Park | 985ter-001 | uKhahlamba Drakensberg Park | no item | large area | — | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/UKhahlamba-Drakensberg_Park) |
| 108 | The Grand Canal | 1443bis-005 | Shangqiu Xiayi Section of Tongji Canal | no item | inside a larger place | — | 0 | low | [cac.gov.cn](https://www.cac.gov.cn/2024-07/03/c_1721687908272444.htm) |
| 109 | Historic Areas of Istanbul | 356bis-004 | Istanbul Land Walls Component Area of World Heritage Site | no item | large area | — | 320 m | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Walls_of_Constantinople) |
| 110 | Talayotic Menorca | 1528rev-005 | C5: Area between the ravines of Torrevella and Cala en Porter | no item | large area | — | 0 | medium | [es.wikipedia.org](https://es.wikipedia.org/wiki/Menorca_talayótica) |
| 111 | Mozu-Furuichi Kofun Group: Mounded Tombs of An… | 1593bis-019 | Zenemonyama Kofun | no item | visible | — | 0 | high | [city.sakai.lg.jp](https://www.city.sakai.lg.jp/kanko/rekishi/bunkazai/bunkazai/shokai/bunya/shiseki/mozukofungun/zenemonyama.html) |
| 112 | The Cemetery Complexes of the Xiongnu Nobility | 1759-008 | Takhiltiin Khotgor | no item | visible | — | 0 | low | [depts.washington.edu](https://depts.washington.edu/silkroad/archaeology/mongolia/xiongnu/xiongnuarchhist/xiongnuarchhist.html) |
| 113 | The Architectural Work of Le Corbusier, an Out… | 1321rev-001 | Maisons La Roche et Jeanneret | no item | visible | — | 0 | high | [en.wikipedia.org](https://en.wikipedia.org/wiki/Villa_La_Roche) |
| 114 | Prehistoric Sites of the Khorramabad Valley | 1744-004 | Yafteh Cave | no item | visible | — | 15 m | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Yafteh) |
| 115 | Cliff of Bandiagara (Land of the Dogons) | 516-002 | Village de Songo | no item | visible | — | 10 m | medium | [dogonlanguages.info](https://dogonlanguages.info/villages/126) |
| 116 | The par force hunting landscape in North Zealand | 1469-005 | Tolvkarlevej and Højager | no item | visible | — | 0 | low | [en.wikipedia.org](https://en.wikipedia.org/wiki/Par_force_hunting_landscape_in_North_Zealand) |
| 117 | Ancient Building Complex in the Wudang Mountains | 705-010 | Needle Grinding Well | no item | visible | — |  | low | [en.wikivoyage.org](https://en.wikivoyage.org/wiki/Wudang_Mountains) |
| 118 | Wixárika Route through Sacred Sites to Wirikut… | 1704-001 | Tuapurie | no item | large area | — | 0 | low | [inah.gob.mx](https://www.inah.gob.mx/images/boletines/2025/334/Boletin%20334.pdf) |
| 119 | Memorial sites of the Genocide: Nyamata, Muram… | 1586-005 | Bisesero | no item | visible | — | 0 | high | [newtimes.co.rw](https://www.newtimes.co.rw/article/118058/News/reb-staff-pay-homage-to-bisesero-genocide-victims) |
| 120 | Andrefana Dry Forests | 494bis-006 | Parc National de Tsimanampesotse | no item | large area | — | 0 | medium | [en.wikipedia.org](https://en.wikipedia.org/wiki/Tsimanampetsotsa_National_Park) |
