# PROPOSED EXPERIENCE CATEGORIES

Ideas for regional experience layers. Each category is something a user can discover about a region they're exploring.

---

## Books

Stories set in this place. Fiction, non-fiction, poetry â€” anything where the region is the backdrop.

Literary tourism is real: people visit Edinburgh for Harry Potter, St. Petersburg for Dostoyevsky, Tokyo for Murakami. Showing "books set here" gives a region cultural depth and a reason to read before traveling.

Could also include school reading lists by region â€” what do local kids read? Unique content nobody else has.

**Data:** Wikidata (narrative location property), Wikipedia for descriptions.

---

## Films

Movies set in or filmed in the region. Two distinct angles:
- "The story takes place here" (narrative location)
- "They physically filmed here" (filming location)

Both are interesting. New Zealand after LOTR, Dubrovnik after Game of Thrones â€” film locations drive tourism.

**Data:** Wikidata (narrative + filming location properties). Could enrich with TMDB for posters and ratings.

---

## Regional Food

Traditional dishes, drinks, and protected regional products.

Food is the #1 travel experience for most people. Knowing the local specialties before arriving helps avoid tourist traps. GI-protected products (like Champagne, Parmigiano, Scotch whisky) are especially interesting â€” they literally can't exist anywhere else.

**Data:** Wikidata (country of origin, GI status). OpenFoodFacts for packaged products.

---

## Festivals & Events

Recurring cultural events â€” festivals, carnivals, religious celebrations, seasonal traditions.

Timing a visit around a major festival is a huge travel driver. "What's happening when I'm there?" is one of the most common trip-planning questions.

**Data:** Wikidata (festivals with location and dates). Web search for current year schedules since dates shift annually.

---

## Notable People

Famous people born in or associated with the region â€” writers, scientists, artists, athletes, rulers.

Adds human stories to places. "Marie Curie grew up in this neighborhood" makes a random Warsaw street memorable.

**Data:** Wikidata (place of birth, citizenship, occupation).

---

## Music

Musicians and bands from the region.

Music creates emotional connection to a place. A playlist of local artists is a powerful pre-trip experience. Could go from classical composers to modern indie bands.

**Data:** Wikidata (place of birth for soloists, location of formation for bands). Spotify API for previews.

---

## Wildlife

Notable animal and plant species you can actually observe in the region, with seasonality.

Knowing you can see puffins in Iceland in June or cherry blossoms in Kyoto in April is trip-defining. Seasonal angle is key: "what can you see RIGHT NOW."

**Data:** GBIF and iNaturalist (both free, great coverage). IUCN Red List for conservation status.

---

## Coins

Current circulation coins of the country/region with photos of obverse and reverse.

Niche but passionate audience â€” coin collecting is one of the world's most popular hobbies. But even casual travelers handle local coins every day. Turning that into a collectible experience is fun. Great photos of coins exist.

**Data:** Numista API (coin catalogue with high-quality photos, free registration).

---

## Lazarus Species

Animals and plants once thought extinct that were rediscovered alive. A curated quest showing what they are and where to see them.

Incredible stories: a fish extinct for 66 million years found in 1938, an insect found on an ocean rock after 80 years, a tree known only from dinosaur-era fossils discovered in a canyon in 1994. ~350 documented species, 13+ viewable in zoos/sanctuaries worldwide.

No competing app has anything like this. Could work as a separate collectible quest with progress tracking.

**Data:** Wikidata + Wikipedia (Lazarus taxon article has a comprehensive list). IUCN Red List for status. Wikidata properties link species to zoos.

---


## Intangible Heritage

Traditional crafts, performing arts, rituals, oral traditions â€” the living culture of a place.

Deeper than monuments and museums. "This region has a 500-year tradition of X" adds meaning that a guidebook doesn't capture. UNESCO maintains official lists of intangible heritage.

**Data:** Wikidata (intangible cultural heritage items with region links).

---


## Soundscapes (future)

Ambient sounds of a region â€” markets, nature, cityscapes, religious calls, street music.

A "multi-sensory profile" of a place. Nobody does this. Could be incredibly evocative â€” hearing a Tokyo train station or a Marrakech souk before you visit.

**Data:** Freesound.org API, BBC Sound Effects archive. Needs curation.

---

## Podcasts (future)

Podcasts about or from the region.

Growing medium, lots of travel/culture/history podcasts organized by place. Could filter by region tags.

**Data:** Podcast Index API (free, open).

---

## Architecture

Distinctive architectural styles and iconic buildings of the region. Not just UNESCO sites — the characteristic look and feel of a place.

Architecture defines a city's visual identity. Prague's Gothic spires, Dubai's futuristic towers, Barcelona's Gaudí — these are as much a destination as any museum. "Architectural tourism" is a real niche: people visit to see specific buildings or styles.

This is broader than monuments. It includes:
- Architectural styles dominant in the region (Art Nouveau in Riga, Bauhaus in Tel Aviv)
- Iconic modern buildings (Sydney Opera House, Burj Khalifa)
- Historic structures (medieval castles, colonial architecture)
- Urban planning patterns (grid streets vs organic medieval layouts)

**Data:** Wikidata (architectural style property, architect property), Wikipedia for descriptions and context, Wikimedia Commons for images.

---

## Art (Specific Artworks)

Individual works of art you can see in the region — paintings, sculptures, installations. Not just "visit the Louvre" but "see the Mona Lisa."

People travel specifically to see certain artworks. The David in Florence, Guernica in Madrid, The Scream in Oslo. Knowing what masterpieces are where adds depth to museum visits and creates collecting motivation.

Could be organized by:
- Medium (paintings, sculptures, installations, murals)
- Period (Renaissance, Impressionism, Contemporary)
- Artist (all Rembrandts in Amsterdam, all Picassos in Barcelona)

**Gamification angle:** "Collected 10 Impressionist masterpieces across 5 countries"

**Data:** Wikidata (location property for artworks, linking to museums), museum APIs where available (many major museums have open data), Wikimedia Commons for images.

---

## Markets

Traditional markets, bazaars, food halls — places where locals shop and eat. Not just shopping, but cultural experience.

Markets are where you see real daily life. They're atmospheric, photogenic, and food-centric — perfect travel content. Grand Bazaar in Istanbul, La Boqueria in Barcelona, Tsukiji in Tokyo — these are destinations in themselves.

Could include:
- Food markets (produce, seafood, street food)
- Flea markets and antiques
- Craft markets
- Historic covered markets
- Night markets

**Data:** Wikidata (market type property), OpenStreetMap (marketplace tags), curated lists from travel sites.

---

## Entertainment Venues

Historic theaters, concert halls, opera houses, cinemas — cultural venues worth visiting for the building itself, not just performances.

La Scala in Milan, Sydney Opera House, Palais Garnier in Paris — these are architectural landmarks. Even if you don't attend a show, many offer tours. Adds cultural depth beyond museums.

Different from Festivals category — this is about the venues, not events. Though could link: "See a performance at this historic theater."

**Data:** Wikidata (venue type, architect, opening date), official venue websites for tour information.

---

## Historical Events

Places where significant historical moments happened. Battle sites, treaty signings, revolutions, independence declarations.

"This is where X happened" makes random locations memorable. Assassination of Archduke Franz Ferdinand in Sarajevo, Fall of the Berlin Wall, Signing of the Declaration of Independence in Philadelphia. Historical tourism is huge.

Could be marked on the map with context:
- What happened
- When
- Why it mattered
- What's there now (memorial, museum, just a plaque)

**Data:** Wikidata (location of historical event property), Wikipedia for detailed context.

---

## Famous Locals' Places

Houses, studios, graves of notable people. Literary houses, artists' workshops, birthplaces of scientists.

"Shakespeare's birthplace", "Anne Frank House", "Frida Kahlo Museum" — these are pilgrimage sites for fans. Connects Notable People category to physical locations.

Could include:
- Birth houses
- Former residences
- Studios and workshops
- Graves and memorials
- Museums dedicated to the person

**Overlap with museums:** Some are museums (Anne Frank House), some are just marked buildings. Both are worth noting.

**Data:** Wikidata (residence property, work location property, place of burial), linking back to Notable People entries.

---

## Iconic Transport

Legendary transportation unique to the region. Not just "how to get around" but culturally significant ways to travel.

Transport can be an experience in itself. Tokyo Metro's efficiency, San Francisco's cable cars, Venice's gondolas, the Trans-Siberian Railway. These aren't just practical — they're bucket-list experiences.

Could include:
- Historic trains and trams
- Cable cars and funiculars
- Ferries and water buses
- Unique metro systems (Moscow's palace stations, Stockholm's art gallery)
- Scenic routes (coastal trains, mountain railways)

**Gamification:** "Rode 15 iconic transport systems across 10 countries"

**Data:** Wikidata (public transport route property), Wikipedia for history and context, OpenStreetMap for routes.

---

## Bridges & Engineering Marvels

Notable bridges, tunnels, dams, and other engineering achievements worth visiting.

Some structures transcend function and become landmarks. Golden Gate, Tower Bridge, Sydney Harbour Bridge, Millau Viaduct. Engineering enthusiasts travel specifically to see these.

Not just bridges — includes:
- Historic and modern bridges
- Tunnels (Channel Tunnel, Gotthard Base Tunnel)
- Dams and locks (Hoover Dam, Panama Canal)
- Aqueducts and viaducts

**Data:** Wikidata (bridge/tunnel/dam properties with location), Structurae database (engineering structures), Wikipedia for context.

---

## Regional Drinks

Local beverages with geographical identity — wines, beers, spirits, tea, coffee. What you drink defines where you are.

Wine regions, whisky distilleries, coffee cultures — drinks are deeply tied to place. Champagne can only come from Champagne. Visiting a Scottish distillery or a Napa winery is an experience, not just consumption.

Could include:
- Wine regions with specific varietals
- Distilleries (whisky, cognac, rum)
- Beer traditions and breweries
- Tea and coffee cultures
- Protected designation drinks (like GI foods)

**Overlap with Food:** Similar to Regional Food but focused on beverages. Could combine or keep separate.

**Data:** Wikidata (origin region, beverage type), wine/spirits databases, protected designation registries.

---

## Food Experiences

Culinary processes and traditions to participate in, not just dishes to eat. The experience of preparing, learning, or witnessing food culture.

Different from Regional Food (what to eat) — this is about doing: tea ceremony in Japan, wine tasting in Tuscany, cooking class in Thailand, truffle hunting in Piedmont, olive oil pressing in Greece.

Examples:
- Cooking classes and workshops
- Traditional food preparation processes
- Market tours with local chefs
- Wine/beer/spirits tastings
- Food festivals (overlap with Festivals category)
- Farm visits and foraging

**Data:** Harder to automate — mostly curated content, tour operator websites, local tourism boards.

---

## Hiking Trails & Walks

Famous walking routes and hiking trails — from multi-day treks to city walks.

Trail tourism is huge. Camino de Santiago, Inca Trail, Appalachian Trail, Cinque Terre coastal walk. People plan entire trips around these routes.

Could include:
- Long-distance hiking trails
- Pilgrimage routes
- Urban walking routes (Freedom Trail in Boston, City walls in Dubrovnik)
- Nature walks and national park trails
- Difficulty levels and time estimates

**Gamification:** "Walked 100km of famous trails", "Completed 5 multi-day treks"

**Data:** OpenStreetMap (hiking routes), Wikidata (trail properties), AllTrails API (if available), Wikipedia for famous routes.

---

## Beaches & Swimming Spots

Notable beaches, swimming holes, thermal baths — places to swim and relax by water.

Beach tourism is massive. Some beaches are destinations (Copacabana, Bondi, Maya Bay). Also includes: hidden coves, lake swimming, river spots, hot springs, public pools.

Could include:
- Ocean beaches (sandy, rocky, surf spots)
- Lakes and rivers
- Natural swimming holes
- Thermal baths and hot springs
- Historic public baths

**Seasonality matters:** Some only accessible/pleasant certain times of year.

**Data:** Wikidata (beach property, swimming area), OpenStreetMap (beach/swimming tags), Blue Flag beach database.

---

## Viewpoints & Panoramas

Places with legendary views — observation decks, mountain peaks, lookout points.

Views are Instagram currency. Empire State Building, Eiffel Tower summit, Table Mountain, Christ the Redeemer. People travel for that specific vista.

Could include:
- Urban observation decks (skyscrapers, towers)
- Natural viewpoints (mountain peaks, cliff edges)
- Sunset/sunrise spots
- 360° panoramas
- Difficulty to reach (walk-up vs cable car)

**Data:** Wikidata (viewpoint property), OpenStreetMap (viewpoint tags), user-contributed data.

---

## Seasonal Phenomena

Natural events tied to specific times of year — worth planning trips around.

Cherry blossoms in Japan, Northern Lights in Iceland, autumn foliage in New England, monarch butterfly migration in Mexico, midnight sun in Norway. These define travel windows.

Could include:
- Floral blooms (cherry blossoms, tulips, lavender)
- Animal migrations and breeding seasons
- Aurora borealis/australis
- Seasonal light phenomena (midnight sun, polar night)
- Fall foliage
- Seasonal weather events (monsoons, harmattan)

**Critical feature:** Calendar integration. "Best time to see this: March-April"

**Data:** Wikidata, scientific databases for migration patterns, tourism boards for bloom forecasts, aurora forecast services.

---

## Neighborhoods & Districts

Characteristic areas within cities — places with distinct identity and atmosphere.

SoHo in NYC, Le Marais in Paris, Shibuya in Tokyo. Neighborhoods tell stories. Walking Trastevere in Rome feels different than the Vatican area. This adds granularity to city exploration.

Could include:
- Historic districts (Old Towns, medinas)
- Cultural neighborhoods (Chinatowns, Little Italy)
- Nightlife districts
- Shopping areas
- Emerging/gentrifying areas
- Residential character zones

**Data:** OpenStreetMap (neighborhood boundaries), Wikipedia, local tourism designations.

---

## Street Art & Murals

Cities and areas known for street art — murals, graffiti, public art installations.

Street art tourism is real. Wynwood Walls in Miami, Shoreditch in London, Valparaíso in Chile. People take walking tours to see specific works by famous artists (Banksy, Shepard Fairey).

Could include:
- Specific famous murals
- Street art districts
- Legal walls and art zones
- Works by known artists
- Street art festivals

**Challenge:** Ephemeral — street art comes and goes. Needs community updates.

**Data:** User-contributed + curated lists, Instagram geotagging (with permission), street art databases.

---

## Cemeteries

Historic cemeteries worth visiting as cultural/architectural sites.

Cemetery tourism is real. Père Lachaise in Paris (Jim Morrison, Oscar Wilde), Recoleta in Buenos Aires (Eva Perón), Highgate in London. Beautiful sculptures, famous graves, peaceful atmosphere.

Could include:
- Historic cemeteries
- Notable burials (links to Famous People)
- Architectural significance
- Cultural practices (Day of the Dead celebrations)

**Note:** Requires respectful framing — these are active burial grounds, not just tourist attractions.

**Data:** Wikidata (cemetery property, burials), Wikipedia, Find a Grave database.

---

## Historic Hotels & Restaurants

Legendary establishments with history — where staying/eating is part of the experience.

Raffles in Singapore, Harry's Bar in Venice, The Plaza in NYC. Some places aren't just businesses — they're institutions. Even if you don't stay/eat there, many offer tours.

Could include:
- Historic hotels (often 100+ years old)
- Legendary restaurants and cafes
- Where famous events happened (treaties signed, celebrities stayed)
- Still operating vs now museums

**Data:** Wikidata (historic hotel/restaurant properties), curated lists, tourism board designations.

---

## Universities & Libraries

Notable universities and libraries open to visitors — architectural and cultural landmarks.

Oxford, Harvard, Trinity College Dublin's library, Coimbra. University tourism is huge — campus tours, historic libraries, architectural significance. Often free or cheap to visit.

Could include:
- Historic university campuses
- Notable libraries (especially historic reading rooms)
- Whether tours available
- Visitor access restrictions

**Data:** Wikidata (university/library properties), official websites for tour information.

---

## Observatories & Planetariums

Places for stargazing and astronomy — observatories, planetariums, dark sky parks.

Astro-tourism niche. Mauna Kea in Hawaii, Kitt Peak in Arizona, dark sky reserves. For enthusiasts and casual visitors alike.

Could include:
- Professional observatories with visitor programs
- Planetariums
- Dark sky parks and reserves
- Best stargazing locations
- When to visit (moon phases, meteor showers)

**Data:** Wikidata (observatory/planetarium properties), International Dark-Sky Association designations.

---

## Regional Sports & Games

Traditional sports and games you can watch or participate in locally.

Sumo in Japan, Gaelic football in Ireland, pelota vasca in Basque Country, kabaddi in India. Sports define culture. Watching a local match is immersive.

Could include:
- Traditional sports unique to region
- Where to watch (stadiums, venues)
- Major events and seasons
- Whether you can participate (classes, amateur games)

**Overlap with Festivals:** Some sporting events are festivals. Could link.

**Data:** Wikidata (sport origin property), Wikipedia, local sports federation websites.

---

## Gamification Ideas

Achievements that cross categories:
- "Visited a region with population under 100K"
- "Been to a country with 10+ UNESCO sites"
- "Collected all Eurozone coins"
- "Saw a Lazarus species" (visited a zoo that has one)
- "Lazarus Hunter" â€” saw N species from the list
- Progress bars, maps with pins, collectible stamps

The "changes since visit" delta tracking is itself a form of engagement â€” a reason to come back and check on "your" regions.
