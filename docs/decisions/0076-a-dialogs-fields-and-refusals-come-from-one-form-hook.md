# ADR-0076: A dialog's fields and its refusals come from one form hook

**Date:** 2026-09-29
**Status:** Accepted
**Issue:** [#1129](https://github.com/uncovering-world/track-your-regions/issues/1129), a slice of [#788](https://github.com/uncovering-world/track-your-regions/issues/788)

---

## Context

Every dialog that edited data held its fields in its own way. It kept one `useState` per field: fourteen in `HierarchySwitcher.tsx`, sixteen in `AddExperienceDialog.tsx`. It decided on its own what "changed" meant, what an emptied field sends, and what a failed save shows. Each of those rules was fixed one dialog per pull request:

- #696 taught `CurationDialog` to send an emptied field as `''` rather than drop it. The world view dialogs kept `trim() || undefined` until #1133.
- #448 made the world view dialogs show a refusal at all. `EditRegionDialog`'s save still showed none.
- No dialog could say which field was wrong. The backend answers a Zod refusal with the field in `details`, and until #448 `ApiError` dropped it.

The request schemas are Zod on the backend. The web carries their shapes only as TypeScript: Orval runs with `client: 'fetch'` and emits body types (`EditExperienceBody`, `UpdateRegionBody`), not schemas. `zod` is not a frontend dependency.

`HierarchySwitcher` is mounted by `NavigationPane`, so it sits in the entry chunk. On 2026-09-29 that chunk gzipped to 181 kB against its 190 kB `size-limit` budget (`frontend/package.json`).

## Decision

1. **One hook, `useEditForm` (`frontend/src/hooks/useEditForm.ts`), is the form layer.** A dialog declares its fields — the stored values or blanks, a reset key, which fields are required, how a field is tidied — and the hook holds:
   - the values, and which of them changed;
   - what is sent;
   - the errors, per field and for the form.

   It is not a library.
2. **Field names are the request body's keys.** A dialog types the hook with the generated body type, so `changes()` is a `Partial` of what the call takes, and a field the body lacks does not compile. Where one field stands for two body keys (a coordinate box for `latitude` and `longitude`), `paths` maps the body path to the field.
3. **What is sent is one rule.** A field has changed when its tidied value differs from the value the form opened on. By default a string is trimmed; a dialog can name its own tidy, such as `tidyLabel` for a name. The form sends exactly the changed fields, each as its tidied value, and an emptied field as `''`. A create opens on blanks, so the same rule sends what was filled in.
4. **The server stays the one validator.** The client does not restate its schema. A refusal's issues (`ApiError.fieldIssues`) land on the field whose body key they name, by the `paths` map, then the exact key, then the first segment of a dotted path. Anything that names no field becomes the form's error. A dialog may still refuse a value early where the server's words would mean nothing to its reader, as `WorkCorrection` does.
5. **Stored values arriving late move only what the user left alone.** When `initial` changes under the same reset key — a detail read arriving, the refetch after a save — every untouched field takes the new value and every edited field keeps the user's. A new reset key starts the form over. Both adjust during render, so a dialog never paints a frame of the previous object. A reset abandons a save still in flight, so its answer lands nowhere.

Every dialog that edits a stored object's fields declares them to it: `CurationDialog` (the edit form and the reject reason), `AddExperienceDialog`'s Create tab, the world view create and settings dialogs, the `WorldViewHeader` inline editors and `EditRegionDialog`. The world view dialogs and the region dialog move with the hook; the two curator dialogs follow in a second pull request under #1129.

These stay outside it, because their state is not a set of body keys:
- `WorkCorrection` sends the makers unchanged to vouch for their order.
- `PointCorrection` takes a coordinate from a map.
- The register and change-password forms have no stored values to compare against, and they carry password rules of their own.

Their Save already sends only what changed.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| react-hook-form with a Zod resolver | It is about 10 kB gzipped, with Zod at 13 kB or more on top. The entry chunk had 9 kB of headroom, and `HierarchySwitcher` lives in it. Every field here is a controlled MUI input, so each one would need a `Controller`, which gives up the library's uncontrolled-input advantage. And the rules this repository needs — `''` for an emptied field, `tidyLabel` dirtiness, body paths mapped to fields, a late baseline — are its own, and `dirtyFields` answers none of them. |
| Orval's Zod output, validated in the browser | It restates the server's schema in a second runtime, and brings Zod into the bundle. The server already answers with the field and the reason. |
| Keep per-dialog state and share a helper for the refusal only | This leaves "what changed" and "what an emptied field sends" decided per dialog — the rule #696 and #1133 each fixed in one place. |

## Consequences

**Positive:**
- Nobody has to remember the emptied-field rule and the refusal display again: they are the layer's, and `useEditForm.test.tsx` states them once.
- A refused save names its field under that field, in every dialog that goes through it.
- The settings and region dialogs send only what changed. A rename used to rewrite the region's parent, colour and hull flag with the values the dialog opened on, which could put back another admin's change made while it was open. It now writes the name alone.

**Negative / Trade-offs:**
- The server's words reach the field as Zod wrote them ("Too big: expected string to have <=255 characters"). Mapping them to product language is not part of this decision.
- A create dialog's draft is gone once it is closed, except where the dialog chooses a reset key that keeps it.

## References

- Related ADRs: ADR-0066 and ADR-0073 (the body types the hook is typed with); ADR-0065 (`tidyLabel`).
- Related docs: `docs/tech/development-guide.md` § App-Level Hooks; `docs/tech/shared-frontend-patterns.md` § Pattern Table.
- Issues: #1129, #696, #448, #1133, #788.
