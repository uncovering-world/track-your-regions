import type { ImportSource } from './types';
import { WikivoyageForm } from './WikivoyageSource';
import { FileForm } from './FileSource';
import { BaseLayerForm } from './BaseLayerSource';

/**
 * Every import source, in the order they are offered. Adding a source means
 * adding a module and one entry here — nothing in the panel changes.
 */
export const IMPORT_SOURCES: ImportSource[] = [
  { id: 'wikivoyage', label: 'Wikivoyage', defaultWorldViewName: 'Wikivoyage Regions', Form: WikivoyageForm },
  { id: 'file', label: 'JSON file', Form: FileForm },
  { id: 'base-layer', label: 'Administrative base layer', defaultWorldViewName: 'Administrative', Form: BaseLayerForm },
];

export type { ImportSource, ImportSourceFormProps } from './types';
