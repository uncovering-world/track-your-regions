# Addresses — a place a visitor can send

Every region, every experience card and every Discover list is a place, and a
place has an address. This is the grammar the app reads and writes, where it is
implemented, and the rules that keep it honest. The decision behind it is
[ADR-0034](../decisions/0034-a-place-has-an-address.md); the issue is #644.

## The grammar

| Address | What it names |
|---|---|
| `/` | Map, the default (GADM) world view, nothing selected |
| `/wv/5` | Map, world view 5 |
| `/wv/5/r/6737-europe` | Map, region 6737 selected |
| `/wv/5/r/6737-europe/e/1234-stonehenge` | Map, that region, card 1234 open in the explore panel |
| `/discover` | Discover, the default world view |
| `/discover/wv/5` | Discover, world view 5, the tree at its root |
| `/discover/wv/5/r/7100-malta` | Discover, the tree standing at Malta |
| `/discover/wv/5/r/7100-malta?cat=1` | Discover, Malta's UNESCO list open, the tree at Malta's parent |
| `/discover/wv/5/r/7100-malta/e/1234-stonehenge?cat=1` | …that list, with the card open |
| `/?wv=5`, `/discover?wv=5` | The form links carried before #644 — honoured, then rewritten in place |
| `/review` | The curator's review feed, nothing narrowed — a page rather than a place; see § The review page |
| `/review?sort=question&q=cologne&source=1,3&kind=held&region=6737&run=98&aside=show&row=waiting:126` | …that feed's whole working set: the order, the search, the four filters, the set-aside batches shown, and the question open on the right — on the catalogue of 2026-09-07, Cologne Cathedral's held proposal from run 98 |

Two rules decide where a piece of state goes:

- **Navigational identity is a path segment** — the world view, the region, the
  open card. Each names a resource, and a path is what a copied link is expected
  to mean.
- **View state the visitor set deliberately is a query parameter** — today only
  Discover's open category, `?cat=`. A filter does not identify a resource.

`r` is *the region in question*. In Discover with a category list open it is the
region whose list it is, and the tree stands at its parent — which is exactly
the state a chip click produces, since chips sit on the rows of a level. Without
a list open, the tree stands at the region itself.

The default world view writes no segment: `/` and `/discover` are its addresses.
GADM administrative divisions are **not** addressed at all — the built-in
administrative hierarchy is admin-only and appears in no visitor surface (see
ADR-0034 § Alternatives).

## Ids decide, slugs decorate

`6737-europe` is read as `6737`. The slug is for the person receiving the link,
and nothing rests on it:

- A segment is read as digits followed by either `-` or the end of the segment:
  `6737`, `6737-europe`. Everything after that first `-` is ignored. Anything
  else does not parse — `europe-6737`, `6737europe`, `abc`, `0`, `-3` — and is
  treated as absent, along with everything after it. The delimiter is what makes
  the rule strict rather than lenient: a bare `parseInt` would read `6737europe`
  as 6737 and quietly accept a segment nothing in the app ever wrote.
- When the object's name is known and the slug differs, the address is rewritten
  with `replace`. A link made before a rename still opens the object, and the
  address bar corrects itself with no round trip and no 404.
- `slugify` is NFD, combining marks stripped, lowercase, non-alphanumerics
  collapsed to `-`, trimmed, capped at 60 characters. A name with no Latin
  letters or digits (`Москва`, `東京`) slugs to nothing, and the id stands alone.

## History: push what the visitor did, replace what the app corrected

- **`push`** — selecting a region (from the list, the map, search, a breadcrumb),
  opening or closing a card, opening or closing a Discover category list,
  switching world view from a picker, Map ↔ Discover in the header. Back undoes
  each of them.
- **`replace`** — the legacy `?wv=` redirect, slug canonicalisation, and every
  degradation below. None of these is a step the visitor took.
- **Nothing on hover**, and nothing on a map movement (the viewport is not in the
  address; see § What is not addressed).
- Writing the address the page is already at is a no-op, so a canonical rewrite
  is idempotent and a follow-effect that answers its own write cannot loop.

## Degradation is silent

A URL naming something the visitor may not see degrades to the nearest thing they
may, in place, with no error surface — the same 404-shaped silence
`requireVisibleWorldView` gives. The address must not become a way to enumerate
what exists, and nothing personal goes in a URL.

| The address names | What happens |
|---|---|
| A world view that is hidden or gone | The existing world-view reconciliation replaces it; the region and card go with it |
| A region that 404s, or belongs to another world view | → the world view alone (`/wv/5`) |
| A card the region's list does not hold — hidden, rejected, elsewhere, of another category | The `e` segment is dropped, once the list has answered |
| A category nobody knows | `?cat=` is dropped, once the categories have answered |
| A segment that does not parse | Read as absent, and canonicalised away |

"Once the list has answered" is load-bearing in both rows, and it means a
*successful* answer: neither the empty list that stands in while the real one
loads nor a failed read is an answer about what a region holds, and treating
either as one would spend a shared link on a hiccup — and not give it back,
since the retry would read an address the card had already been taken out of.

**One asymmetry is a known consequence rather than a visibility rule.** Discover
reads a region *and its descendants* (`includeChildren: true`); map mode reads
the region alone (`docs/tech/experience-map-ui.md` § Shared state model). So a
card opened in Discover on an object that belongs to a descendant region, carried
to map mode by the header, is not in that region's list and is dropped by the row
above. The card closes and the region stays. Carrying it is still the right
default — it is the common case that works — and the alternative, dropping the
card on every mode switch, would lose the card that *would* have opened.

Every id in an address reaches only reads that are already bounded by
visibility, so the client learns nothing the API would not have said.

## The review page

`/review` is the curator's review feed, and it is a page rather than a place:
`review` is in `NOT_A_PLACE`, so `parseAppUrl` answers `null` for it and none of
the rules above about world views, regions and cards applies to it. What it does
have is a working set — the order, the search, the four filters, whether
set-aside batches are shown, and the question open on the right — and that is
view state a curator set deliberately, so it goes in query parameters by the same
rule Discover's `?cat=` does: [ADR-0034](../decisions/0034-a-place-has-an-address.md)
applied, by [ADR-0051](../decisions/0051-the-review-queue-is-one-list-of-dated-questions.md)
decision 5.

| Parameter | What it names |
|---|---|
| `sort=question` | The class-first order. `date` is the default and writes nothing |
| `q=cologne` | The search, trimmed and capped at 100 characters — the API's own limit for it |
| `source=1,3` | The sources, by id |
| `kind=arrival,refused` | The questions: `conflict`, `withdrawn`, `refused`, `missing`, and the three gated kinds: `arrival`, `held`, `contents` |
| `region=6737`, `region=none` | A region and everything under it, or the objects in no region at all |
| `run=98` | The run that asked |
| `aside=show` | Show the batches this curator has set aside, which are otherwise out of the list. Picking a set-aside run in the Run chip turns it on with the filter, in one write: that chip counts its runs before the set-aside rows are dropped, so the batch it offers would otherwise be filtered to a list the page hides |
| `row=waiting:126` | The question open on the right, by the list's own key |

**The ticks are not a parameter** (#852). A curator can tick many rows and answer them
at once, and the ticks are deliberately transient — component state, cleared when a
filter or the search changes, never written to the address. The filters, the order and
the open row name a *list* and a *question*, which a link should reopen; a set of ticks
names work in progress, which a link must not replay onto whoever follows it, and Back
through forty ticks would be forty steps. They survive *Show more* (the rows stay, the
ticks stay) and a reorder, and go with a notice when the list they were made against is
replaced. "All N matching these filters" is the one selection the address *does* describe,
because it is exactly the filtered list — and it is walked through the queue's own
filtered read — the first page after every answer, and past a page holding nothing
untried by the queue's own cursor — rather than sent as keys.

The address in the table at the top of this page is a real one as of
2026-09-07: `waiting:126` is Cologne Cathedral, which run 98 asked about by
proposing its inscription criteria, and `q=cologne` and `kind=held` are two of
the ways a curator reaches it.

`parseReviewUrl` and `buildReviewUrl` sit in `appUrl.ts` beside
`parseAppUrl`/`buildAppUrl` — a sibling grammar rather than an extension of it:
no path segments, and every word is one `GET /api/experiences/review/queue`
already reads, except `row`, which the API does not need and a deep link does.
They are in the same module for the same reason the first pair is, with a
round-trip test of their own.

**`row` carries the list's word, not the API's**, and the two differ in exactly
one: a conflict row's key is `conflicts:88`, while the filter for that same
question is `kind=conflict`. They name different things — a row on the page, and
a kind to filter by — and matching the API's word in `row` would write an address
the page can never find.

**The second door.** `useReviewAddress` is to this grammar what `useAppAddress`
is to the other: `{ address, go }`, `go` merging `next` over the current address
and doing nothing when the result is the address the page is already at. It reads
that current address through a ref, for the reason `useAppAddress` reads through
one — `navigate` puts the new URL in the address bar at once while React
re-renders through a transition, so two writes made in one gesture (setting the
search text and clearing the selected row) would otherwise both merge onto the
URL of the render before either, and the second would undo the first. Only a
navigation from *outside* — Back, a fresh entry, the page loading at a new
address — overrides what `go` last wrote.

**`next` may also be a function of the current address**, and for the same
reason: the ref fixes what a patch is merged *onto*, not what it is computed
*from*. A filter chip toggles one id out of the list the address holds and its
menu stays open, so a second tick reported before React has re-rendered — the
location update lands in a transition — computes its array from an address that
never saw the first, and `source=2` replaces the `source=1` the curator had just
asked for. A function is resolved against the same current address the result is
merged onto, so a relative write always builds on the write before it. Absolute
patches stay the common form; only a change that reads the address to compute
itself needs the function.

**Push what the curator did, replace what the page corrected**, as everywhere
else here. A question opened from the list, a filter, a search, the order and
showing the set-aside batches are pushes. A change that names a different list
clears `row` with it — the question was chosen out of a list that no longer
exists — while the order and showing the set-aside batches keep it, because the
question stays in the list either way. The selection moving on by itself once
a question is answered is a replace: Back must not have to step through a
correction the page made for itself. Setting a batch aside writes no address
at all — it is work put down rather than a view of it, and the filter stays
where the curator left it.

**Degradation is silent here too.** A value that does not parse — `region=europe`,
`row=conflict:88`, `kind=nonsense` — reads as absent and the rest of the address
still applies. The leniency runs on into the endpoint the address is asked with:
a filter word the server's vocabulary does not know is dropped rather than
answered 400, and a `cursor` it cannot read opens the first page.

**A `row` resolves only within the pages loaded so far.** One that names no row
in them is replaced by the first row of the list, and the address bar goes with
it — whether the question was answered by somebody else or simply sits further
down a backlog the page has not paged to. A page holds 25 rows, so a link into a
batch larger than that lands on its own row only when the row is on the first
page; the list the link named is still the list that opens. Making the server
open the page a named `row` is *on* is issue #843.

## Where it lives

| File | What it holds |
|---|---|
| `frontend/src/utils/appUrl.ts` | The grammar: `parseAppUrl`, `buildAppUrl`, `legacyRedirect`, `slugify`, `slugsOf`. Parse and build side by side — and the review page's sibling pair, `parseReviewUrl`/`buildReviewUrl`, with `isFilteredReview` for the one list of narrowing parameters |
| `frontend/src/utils/appUrl.test.ts` | Its tests, including the **round trip** — state → URL → state for every shape, both grammars |
| `frontend/src/hooks/useAppAddress.ts` | The one door: `{ address, go }`. `go` builds, no-ops on the current address, pushes by default and replaces when asked; keeps the slugs already in the address for ids a write leaves alone; performs the legacy redirect |
| `frontend/src/hooks/useReviewAddress.ts` | The second door, for `/review`: the same `{ address, go }` over the review grammar, with the same ref discipline, pushing what the curator did and replacing what the page corrected |
| `frontend/src/hooks/useAddressedRegion.ts` | The selected region: the object, the ancestors read that restores and completes it, the follow, the degradation, the canonical rewrite |
| `frontend/src/hooks/useNavigation.tsx` | The world view: reads it from the address, writes it with `push` / `replace` / `none` per case |
| `frontend/src/hooks/useExperienceContext.tsx` | Map mode's open card, derived from the address, and the arrival the list focuses |
| `frontend/src/hooks/useDiscoverExperiences.ts` | Discover's level, category and card, all derived from the shared region and the address |
| `frontend/src/components/Header.tsx` | Carries the place across Map ↔ Discover |

Nothing else reads `useSearchParams` or calls `navigate` for app state. The
review feed's own state goes through the second door above, which reads
`useLocation` and writes through the same `navigate`; the two remaining
exceptions are not app state at all: `AuthCallbackHandler` (`code`, `error`) and
`VerifyEmailPage` (`token`).

**Adding a parameter**: add it to `AppAddress`, to `parseAppUrl` and to
`buildAppUrl`, and to the round-trip list in the test — or, for the review feed,
to `ReviewAddress`, `parseReviewUrl`, `buildReviewUrl` and that pair's own
round trip. The test is what stops a parameter being added in one direction only
— the failure mode a single module exists to prevent.

## What the address enables

- The document `<title>` names the place — `useDocumentTitle`, wired by
  `MainDisplay` and `DiscoverPage` — so share previews and history entries read
  it. (Open Graph tags need a server-rendered head and are not here.)
- Focus lands in the card a link named, once it opens: `ExperienceList` focuses
  the arriving row, so a keyboard or screen-reader visitor is put in what the
  link named rather than at the top of the page. The group holding that card is
  the one the region opens on, too — a card inside a collapsed category is not
  open, whatever the address says (`initiallyExpandedGroup`, #592).
- A name typed in the navigation pane is a way *into* the grammar: a search
  result writes the whole address in one `go()` — world view, region, card —
  and the region it names is the smallest one holding the object in the world
  view already open. The search never writes another world view's address; see
  [ADR-0042](../decisions/0042-a-search-answers-about-the-catalogue-and-opens-where-the-reader-is.md).
- The smoke specs open the fixture region directly (`/wv/9001/r/9001`), and
  `addresses.smoke.spec.ts` covers the deep link, the canonical rewrite, Back,
  the legacy form and the silent degradation.
- The performance lane can audit a region page and a card page as page loads
  rather than only the two shells — #669 puts them in the budgets files, with
  the measurement to size them against; #646 and #647 build on the same
  addresses.

## What is not addressed

- **The map's viewport.** `?map=zoom/lat/lng` (the OSM and OpenLayers
  convention), written with a debounced `replace` after a deliberate pan or
  zoom, is the intended shape and is deliberately a separate change: it is
  transient view state with its own write path, and it belongs in the query
  string rather than the path. A deep link with no viewport lands on the
  object's own `focus_bbox`/`anchor_point`, exactly as a click does.
- **GADM administrative divisions**, per ADR-0034.
- **Anything personal** — visited state, user ids. URLs travel through referers,
  logs and chat. The one exception is `q` on the review page: it is the sole
  free-text parameter the app writes to an address, but it is a curator's
  search over the catalogue's object names, on a curator-only page, capped at
  100 characters and trimmed — view state by this rule, not personal data, since
  a name a curator types is a name the catalogue already publishes.
