/**
 * The sources card's views of one fact, folded by value (#2212): views that
 * hold the same value are one choice, headed by every source that gives it.
 *
 * Two kinds that read one Wikidata item send one value, and a card that drew
 * a column for each made the curator compare them letter by letter to find
 * that out — the Golden Gate in Vladimir was asked about its name in three
 * columns, two of them "Golden Gate" off Q775020. Different records can hold
 * one value too: the Piazza del Duomo in Pisa, whose World Heritage record
 * and Squares & streets' item both link the article on the Piazza dei
 * Miracoli while Places of worship links Pisa Cathedral's. A group is a value
 * and the views that give it, in the order the server sent them.
 */

import type { ReviewQueueItem } from '../../api/reviewQueue';

export type SourceViewField = NonNullable<ReviewQueueItem['source_views']>[number];
export type SourceView = SourceViewField['views'][number];

export interface ViewGroup {
  /** What the views hold, as one comparable string. */
  key: string;
  views: SourceView[];
  /** The view the group is shown and chosen by: the one readers see, where it is in the group, else the first. */
  lead: SourceView;
}

/** A view's value of the field, as the string two views are compared by: a point by its exact coordinates. */
function valueOf(field: SourceViewField['field'], view: SourceView): string {
  if (field === 'imageUrl') return view.image_url ?? '';
  if (field === 'location') return view.latitude == null || view.longitude == null ? '' : `${view.latitude},${view.longitude}`;
  return view.value ?? '';
}

export function viewGroups(field: SourceViewField): ViewGroup[] {
  const groups = new Map<string, SourceView[]>();
  for (const view of field.views) {
    const key = valueOf(field.field, view);
    groups.set(key, [...(groups.get(key) ?? []), view]);
  }
  return [...groups.entries()].map(([key, views]) => ({
    key, views, lead: views.find(view => view.shown) ?? views[0],
  }));
}

/**
 * The records a group's views come from, each with the views it gives (#2212):
 * one record for two kinds that read one item, so the card names the item
 * once beneath the kinds that read it.
 */
export function recordsOf(views: readonly SourceView[]): SourceView[][] {
  const records = new Map<string, SourceView[]>();
  for (const view of views) {
    const key = `${view.component ? 'component' : 'item'}|${view.external_id}`;
    records.set(key, [...(records.get(key) ?? []), view]);
  }
  return [...records.values()];
}

/** Every source the card's views come from, once each, in the order the server sent them. */
export function sourcesOf(fields: readonly SourceViewField[]): { kinds: string[]; sources: string[] } {
  const kinds = new Set<string>();
  const sources = new Set<string>();
  for (const field of fields) {
    for (const view of field.views) {
      kinds.add(view.kind_name);
      sources.add(view.source_name);
    }
  }
  return { kinds: [...kinds], sources: [...sources] };
}
