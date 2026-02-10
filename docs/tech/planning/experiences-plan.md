# PROPOSED EXPERIENCE CATEGORIES

Ideas for regional experience layers. Each category is something a user can discover about a region they're exploring.

---

## Books

Stories set in this place. Fiction, non-fiction, poetry — anything where the region is the backdrop.

Literary tourism is real: people visit Edinburgh for Harry Potter, St. Petersburg for Dostoyevsky, Tokyo for Murakami. Showing "books set here" gives a region cultural depth and a reason to read before traveling.

Could also include school reading lists by region — what do local kids read? Unique content nobody else has.

**Data:** Wikidata (narrative location property), Wikipedia for descriptions.

---

## Films

Movies set in or filmed in the region. Two distinct angles:
- "The story takes place here" (narrative location)
- "They physically filmed here" (filming location)

Both are interesting. New Zealand after LOTR, Dubrovnik after Game of Thrones — film locations drive tourism.

**Data:** Wikidata (narrative + filming location properties). Could enrich with TMDB for posters and ratings.

---

## Regional Food

Traditional dishes, drinks, and protected regional products.

Food is the #1 travel experience for most people. Knowing the local specialties before arriving helps avoid tourist traps. GI-protected products (like Champagne, Parmigiano, Scotch whisky) are especially interesting — they literally can't exist anywhere else.

**Data:** Wikidata (country of origin, GI status). OpenFoodFacts for packaged products.

---

## Festivals & Events

Recurring cultural events — festivals, carnivals, religious celebrations, seasonal traditions.

Timing a visit around a major festival is a huge travel driver. "What's happening when I'm there?" is one of the most common trip-planning questions.

**Data:** Wikidata (festivals with location and dates). Web search for current year schedules since dates shift annually.

---

## Notable People

Famous people born in or associated with the region — writers, scientists, artists, athletes, rulers.

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

Niche but passionate audience — coin collecting is one of the world's most popular hobbies. But even casual travelers handle local coins every day. Turning that into a collectible experience is fun. Great photos of coins exist.

**Data:** Numista API (coin catalogue with high-quality photos, free registration).

---

## Lazarus Species

Animals and plants once thought extinct that were rediscovered alive. A curated quest showing what they are and where to see them.

Incredible stories: a fish extinct for 66 million years found in 1938, an insect found on an ocean rock after 80 years, a tree known only from dinosaur-era fossils discovered in a canyon in 1994. ~350 documented species, 13+ viewable in zoos/sanctuaries worldwide.

No competing app has anything like this. Could work as a separate collectible quest with progress tracking.

**Data:** Wikidata + Wikipedia (Lazarus taxon article has a comprehensive list). IUCN Red List for status. Wikidata properties link species to zoos.

---

## Regional Profile ("Passport")

A composite card with key facts and numbers about the region — a quick snapshot before you visit.

Sections: basics (flag, population, languages, currency), climate (best month to visit), economy (rough cost level), nature (species count, protected areas), culture (UNESCO sites, museums).

Killer feature: **"changes since your visit"** — if you mark when you visited, the app shows what changed: population grew 1.1%, a new UNESCO site was added, average temperature rose 0.3°C. Makes you feel connected to places you've been.

**Data:** Wikidata + REST Countries (basics), Open-Meteo (climate), World Bank API (economy/demographics), GBIF (nature), all free.

---

## Intangible Heritage

Traditional crafts, performing arts, rituals, oral traditions — the living culture of a place.

Deeper than monuments and museums. "This region has a 500-year tradition of X" adds meaning that a guidebook doesn't capture. UNESCO maintains official lists of intangible heritage.

**Data:** Wikidata (intangible cultural heritage items with region links).

---

## Cost Context

Not a full price database, but enough to understand "is it expensive here?"

A few smart indicators: GDP per capita (proxy for price level), currency + exchange rate, average local salary. Enough to calibrate expectations without building a Numbeo clone.

**Data:** World Bank API (GDP, salaries), free currency APIs. We explicitly skip Numbeo ($500+/month API) — overkill for this.

---

## Soundscapes (future)

Ambient sounds of a region — markets, nature, cityscapes, religious calls, street music.

A "multi-sensory profile" of a place. Nobody does this. Could be incredibly evocative — hearing a Tokyo train station or a Marrakech souk before you visit.

**Data:** Freesound.org API, BBC Sound Effects archive. Needs curation.

---

## Podcasts (future)

Podcasts about or from the region.

Growing medium, lots of travel/culture/history podcasts organized by place. Could filter by region tags.

**Data:** Podcast Index API (free, open).

---

## Gamification Ideas

Achievements that cross categories:
- "Visited a region with population under 100K"
- "Been to a country with 10+ UNESCO sites"
- "Collected all Eurozone coins"
- "Saw a Lazarus species" (visited a zoo that has one)
- "Lazarus Hunter" — saw N species from the list
- Progress bars, maps with pins, collectible stamps

The "changes since visit" delta tracking is itself a form of engagement — a reason to come back and check on "your" regions.