import { useState, type ComponentProps } from 'react';
import type { CurationDialog } from './CurationDialog';
import type { AddExperienceDialog } from './AddExperienceDialog';
import { lazyChunk } from '../../utils/lazyChunk';
import { ChunkBoundary } from './ChunkBoundary';

const CurationDialogChunk = lazyChunk(() => import('./CurationDialog').then(m => ({ default: m.CurationDialog })));
const AddExperienceDialogChunk = lazyChunk(() => import('./AddExperienceDialog').then(m => ({ default: m.AddExperienceDialog })));

/**
 * The curation dialogs, loaded the first time a curator opens one (#643).
 *
 * Map mode and Discover mount them for curators, but a visitor never opens
 * one, so they are not part of the bundle the visitor downloads. Each wrapper
 * decides when its chunk is wanted and mounts it inside a `ChunkBoundary`, so a
 * call site mounts it as it would the dialog itself.
 */

/** `CurationDialog`, fetched once there is an experience to curate: it renders nothing without one. */
export function LazyCurationDialog(props: ComponentProps<typeof CurationDialog>) {
  if (!props.experience) return null;
  return (
    <ChunkBoundary>
      <CurationDialogChunk {...props} />
    </ChunkBoundary>
  );
}

/**
 * `AddExperienceDialog`, fetched on its first opening and kept mounted from
 * then on: the dialog keeps a half-typed new place across a close — Escape or
 * a click on the backdrop — and clears it only once the place is created, so
 * unmounting it on close would throw the draft away.
 */
export function LazyAddExperienceDialog(props: ComponentProps<typeof AddExperienceDialog>) {
  const [opened, setOpened] = useState(props.open);
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <ChunkBoundary>
      <AddExperienceDialogChunk {...props} />
    </ChunkBoundary>
  );
}
