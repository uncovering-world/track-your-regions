# REGIONAL PROFILE ("Passport")

A comprehensive snapshot of a region — key facts, cultural context, and practical information. Not experiences to collect, but knowledge to understand a place before and after visiting.

---

## Region Types & Data Availability

Not all regions are countries or administrative units. The app supports multiple region types, and profile data varies by type.

### Region Types:

**1. Countries**
Full sovereign states (France, Japan, Brazil).
- **Data availability:** Complete — all profile sections applicable
- **Sources:** Official statistics, international databases

**2. Administrative Subdivisions**
States, provinces, regions within countries (California, Bavaria, Tuscany).
- **Data availability:** Most sections available
- **Sources:** National statistics, regional government data
- **Limitations:** Some economic data only at national level

**3. Cultural Regions**
Areas defined by culture/history, not admin borders (Balkans, Patagonia, Scottish Highlands).
- **Data availability:** Limited to geography, culture, nature
- **No hard data for:** Population (overlaps countries), GDP, governance
- **Focus on:** Cultural context, landscape, shared traditions, languages

**4. Trans-national Regions**
Macro-regions spanning multiple countries (Eastern Europe, Mediterranean, Scandinavia).
- **Data availability:** Aggregated or comparative
- **Approach:** "Countries in this region include..." with links to individual country profiles
- **Useful for:** Climate patterns, shared cultural traits, comparative costs

**5. Cities**
Major urban areas (Paris, Tokyo, New York).
- **Data availability:** Urban-specific data
- **Sources:** City government statistics
- **Focus on:** Population density, cost of living, neighborhoods, local transport

**6. Natural Regions**
Defined by geography/ecology (Amazon Rainforest, Sahara Desert, Alps).
- **Data availability:** Nature, climate, seasonal phenomena
- **No data for:** Governance, economy (unless overlap with admin region)
- **Focus on:** Biodiversity, protected areas, best seasons to visit

### Adaptive Profile Display:

The profile shows **only relevant sections** for each region type:

**Country profile shows:**
All sections — complete passport.

**Cultural region profile (e.g., "Provence") shows:**
- Geography & Climate ✓
- Culture & Society ✓ (language, traditions, cuisine)
- Nature & Environment ✓
- Cultural Wealth ✓
- ~~Governance~~ (irrelevant — use France's profile)
- ~~Economy~~ (use France's data, note "part of France")

**Trans-national region profile (e.g., "Balkans") shows:**
- List of countries included
- Shared cultural traits (Orthodox Christianity, Ottoman influence, etc.)
- Climate overview (Mediterranean coast vs mountain interior)
- ~~Single currency/language~~ (varies by country)
- Link to individual country profiles for detailed data

**City profile (e.g., "Berlin") shows:**
- Urban population & area
- Neighborhoods & districts ✓
- Local climate (micro-climate variations)
- Cost of living (city-specific, not national average)
- Transport (city metro, not national rail)
- Link to country profile (Germany) for visa, currency, national context

### Handling Ambiguity:

Some regions overlap or nest:
- "Tuscany" is both an administrative region (Toscana) and cultural region
- "The Alps" spans multiple countries — profile aggregates or compares
- "Silicon Valley" is cultural/economic, not administrative — profile focuses on tech culture, no governance data

**Solution:** Tag each region with type(s), show appropriate data, link to related regions.

### Data Source Strategy by Region Type:

| Region Type | Population | Economy | Culture | Nature | Governance |
|------------|-----------|---------|---------|--------|-----------|
| Country | Census | World Bank | Wikidata | GBIF | Wikidata |
| Admin subdivision | Regional stats | Regional stats | Wikidata | GBIF | Wikidata |
| Cultural region | N/A or estimate | N/A | Curated | GBIF | N/A |
| Trans-national | Aggregated | Comparative | Curated | GBIF | N/A |
| City | City census | Local data | Wikidata | Urban biodiversity | City govt |
| Natural region | N/A | N/A | N/A | GBIF, IUCN | Protected area status |

---

## Concept

The Regional Profile is a one-stop reference card for understanding a region at a glance. Think of it as a "passport" — a condensed identity document for a place.

**Different from experiences:** You don't "collect" facts like you collect UNESCO sites. But understanding a region's basics (climate, languages, customs) enriches all experiences there. It's the context layer beneath everything else.

**Dynamic element:** "Changes since your visit" — if you mark when you visited, the profile shows what changed: population grew, new UNESCO site added, average temperature shifted. Makes you feel connected to places you've been.

---

## Profile Sections

### Basics

Core identification facts:

- **Official name(s)** (local language + English)
- **Flag and coat of arms**
- **Capital/major city**
- **Population** (with growth trend)
- **Area** (km²)
- **Languages** (official + widely spoken)
- **Currency** (with current exchange rate)
- **Time zone(s)**
- **Calling code**
- **Internet TLD**

**Data sources:** Wikidata, REST Countries API (free), World Bank API.

### Geography & Climate

Understanding the physical environment:

- **Latitude/longitude** (affects daylight hours, seasons)
- **Terrain type** (mountainous, coastal, desert, etc.)
- **Climate zone** (Mediterranean, tropical, continental)
- **Average temperatures** by month
- **Precipitation patterns**
- **Best month to visit** (balance of weather, crowds, prices)
- **Natural hazards** (earthquakes, typhoons, etc.)

**Why this matters:** Knowing Japan has typhoon season July-October or that Iceland is dark in winter helps planning.

**Data sources:** Open-Meteo API (free weather data), Wikidata (geography), Köppen climate classifications.

### Economy & Cost

Practical financial context:

- **GDP per capita** (rough wealth indicator)
- **Average salary** (local purchasing power)
- **Cost level index** (relative to global average)
- **Typical costs** (meal, coffee, hotel night — ranges)
- **Currency notes** (is bargaining common? tipping expected?)

**Why this matters:** Sets expectations. "Expensive like Switzerland or cheap like Vietnam?"

**Note:** We're NOT building Numbeo (costs $500+/month API). Just rough indicators to calibrate expectations.

**Data sources:** World Bank API (GDP, salaries), user-contributed typical costs (simplified), general travel guides.

### Culture & Society

Social context and norms:

- **Religions** (major faiths and percentages)
- **Ethnic composition** (if relevant and available)
- **Public holidays** (major national holidays)
- **Social etiquette basics** (greetings, dress codes, taboos)
- **Superstitions and beliefs** (common local beliefs that affect behavior)
- **Gender norms** (conservative vs liberal, safety considerations)

**Examples:**
- Japan: Remove shoes indoors, bow when greeting, public quietness
- India: Use right hand for eating, avoid pointing feet at people
- Middle East: Conservative dress in some regions, Ramadan fasting hours

**Data sources:** Wikipedia (culture sections, etiquette articles), curated content, Locals' Perspective UGC.

### Governance & Law

Practical legal context (not political commentary):

- **Government type** (democracy, monarchy, etc.)
- **Administrative divisions** (how country is subdivided)
- **Visa requirements** (for major nationalities — link to official sources)
- **Unusual laws tourists should know** (e.g., Singapore gum ban, Germany Sunday quiet laws)
- **Safety notes** (official travel advisories, if any)

**Why this matters:** Avoiding legal trouble, knowing entry requirements.

**Data sources:** Wikidata (government type), official foreign ministry sites (visa), curated lists of unusual laws.

### Nature & Environment

Ecological snapshot:

- **Species count** (mammals, birds, plants — from GBIF)
- **Endemic species** (unique to this region)
- **Protected areas** (national parks, reserves)
- **Biodiversity hotspots**
- **Environmental issues** (deforestation, pollution — factual, not political)

**Links to:** Wildlife category for specific species you can see.

**Data sources:** GBIF (species counts), IUCN (protected areas), Wikidata.

### Cultural Wealth

Quantified cultural assets:

- **UNESCO World Heritage Sites** (count + list)
- **Museums** (major institutions count)
- **Intangible heritage** (traditions, crafts on UNESCO list — count + links to experience category)
- **Languages spoken** (linguistic diversity)
- **Literary/artistic significance** (major authors, artists from region)

**Links to:** Books, Films, Art, Museums, Intangible Heritage categories for specific items.

**Data sources:** UNESCO APIs, Wikidata (museum count, notable people).

### Infrastructure & Connectivity

Practical travel info:

- **Internet penetration** (WiFi availability)
- **Mobile networks** (coverage, eSIM availability)
- **Transportation infrastructure** (rail/road quality, public transport)
- **Airports** (international gateways)
- **Power plugs** (voltage, socket type)
- **Tap water** (safe to drink or not)

**Data sources:** World Bank (internet/mobile stats), Wikidata, travel guides.

---

## "Changes Since Your Visit"

The killer feature — temporal comparison.

### How It Works:

1. User marks when they visited a region (e.g., "Summer 2019")
2. Profile calculates delta from visit date to now
3. Shows what changed:
   - Population grew 1.1%
   - New UNESCO site added (Specific Name, 2022)
   - Average temperature +0.3°C
   - Currency devalued 15% vs USD
   - New metro line opened
   - Major museum renovated

### Why This Matters:

- Makes you feel connected to "your" places
- Reason to check back ("What's new in Iceland?")
- Shows world isn't static
- Can be both fun (new attraction!) and sobering (climate change impact)

### Technical Requirements:

- Timestamped snapshots of key metrics
- Store visit date per user per region
- Calculate meaningful changes (not just "5 days passed")
- Threshold for significance (don't show "population +0.001%")

### Data Sources:

- Regular updates from APIs (quarterly or annually)
- User-contributed updates (new museums, closed attractions)
- News feeds for major changes

---

## Visual Design Principles

### Not a Wikipedia Page

The profile should be:
- **Scannable** — key facts immediately visible
- **Visual** — flag, photos, icons, charts
- **Comparative** — "More expensive than X, less than Y"
- **Contextual** — "Similar climate to Barcelona"

### Mobile-First

Most users will check this on the go:
- Collapsible sections
- Quick stats at top
- Detailed info on tap/expand
- Offline capability

### Personalization

Show different info based on:
- User's home country (compare to what they know)
- Visit history (emphasize changes if they've been there)
- Upcoming trip (practical info front and center)

---

## Gamification Integration

Even though profile is read-only, it feeds gamification:

### Achievements Related to Profile Knowledge:

- **Well-Researched Traveler** — read profiles of 20 regions before visiting
- **Return Visitor** — checked "changes since visit" for 5 places
- **Climate Adventurer** — visited regions in 5 different climate zones
- **Polyglot** — visited places where 10+ languages are spoken
- **High Altitude** — visited 3 regions above 2000m elevation

### Profile as Preparation:

Before a trip, app can suggest:
> "You're visiting Morocco in July. Profile shows average temp 35°C, Ramadan possible, conservative dress in some areas. Check the profile?"

After a trip, prompt to update visit date:
> "Welcome back from Japan! Mark your visit to track changes over time?"

---

## Data Privacy & User Control

Some profile data is sensitive or political:

### What We DON'T Include:

- Political opinions or commentary
- Controversial territorial claims
- Ethnic tensions or conflicts
- Detailed crime statistics (use official travel advisories instead)
- Subjective rankings ("best/worst")

### What We Frame Carefully:

- Government types (factual: "constitutional monarchy", not "oppressive regime")
- Religions (percentages, not commentary)
- Social norms (descriptive, not prescriptive: "common to..." not "you must...")

### User Control:

- Can hide/collapse any section
- Can report outdated/incorrect info
- Can contribute updates (moderated)

---

## Update Frequency

Different data ages differently:

### Real-time / Daily:
- Currency exchange rates
- Weather forecasts

### Weekly:
- Major news (new museum opens, bridge collapses)

### Monthly:
- Cost indicators (from user contributions)

### Quarterly:
- Economic data (GDP updates)

### Annually:
- Population figures
- Climate averages
- Species counts

### Ad-hoc:
- New UNESCO sites (added once official)
- Major political changes (new currency, name change)

---

## Integration with Other Features

### Links to Experiences:

Profile section "Cultural Wealth: 15 UNESCO sites" → links to UNESCO category with those 15 listed.

Profile section "Species count: 450 birds" → links to Wildlife category filtered to birds in this region.

### Links from Quiz:

Quiz teaches about a region → "Want to see the full profile?"

### Links from Locals' Perspective:

Profile gives official facts, Locals' Perspective gives lived reality:
> "Official language: French. Reality: In Marseille, even locals struggle with formality."

---

## Bootstrap Strategy

### Phase 1: Automated Data (Day 1)

Pull from free APIs to get basic coverage:
- REST Countries → basics, flags, languages
- World Bank → economic data
- Wikidata → culture, geography
- Open-Meteo → climate

**Result:** Every country has a basic profile from day one.

### Phase 2: Manual Curation (Month 1-3)

Review and enrich:
- Add context to dry facts
- Write "best month to visit" summaries
- Curate "unusual laws" lists
- Add photos and visual elements

**Focus on top 50-100 most-visited countries first.**

### Phase 3: Community Contributions (Ongoing)

Users with Deep Connection can:
- Suggest corrections to facts
- Update costs (meal prices, hotel ranges)
- Add local context to etiquette
- Report major changes

Moderation ensures quality.

---

## Examples

### Country Profile: Tokyo, Japan

**Type:** Country capital city  
**Basics:** Capital of Japan | Pop. 14M (metro: 37M) | JPY ¥ | GMT+9  
**Climate:** Humid subtropical | Hot summers, mild winters | Best: March-May, Sept-Nov  
**Cost:** High (similar to London) | Meal: ¥1000-3000 | Hotel: ¥8000-20000  
**Culture:** Buddhist/Shinto 70% | Remove shoes indoors | Bow greeting | Quiet in public  
**Nature:** 4 national parks nearby | 450 bird species | Cherry blossoms March-April  
**Cultural:** 2 UNESCO sites | 100+ major museums | Rich literary tradition  

**Changes since your visit (Summer 2019):**
- Population +1.2%
- New metro line: Toranomon Hills (2022)
- Average summer temp +0.4°C
- JPY weakened 15% vs USD

---

### Country Profile: Iceland

**Type:** Sovereign country  
**Basics:** Capital Reykjavik | Pop. 380K | ISK kr | GMT+0  
**Climate:** Subarctic | Cold, windy | Northern Lights Sept-March | Midnight sun June-Aug  
**Cost:** Very high | Meal: 3000-6000 kr | Hotel: 15000-30000 kr  
**Culture:** Lutheran 65% | Egalitarian society | Believe in elves (folklore)  
**Nature:** 3 national parks | 330+ bird species | Active volcanoes | Geothermal activity  
**Unusual:** Roads close in winter | Weather changes fast | Check safetravel.is  

**Changes since your visit (Winter 2020):**
- Tourism recovered post-COVID
- New volcanic activity: Fagradalsfjall (2021, 2023)
- ISK weakened 8% vs EUR
- Ice cave access changed (climate impact)

---

### Cultural Region Profile: Provence, France

**Type:** Cultural/historical region (also administrative: Provence-Alpes-Côte d'Azur)  
**Location:** Southeast France | Mediterranean coast  
**Languages:** French (official), Provençal (regional)  
**Climate:** Mediterranean | Hot dry summers, mild winters | Best: May-June, Sept-Oct  
**Culture:** Lavender fields (June-July) | Roman heritage | Wine regions | Outdoor markets  
**Nature:** Calanques National Park | Mediterranean flora | 300+ days of sun/year  
**Notable:** Aix-en-Provence, Avignon, Marseille | Mistral wind | Bouillabaisse, ratatouille  

**For administrative data:** See France country profile  
**Related regions:** French Riviera, Camargue

---

### Trans-national Region Profile: The Balkans

**Type:** Trans-national cultural/geographic region  
**Countries included:** Albania, Bosnia & Herzegovina, Bulgaria, Croatia, Greece, Kosovo, Montenegro, North Macedonia, Romania, Serbia, Slovenia  
**Geography:** Balkan Peninsula | Adriatic & Black Sea coasts | Dinaric Alps  
**Climate:** Mediterranean coast, continental interior | Best: May-June, Sept-Oct  
**Shared culture:** Orthodox Christianity & Islam | Ottoman influence | Slavic languages (except Greek, Albanian, Romanian) | Balkan cuisine (ćevapi, burek, baklava)  
**History:** Ottoman Empire legacy | Yugoslav wars (1990s) | Complex ethnic mosaic  
**Nature:** Diverse — Mediterranean to alpine | Plitvice Lakes, Durmitor, Rila  

**Note:** Each country has distinct identity. See individual country profiles for governance, economy, visas.  
**Common traits:** Hospitality culture, coffee culture, slower pace, affordable travel

---

### Natural Region Profile: The Amazon Rainforest

**Type:** Natural/ecological region  
**Spans:** 9 countries (Brazil, Peru, Colombia, Venezuela, Ecuador, Bolivia, Guyana, Suriname, French Guiana)  
**Area:** ~5.5 million km² (declining due to deforestation)  
**Climate:** Tropical rainforest | Hot & humid year-round | Wet season varies by location  
**Biodiversity:** 10% of world's species | 40,000 plant species | 1,300 bird species | Jaguars, pink dolphins, anacondas  
**Indigenous:** 400+ indigenous groups | Many uncontacted tribes  
**Threats:** Deforestation, climate change, fires  
**Visit:** Accessible via Manaus (Brazil), Iquitos (Peru), Puerto Maldonado (Peru)  

**For travel logistics:** See individual country profiles  
**Best time:** Dry season for trekking (varies by region), wet season for boat access

---

### City Profile: Berlin, Germany

**Type:** City (also state: Berlin)  
**Population:** 3.7M city | 6M metro  
**Location:** Northeast Germany | Spree River  
**Climate:** Temperate continental | Cold winters, warm summers | Best: May-Sept  
**Cost:** Moderate (cheaper than Munich/Hamburg) | Meal: €8-20 | Hotel: €60-150  
**Language:** German (English widely spoken in central areas)  
**Transport:** Excellent — U-Bahn, S-Bahn, trams, buses | 24hr on weekends  
**Neighborhoods:** Mitte (center), Kreuzberg (multicultural), Prenzlauer Berg (trendy), Friedrichshain (nightlife)  
**Culture:** Museum Island (UNESCO) | Street art | Techno clubs | History (Wall, WWII)  
**Unusual:** No official closing time for clubs | Honor system on public transport  

**For country-level data:** See Germany profile (visa, currency, national context)

---

## Summary

Regional Profile is:
- **Foundational knowledge** layer for all experiences
- **Practical preparation** tool before trips
- **Context provider** during trips  
- **Nostalgia trigger** after trips (via "changes since visit")
- **Not competitive** with experiences — it's the backdrop, not the content

It turns raw geographic data into useful, engaging travel intelligence.
