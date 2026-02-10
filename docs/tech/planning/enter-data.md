# ONBOARDING QUIZ & REGION CONNECTION MODEL

How users import their travel history and build a living relationship with places they've been.

---

## Problem

Users arrive with years of travel history — regions visited, UNESCO sites seen, museums explored, dishes tasted. We need a way to import all of that without making it feel like data entry.

Traditional approaches (Google Takeout, photo EXIF metadata, browser extensions scraping booking sites) are either technically fragile, privacy-invasive, or only capture "you were near this place" — not "you experienced this specific thing inside it."

---

## Solution: Quiz-Based Onboarding

Instead of importing data, we **reconstruct it through play**. A quiz format that simultaneously entertains and infers what the user has experienced.

### Round Structure

A round is 5–7 cards, thematically grouped. After the cards, the system shows its inference and asks the user to confirm.

**Grouping strategies:**
- Geographic — "Southern France", "Scandinavia", "Kyoto & Nara"
- Thematic — "UNESCO Sites in Danger", "GI-Protected Foods of Europe"
- Unexpected — "Places Where Bond Was Filmed", "Cities Under 50K With World Heritage"

Thematic and unexpected rounds double as replayable content beyond onboarding — users return for new rounds purely for entertainment.

### Card Types

Different question types test different kinds of knowledge, which is key to distinguishing erudition from lived experience.

**Factual knowledge** (testable from reading):
> "In which century was Notre-Dame built?"

An erudite person answers this without visiting. That's fine — it signals cultural awareness.

**Sensory knowledge** (requires being there):
> "What do you hear first when exiting the metro at Sacré-Cœur?"
> "Is the floor in the Uffizi Gallery marble or parquet?"

Cannot be quickly googled. Confident answers strongly suggest the person was physically present.

**Spatial knowledge** (requires navigating the place):
> "Is the David at the end of a long corridor or in a separate hall?"

People who visited remember the layout. People who haven't have no reference.

**Emotional markers** (no correct answer, but having any answer is the signal):
> "Was the David bigger or smaller than you expected?"

There's no right answer. But the fact that someone *has* an answer means they stood in front of it. "I don't know" is an equally valid and informative response.

**Food triggers** (strong memory proxy):
> "Have you tried this dish in the region?" [photo of local specialty]

People remember food vividly. Works well as a proxy for "visited this region."

### Round Results Screen

After a round, the system presents its inference — not as a test score, but as a conversation:

> "Looks like you've been to Florence and saw the David, but didn't make it to Siena. And you definitely saw the Leaning Tower — you knew about the tilt 😄"

Below the narrative, a structured list:

- ✅ Florence — Uffizi — *confirm*
- ✅ Pisa — Tower — *confirm*
- 📖 Siena — Piazza del Campo — *read more*
- 📖 San Gimignano — *read more*

**Key design decisions:**
- **Inference, not interrogation.** We don't ask "were you in Siena?" — we deduce from indirect signals and offer confirmation. More respectful, more interesting.
- **Mistakes are content.** Wrong guesses are funny and memorable: "You described Barcelona so well we thought you lived there."
- **"Read more" instead of "want to visit."** Wishlists create obligation. A link to content is pure curiosity with no commitment — lower barrier, higher click-through.

### Adaptive Difficulty

Rounds are generated dynamically based on what's already known. If early rounds reveal extensive European travel, subsequent rounds become more granular within Europe. If the user hasn't traveled much, rounds stay broad and exploratory — avoiding the feeling of "here are 100 places you haven't been."

---

## Region Connection Model

Travel history is not binary. We model the user's relationship with a place as a **spectrum of connection** that evolves over time.

### Connection States

| State | Description | How it's detected |
|-------|-------------|-------------------|
| **Stranger** | Default. No knowledge, no visit. | — |
| **Aware** | Never visited, but knowledgeable. Read about it, watched films, knows facts. | High score on factual questions, low/zero on sensory questions |
| **Passed through** | Visited but remembers little. Transit, long ago, childhood trip. | Confirms visit but fails most sensory/spatial questions |
| **Explored** | Visited and remembers details. Knows experiential things — smells, textures, layouts. | High score on sensory + spatial questions |
| **Deep connection** | Lived there, returned multiple times, knows the non-obvious. | Consistently high across all question types |

### Distinguishing Erudition from Experience

The ratio of correct factual vs. sensory answers is the key discriminator:

- **High factual + low sensory** → Aware (well-read, hasn't visited)
- **Low factual + high sensory** → Explored (was there, doesn't know the history)
- **High factual + high sensory** → Deep connection
- **Low everything** → Stranger or vague Passed through

### Decay Over Time

Connection states are not permanent. Memories fade, and the model reflects this honestly.

**Decay rules:**
- Deep connection → slowly degrades toward Explored
- Explored → degrades toward Passed through
- Passed through → stays (you either went or you didn't)
- Aware → degrades slowly (book knowledge fades too, but slower than experiential memory)
- Stranger → no decay (floor state)

**Decay rate factors:**
- Initial strength of sensory answers — vivid memories last longer
- Time since last quiz interaction about this region
- Whether the user has engaged with content about the region recently

### Refresh Mechanic

When a connection level begins to decay, the system offers a **"Refresh your memory"** mini-round for that region. If the user still remembers — the level restores. If not — it drops honestly, and the system shows "here's what you've forgotten, revisit anytime."

This creates a natural re-engagement loop without push notifications or guilt.

### Visual Representation

Connection levels should **not** be shown as numeric scores or explicit labels. Instead, use a visual metaphor on the map:

- **Saturation/brightness** of the region's color — places with deep connection are vivid, fading memories become muted
- **Different hue** for Aware regions — distinguishes "know about" from "been to" without hierarchy
- **Stranger regions** — neutral/default map color

This is intuitive, avoids the feeling of being graded, and creates a beautiful personalized map that reflects the user's actual relationship with the world.

---

## Data Import (Supplementary)

The quiz is the primary onboarding method, but traditional import can accelerate it.

### Priority 1: Smart Manual Input

Show a map. Let the user tap regions and select approximate year. Most people have visited 10–30 regions, not 300 — this takes 2–3 minutes. Pre-populates regions for targeted quiz rounds.

### Priority 2: Google Takeout

User uploads Location History JSON from takeout.google.com. We parse coordinates, map to regions, and show: "We found these trips — confirm?" This seeds region-level data; the quiz then fills in granular experiences within each region.

### Priority 3: Photo GPS (Bonus)

"Upload photos from a trip — we'll figure out where it was." Not a primary onboarding flow, but a way to add specific trips later. Works best when the user selects a specific album rather than granting full library access.

### What We Don't Do

- **Browser extensions** — fragile (sites change markup), creepy (reads data on third-party sites), high trust barrier
- **Email parsing** — powerful in theory (booking confirmations), but the privacy cost outweighs the benefit
- **Always-on location tracking** — not our model; we respect that travel is something you reflect on, not something that's passively logged

---

## Gamification Tie-ins

The connection model naturally feeds into gamification:

- Progress bars per region: "You've confirmed 23 of 47 experiences in Italy"
- Connection map: a world map colored by your relationship with each place
- Refresh streaks: maintaining your connection levels over time
- Discovery stats: "You've learned about 12 regions you haven't visited yet"
- Quiz rounds as ongoing content, not just onboarding — new rounds appear as new experiences are added to the database