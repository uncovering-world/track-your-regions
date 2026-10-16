# Where the Create Subregions dialog keeps its state

The Create Subregions dialog (`frontend/src/components/WorldViewEditor/components/dialogs/CustomSubdivisionDialog/`)
is where an admin splits a region into subregions: it sorts the region's members into groups,
lays a reference map under them, and may ask the AI tab for suggestions. Server state everywhere
else in the web is TanStack Query's (ADR-0008); this page is about the dialog's own working state,
which has several homes.

| Data | Kept in | Why |
|------|---------|-----|
| The region's members (divisions and cut parts) | Database (`region_members`) | What the region is |
| The reference map: image, corners, opacity | Database (`region_image_overlays`, ADR-0113) | An admin's calibration, for every admin on any machine |
| Subdivision groups and which member is in which | This browser (`localStorage`) | Still the browser's; #595 moves them to the database |
| AI suggestions | This browser | A temporary cache of the last answers |
| AI usage counts | This browser | This admin's own running totals |

## The browser's part

The browser's state is one JSON entry per region under `custom-subdivision-dialog-state-<regionId>`
(`STORAGE_KEY_PREFIX`, `overlayStorage.ts`), written a second after any change and read when the
dialog opens on the region. What it says about members is checked against the database on open
(`validateStoredState`, `index.tsx`): a stored division the region no longer has is dropped, a
member the entry does not know is added to the unassigned list, and a stored member takes its
current `memberRowId`.

## The reference map

`useRegionImageOverlay.ts` reads the region's map when the dialog opens, saves it whenever the
image dialog applies one, and deletes it from the map tab's *Remove the reference map* button, which
asks first since the map is every admin's (`/api/world-views/regions/:regionId/image-overlay`,
admin-only; a save is answered with no body). The table takes PNG, JPEG or WebP
of at most 10 MB, checked by signature; `overlayBodyOf` (`overlayStorage.ts`) draws anything else
— an SVG, a GIF, a map loaded by address — onto a canvas and sends the PNG.

Before #595 the map was part of the browser's entry. A region whose database row is empty but whose
entry still holds a map is offered once: *Keep* saves it for every admin and then removes it from
the entry, *Discard* only removes it, and a failed save leaves it where it was. Until then every
write of the entry carries it forward untouched (`legacyOverlay`), and a reset of the dialog's state
keeps it too. Where the database already holds a map, the entry's older copy is removed unasked:
it would only fill the browser's storage.
