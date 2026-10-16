# ADR-0113: A region's reference map is kept in the database, as raster bytes

**Date:** 2026-10-16
**Status:** Accepted

---

## Context

An admin splitting a region in the Create Subregions dialog lays a reference map under its
divisions — a scanned or downloaded map of the provinces, often a Wikimedia Commons file the
import found — and calibrates it by its four corners. That work lived in the admin's browser
(`localStorage`, key `custom-subdivision-dialog-state-<regionId>`): clearing site data, another
machine or a second admin lost it or never saw it (#595).

The dialog holds the image as a data URL of whatever it was given: a PNG or JPEG file, an SVG, a
GIF, or a Commons file fetched through the image proxy and redrawn on a canvas. It has to be kept
somewhere every admin reads. ADR-0043 says every picture a *visitor* sees is a Commons file,
hotlinked and credited, and nothing is downloaded; the `/data/images` machinery exists and holds
no rows. The reference map is not that: it is working material of the world view editor, read and
written by admins only, never drawn on a public surface.

## Decision

**1. A region's reference map is a row of `region_image_overlays`, one per region, holding the
image's bytes (`BYTEA`), its type, name and size, its four corners and its opacity.** It goes with
its region (`ON DELETE CASCADE`). It is read and written by admins only, through
`/api/world-views/regions/:regionId/image-overlay` (GET, PUT, DELETE), and reaches no public
surface.

**2. The table takes raster images only — PNG, JPEG or WebP — of at most 10 MB, and the bytes are
checked against their signature on write.** An SVG can carry script and is never stored; the
dialog draws any image that is not one of the three onto a canvas and saves the PNG it shows. The
same cap and types are CHECK constraints, so no writer can store anything else.

**3. ADR-0043 does not reach it.** The reference map is not a picture shown to a visitor; it needs
no credit line on a public surface and is not hotlinked. An admin who loads a Commons map takes
on its licence as any reuser does, privately.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| A file under `/data/images`, the row holding its path | Two stores to keep in step — a deleted region leaves a file, a restored dump lacks the files — and a new upload path to guard, for one image per region read only by the editor. |
| Keep it in `localStorage` | The problem the issue names: the work is lost with the browser and invisible to a second admin. |
| Store the data URL as `TEXT` | A third larger than the bytes, and no type a CHECK can hold to; the signature would still have to be checked on write. |
| Store only the URL of a Commons map | Covers the import's maps, not a file the admin uploads, and a Commons file can change under the calibration. |

## Consequences

**Positive:**
- The calibrated map follows the region to every admin and machine, and a database dump carries it.
- What is stored is checked by its bytes and capped by the schema: no SVG, no file over 10 MB.

**Negative / Trade-offs:**
- Up to 10 MB a region in the database. Only regions an admin subdivides with a map get a row, and a
  second save replaces the first.
- An SVG reference map loses its vectors: it is kept as the PNG the canvas drew, at its natural size.

## References

- Related ADRs: ADR-0043 (a visitor's picture is a Commons file), ADR-0071 (routes are declarations)
- Related docs: `docs/tech/world-views.md`, `docs/tech/STATE-MANAGEMENT.md`
- PR / issue: #595
