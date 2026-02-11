# QUIZ SYSTEM & REGION CONNECTION MODEL

The quiz is the core interaction mechanic of the app. It serves as onboarding, post-trip journaling, and standalone entertainment — all through one unified format.

---

## Three Use Cases

The quiz is a single mechanic that serves three different scenarios. Same card types, same round format, but different context, goals, and system behavior.

### 1. Onboarding: Reconstruct the Past

Users arrive with years of travel history — regions, UNESCO sites, museums, specific artworks, dishes, festivals. We need to help them bring all of that into the app without it feeling like data entry.

During onboarding, the quiz runs broad survey rounds covering many regions quickly. The goal is to rapidly build a map of "where the user has been" and at what depth. Focus on recognition, not detail. The system asks just enough questions to form a hypothesis, then asks the user to confirm.

### 2. During / Right After a Trip: Capture While Fresh

The user just returned from a trip (or is still on one). Memories are vivid, emotions are alive. This is the ideal moment to capture maximum detail — the quiz works here as guided reflection.

Rounds in this mode are detailed and deep, focused on a single region. Heavy on sensory and emotional questions. The goal is not to determine "were you there" but to record depth: what exactly did you see, taste, remember. This is both useful (data in the profile) and enjoyable (the user relives the trip).

The system can suggest this mode automatically when it detects a fresh check-in.

### 3. Just for Fun: Entertainment and Discovery

No utilitarian purpose. The user wants to play, learn something new, kill ten minutes. The quiz here is full-fledged content, not a tool.

Rounds in this mode are thematic and unexpected: "Where Was Bond Filmed", "Volcanoes You Can Climb", "Products You Can't Take Out of the Country." A mix of familiar and unfamiliar places. The goal is to entertain and incidentally broaden horizons. If the system learns something new about the user along the way (turns out they've been to Iceland) — great, data updates in the background.

---

## Input Methods

The quiz is the primary recommended path, but not the only one. Both methods lead to the same result — populating the region connection model.

### Manual Input

The classic approach. Map, lists, checkboxes.

The user opens a region, sees everything in it (UNESCO sites, museums, dishes, etc.) and marks what they've seen, tried, or visited. Can indicate an approximate year.

This should work fast and frictionlessly — not a form with 20 fields, but more like a checklist with filters. Marked ten places in a minute — done. Don't want to go deeper — don't have to.

**Why this matters:**
- Some people don't enjoy games and quizzes — they just want to check things off and move on
- For experienced travelers with 50+ regions, the quiz may be too slow
- Manual input is the fallback when the quiz doesn't cover a specific experience
- It's the only way to add something very specific ("I was at this particular restaurant in 2017")

### Quiz (Primary Recommended Path)

Instead of "mark where you've been" — a series of cards that simultaneously entertain and help reconstruct travel history. Works across all three use cases: onboarding, post-trip, and just for fun. Described in detail below.

---

## Data Import (Supplementary)

The quiz is the primary onboarding method, but traditional import can accelerate it — especially for experienced travelers with 30+ regions.

### Priority 1: Smart Manual Input

Show a map. Let the user tap regions and select approximate year. Most people have visited 10-30 regions, not 300 — this takes 2-3 minutes. Pre-populates regions for targeted quiz rounds.

### Priority 2: Google Takeout

User uploads Location History JSON from takeout.google.com. We parse coordinates, map to regions, and show: "We found these trips — confirm?" This seeds region-level data; the quiz then fills in granular experiences within each region.

### Priority 3: Photo GPS

"Upload photos from a trip — we'll figure out where it was." Not a primary onboarding flow, but a way to add specific trips later. Works best when the user selects a specific album rather than granting full library access.

### What We Don't Do

- **Browser extensions** — fragile (sites change markup), creepy (reads data on third-party sites), high trust barrier
- **Email parsing** — powerful in theory (booking confirmations), but the privacy cost outweighs the benefit
- **Always-on location tracking** — not our model; we respect that travel is something you reflect on, not something that's passively logged

---

## How the Quiz Works

### Rounds

A round is 5–7 cards grouped by theme. After answering, the system shows its inferences.

**Round grouping strategies:**

- **Geographic** — "Southern France", "The Baltics", "Kyoto & Nara"
- **Thematic** — "UNESCO Sites in Danger", "GI-Protected Products"
- **Unexpected** — "Where Bond Was Filmed", "Cities Under 50K With World Heritage", "Volcanoes You Can Climb"

### Card Types

Different question types test different kinds of knowledge. The ratio of correct answers across types is what distinguishes an erudite non-visitor from an actual traveler.

#### Factual

Knowledge that can be acquired from books, films, Wikipedia.

> "In which century was Notre-Dame built?"
> "What river runs through Florence?"

**Purpose:** Detects general awareness. High factual scores without sensory ones → well-read but hasn't visited.

**Generation:** Easily automated from Wikidata — dates, locations, counts, relationships.

#### Sensory

Things you can only know from being physically present. How a place looks, sounds, smells, feels up close.

> "What do you hear first when exiting the metro at Sacré-Cœur?"
> "Is the floor in the Uffizi Gallery marble or parquet?"
> "What color is the water in the Blue Grotto?"

**Purpose:** The strongest signal of physical presence. Cannot be quickly googled. A confident answer almost certainly means the person was there.

**Generation:** Hard to automate. Best questions come from curators and users.

#### Spatial

Understanding of how a place is laid out — what's next to what, how you move through it.

> "Is the David at the end of a long corridor or in a separate hall?"
> "When you exit the Colosseum, which direction is the Forum?"
> "At Machu Picchu, do you climb up or down to reach the Sun Gate?"

**Purpose:** People who navigated a place remember its layout. Hard to fake even from photos.

**Generation:** Partially automatable from map data (relative positions of landmarks). Best questions come from curators.

#### Emotional

Questions with no objectively correct answer. The signal is whether the user has an answer at all.

> "Was the David bigger or smaller than you expected?"
> "Did the Mona Lisa disappoint you?"
> "What surprised you most about Venice — the smell, the silence, or the scale?"

**Purpose:** Having any opinion is strong evidence of a visit. "I don't know" is an equally informative response. These questions make the quiz feel personal and reflective rather than test-like.

**Generation:** Can be templated ("Was X bigger/smaller/louder/quieter than expected?") but best when hand-crafted.

#### Food

Photos or descriptions of regional dishes — did the user try this on location.

> [Photo of cacio e pepe] "Did you try this in Rome?"
> "What's the traditional drink served with a Breton crêpe?"

**Purpose:** People remember food vividly. Strong proxy for "visited this region." Universal theme — everyone eats.

**Generation:** From Wikidata (regional dishes) + Commons photos. Curators enrich with knowledge of what's actually popular with locals vs. tourist-only.

#### GeoGuessr-Style

A photo from the region or near a landmark — the user guesses where it is.

> [Photo of a narrow street with blue-painted walls] "Where is this?"
> [Photo of a metro platform] "Which city's metro is this?"
> [Photo of a coastline] "Which country's coast?"

**Purpose:** Tests visual recognition. Even wrong answers are engaging — the reveal is always interesting. Works for both visited places (you recognize it) and new ones (you learn something).

**Photo sources:** Wikimedia Commons (geotagged), Mapillary (street-level imagery, open data), Flickr (Creative Commons with geotags).

**Mechanic variants:**
- **Zoom in** — start with a tight crop, reveal more on each wrong guess
- **Region-locked** — "This is somewhere in Tuscany. Which town?" (easier, tests granular knowledge)
- **Detail hunt** — "What language is the street sign in?" / "What side of the road are the cars on?"

### Round Results Screen

After a round — a narrative summary, not a score:

> "Looks like you've been to Florence and saw the David, but didn't make it to Siena. And you definitely saw the Leaning Tower — you knew about the tilt 😄"

Below, a structured list with actions:

- ✅ Florence — Uffizi — *confirm*
- ✅ Pisa — Tower — *confirm*
- 📖 Siena — Piazza del Campo — *read more*
- 📖 San Gimignano — *read more*

**Principles:**
- **Inference, not interrogation.** We don't ask "were you in Siena?" — we deduce from indirect signals and offer confirmation.
- **Wrong guesses are content.** "You described Barcelona so well we thought you lived there" is funny and memorable.
- **"Read more" instead of "want to visit."** Wishlists create obligation. A link to content is pure curiosity.

### Adaptiveness

The quiz behaves differently depending on the use case and what is already known about the user.

**During onboarding:**
- Broad rounds, many regions, quick questions
- Focus on recognition — "been / not been" matters more than details
- If early rounds reveal extensive European travel → more granular European rounds
- If light travel history → broad survey rounds, avoiding the "here are 100 places you haven't been" feeling

**After a trip:**
- Narrow rounds, single region, deep questions
- Heavy on sensory and emotional — memories are fresh, this is the moment to capture them
- System can suggest this mode automatically when it detects a fresh check-in

**Just for fun:**
- Thematic and unexpected rounds — "Where Bond Was Filmed", "Volcanoes", "Lazarus Species"
- Mix of familiar and unfamiliar places
- If the system learns something new about the user along the way — data updates in the background, but that's not the goal

---

## Region Connection Model

The result of the quiz (and manual input) is not binary "visited / not visited" but a spectrum of connection between the user and a place. This connection is alive — it changes over time.

### Connection States

| State | What it means | How it's detected |
|-------|--------------|-------------------|
| **Stranger** | No knowledge, no visit. Default. | No interaction |
| **Aware** | Never visited but knowledgeable. Has read about it, seen films, knows facts. | High factual, zero sensory |
| **Passed through** | Visited but remembers little. Transit, long ago, childhood. | Confirms visit but fails most sensory/spatial |
| **Explored** | Visited and remembers details. Knows how it smells, looks, is laid out. | High sensory + spatial |
| **Deep connection** | Lived there, returned, knows the non-obvious. | Consistently high across all types |

With manual input, the user sets an approximate level themselves. The quiz determines it automatically. Both paths feed the same model.

### Erudition vs. Experience Matrix

The key discriminator — the ratio of factual to sensory correct answers:

| | Low sensory | High sensory |
|---|---|---|
| **High factual** | Aware — well-read, hasn't been | Deep connection — been there, understands context |
| **Low factual** | Stranger or vague Passed through | Explored — been there, doesn't know the history |

### Decay

Connection states are not permanent. Memory fades, and the model reflects this honestly.

**Rates by state:**
- Deep connection → slowly degrades toward Explored (years)
- Explored → degrades toward Passed through (months to years)
- Passed through → stable (the fact of a visit doesn't fade)
- Aware → slow decay (book knowledge lasts longer than experiential memory)
- Stranger → no decay (floor state)

**Factors affecting decay speed:**
- Initial strength of sensory answers — vivid memories decay slower
- Time since last quiz interaction about this region
- Content consumption about the region (reading articles, browsing categories)

### Refresh Mechanic

When a connection level begins to drop, the system offers a "Refresh Your Memory" mini-round.

- Still remember → level restores
- Don't remember → level drops honestly + "here's what you've forgotten — revisit anytime"

A natural re-engagement loop. No push notifications, no guilt.

### Visual Representation

Connection levels are **never** shown as numbers or explicit labels. Instead — a visual metaphor on the map:

- **Vivid, saturated color** — deep connection, fresh memories
- **Muted, fading color** — older memories, decaying
- **Different hue** — Aware regions (distinguishes "know about" from "been to" without hierarchy)
- **Default map color** — Stranger regions

The result is a personalized world map that reflects the user's actual relationship with the planet. Beautiful, intuitive, no feeling of being graded.

---

## Content Pipeline

Quiz content flows through three tiers, each building on the previous one.

### Tier 1: Auto-Generated

The system generates questions from structured data.

**Sources:**
- Wikidata → factual questions (dates, locations, counts, relationships)
- Wikidata + Commons → food questions (regional dishes with photos)
- Commons / Mapillary / Flickr → GeoGuessr questions (geotagged photos near POIs)
- GBIF / iNaturalist → wildlife questions

**Quality:** Functional but generic. Sufficient for coverage and initial onboarding. Factual and food work well. Sensory and emotional are weak at this tier.

**Volume:** High. Basic questions for most regions from day one.

### Tier 2: Curator-Moderated

Regional curators review, edit, and supplement auto-generated content, and write original questions.

**Who are curators:** Local experts, passionate travelers, regional ambassadors. Volunteers or incentivized through gamification ("You curate Tuscany").

**What they do:**
- Review and approve/reject auto-generated questions
- Edit for accuracy and quality — fix errors, improve wording
- Select the best photos for GeoGuessr, remove poor ones
- Write original sensory, spatial, and emotional questions
- Ensure cultural sensitivity and accuracy
- Balance difficulty within rounds

### Tier 3: User-Generated Content

Users with Explored or Deep connection level can create questions about their regions.

**Creation flow:**
1. User writes a question, selects type, provides answer(s)
2. Chooses: **private** (for self / friends) or **submit for review**
3. If submitted → enters the curator moderation queue for that region
4. Curator approves, edits, or rejects
5. Approved questions enter the public pool, credited to the author

**Incentives for creating:**
- Attribution on public questions
- Achievements ("Created 10 public questions", "Your question was played 1,000 times")
- Play count visible to the author
- Path to curator status through consistently quality contributions

**Private questions** skip moderation entirely. Inside jokes, family memories, niche questions. Also a low-pressure way to practice before submitting publicly.

**Quality control:**
- Connection-level gate — strangers can't write questions about places they haven't been
- Curator moderation catches errors, duplicates, low-effort content
- Post-play ratings surface the best questions
- Reported questions return to the curator queue

---

## Gamification

The entire system naturally feeds into gamification:

- **Progress per region** — "23 of 47 experiences confirmed in Italy"
- **Connection map** — a personal world map colored by connection level
- **Refresh streaks** — maintaining connection levels over time
- **Discovery stats** — "Learned about 12 new regions this month"
- **Author stats** — how many times your questions were played, approved, highest-rated
- **Curator leaderboards** — most active curators per region
- **Endless content** — new rounds appear as experiences are added to the database
