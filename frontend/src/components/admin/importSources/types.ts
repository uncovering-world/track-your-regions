/**
 * An import source is data, not a panel.
 *
 * Every source starts a world view import; they differ only in the parameters
 * they need and the endpoint they call. A source contributes a label and a form
 * component; the shared panel owns the card, the source selector and the world
 * view name, which all sources need.
 */

import type { ComponentType } from 'react';

export interface ImportSourceFormProps {
  /** World view name, owned by the shared panel because every source needs it. */
  worldViewName: string;
}

export interface ImportSource {
  /** Stable id used as the select value. */
  id: string;
  /** Shown in the source selector. */
  label: string;
  /** Suggested world view name, offered until the admin types their own. */
  defaultWorldViewName?: string;
  /** Owns this source's own inputs, mutation, error surface and start button. */
  Form: ComponentType<ImportSourceFormProps>;
}
