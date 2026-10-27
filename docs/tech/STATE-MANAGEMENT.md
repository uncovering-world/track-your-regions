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
| Subdivision groups and which member is in which | Database (`region_subdivision_groups`, `region_member_group_assignments`) | The admin's sorting, for every admin on any machine |
| AI suggestions | This browser | A temporary cache of the last answers |
| AI usage counts | This browser | This admin's own running totals |

## The browser's part

The browser's state is one JSON entry per region under `custom-subdivision-dialog-state-<regionId>`
(`STORAGE_KEY_PREFIX`, `overlayStorage.ts`), written a second after any change and read when the
dialog opens on the region: the AI suggestions, the open tab and the usage counts.

## The groups

When the dialog opens on a region it reads the region's members and its groups together, and the
groups' members by their `region_members` row (`groupsFromDb`, `groupsStorage.ts`); a division no
group holds is unassigned, and a child region no group fills (an imported one, say) is added as an
empty group; a load that answers after the dialog moved to another region or closed is dropped.
`useSubdivisionGroupsSync.ts` saves the whole set a second after the last change, and only when it
differs from what the database holds; a load that failed saves nothing, so an empty dialog never
overwrites groups it could not read (`/api/world-views/regions/:regionId/subdivision-groups`,
admin-only, under the region's lock). Saves go out one at a time, each with the groups as they are
when it is sent, since the lock orders their arrival rather than the edits. A member row no longer in the region — moved to a child by
*Create*, or by another admin — is not read as assigned, and is left out of a save; a member in two
groups is refused; a row moved here from another region keeping its id has its old assignment taken
over. *Create* and *Quick Expand* stop saving, wait for a save in flight, and drop the groups once they
are subregions, the drop under the region's lock too.

Before #595 the groups were part of the browser's entry. Where the database holds none, an entry's
groups are adopted once — checked against the region's members as before (`validateStoredState`,
`index.tsx`: a division the region no longer has is dropped, a stored member takes its current
`memberRowId`) — saved, and forgotten in the browser only once that save has landed
(`legacyGroups`, `forgetLegacyGroups`). Where the
database holds groups, the entry's are forgotten unread.

## The reference map

`useRegionImageOverlay.ts` reads the region's map when the dialog opens, saves it whenever the
image dialog applies one, and deletes it from the map tab's *Remove the reference map* button, which
asks first since the map is every admin's (`/api/world-views/regions/:regionId/image-overlay`,
admin-only; a save is answered with no body). A save also carries the region-map address the image
was loaded from (`sourceUrl`, an absolute http(s) address or null for an upload), which is what the
map's credit is read by. The table takes PNG, JPEG or WebP
of at most 10 MB, checked by signature; `overlayBodyOf` (`overlayStorage.ts`) draws anything else
— an SVG, a GIF, a map loaded by address — onto a canvas and sends the PNG.

Before #595 the map was part of the browser's entry. A region whose database row is empty but whose
entry still holds a map is offered once: *Keep* saves it for every admin and then removes it from
the entry, *Discard* only removes it, and a failed save leaves it where it was. Until then every
write of the entry carries it forward untouched (`legacyOverlay`), and a reset of the dialog's state
keeps it too. Where the database already holds a map, the entry's older copy is removed unasked:
it would only fill the browser's storage.
