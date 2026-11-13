/**
 * The review queue's map (#2477) as data: what each marker is drawn with, which place is
 * the open question's, the kinds the legend names and the question the map walks to after
 * an answer, built from the map's read (`fetchReviewQueueMap`). Pure, so the component is
 * only layout and the map's events.
 *
 * A marker is a place, never a question: the read answers one entry per place, with its
 * questions in the class order the list sorts by, and a place several kinds ask about is
 * one marker with a count. The words and colours are the Question chip's
 * (`toolbarOptions.ts`), so a kind keeps one name and one colour on the chip, in the
 * legend and in a marker's short list.
 */

import { distanceMeters } from '@tyr/shared/moves';
import type { QueueMapPlace, QueueMapQuestion } from '../../../api/reviewQueue';
import { distanceLabel } from '../../../utils/moveDescription';
import { kindRank, kindShort, kindSwatch } from '../feed/toolbarOptions';
import { rowKeyOf } from '../queueRows';

/** What one marker's feature carries: its colour and how many questions it holds. */
export interface QueueMarkerProps {
  color: string;
  count: number;
}

export type QueueMarkers = GeoJSON.FeatureCollection<GeoJSON.Point, QueueMarkerProps>;

/**
 * A question in the Question chip's words: a waiting question by the sub-kind it is
 * about, as the chip offers the three apart. An arrival is always alone in its section,
 * so it wins over a change another kind holds of the same place, as the list's green does.
 */
export function chipKindOf(question: QueueMapQuestion): string {
  if (question.kind !== 'waiting') return question.kind;
  if (question.subs.includes('arrival')) return 'arrival';
  if (question.subs.length > 0 && question.subs.every(sub => sub === 'contents')) return 'contents';
  return 'held';
}

/** The colour a question is drawn in: its kind's (`KIND_COLOR`), a waiting one's by its sub-kind. */
export function questionColor(question: QueueMapQuestion): string {
  return kindSwatch(chipKindOf(question));
}

/** The word a question is named by: the Question chip's. */
export function questionWord(question: QueueMapQuestion): string {
  return kindShort(chipKindOf(question));
}

/** The list's key of a place's question: what the address's `row` names to open its card. */
export function questionRow(place: Pick<QueueMapPlace, 'placeId'>, question: QueueMapQuestion): string {
  return rowKeyOf(question.kind, place.placeId);
}

/**
 * The place the open question is about: the id in its key. Every key's id is a place,
 * so the open card's place is the marker drawn as selected. Null with no row open.
 */
export function placeOfRow(row: string | null): number | null {
  const id = row?.split(':')[1];
  return id && /^\d+$/.test(id) ? Number(id) : null;
}

function markerOf(place: QueueMapPlace): GeoJSON.Feature<GeoJSON.Point, QueueMarkerProps> {
  return {
    type: 'Feature',
    // The place's own id, unique per feature (`maplibre-patterns.md` § Where a feature's id
    // comes from): a click reads it back as the place.
    id: place.placeId,
    geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
    // The first question's colour: the questions come in the order the list sorts by.
    properties: { color: questionColor(place.questions[0]), count: place.questions.length },
  };
}

/** One marker per place, in the colour of its first question and with its count. */
export function queueMarkers(places: readonly QueueMapPlace[]): QueueMarkers {
  return { type: 'FeatureCollection', features: places.map(markerOf) };
}

/**
 * The open question's place, drawn on its own source over the markers and the heat, so
 * it stands out at every zoom. Empty when no row is open or the place is not on the map.
 */
export function selectedMarker(places: readonly QueueMapPlace[], placeId: number | null): QueueMarkers {
  const place = placeId === null ? undefined : places.find(p => p.placeId === placeId);
  return { type: 'FeatureCollection', features: place ? [markerOf(place)] : [] };
}

/** A kind the legend names: the chip's word and colour. */
export interface LegendKind {
  key: string;
  word: string;
  color: string;
}

/**
 * The kinds the map draws, in the chip's order. Every question of a place counts, not
 * only the first that colours its marker, so a kind that only shares a place is named too.
 */
export function legendKinds(places: readonly QueueMapPlace[]): LegendKind[] {
  const keys = new Set(places.flatMap(place => place.questions.map(chipKindOf)));
  return [...keys]
    .sort((a, b) => kindRank(a) - kindRank(b))
    .map(key => ({ key, word: kindShort(key), color: kindSwatch(key) }));
}

/** How many open questions the read counts: the ones on the map and the ones with no point. */
export function questionCount(places: readonly QueueMapPlace[], unplaced: number): number {
  return places.reduce((sum, place) => sum + place.questions.length, 0) + unplaced;
}

/** The points as one shape, which the map frames when no region is picked. Null with none. */
export function spreadOf(places: readonly QueueMapPlace[]): GeoJSON.Feature<GeoJSON.MultiPoint> | null {
  if (places.length === 0) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPoint', coordinates: places.map(place => [place.lon, place.lat]) },
  };
}

/** The question just answered on the map, and where its place stands: where the walk starts. */
export interface MapOrigin {
  row: string;
  placeId: number;
  lon: number;
  lat: number;
}

/** Where the map walks after an answer: the question it opens, its place's point and how far it is. */
export interface MapStep {
  row: string;
  placeId: number;
  lon: number;
  lat: number;
  /** Another question about the place just answered, which comes before any other place. */
  samePlace: boolean;
  meters: number;
}

/**
 * The question the map opens after an answer: another question about the same place first,
 * in the order its questions are listed, else the first question of the nearest place, by
 * great-circle distance. Null when the map holds no other open question.
 *
 * The answered question is left out by its key, so a read the answer has not refreshed yet,
 * which still holds it, never sends the curator back to it.
 */
export function nextOnMap(places: readonly QueueMapPlace[], from: MapOrigin): MapStep | null {
  const firstOpen = (place: QueueMapPlace) => place.questions.find(question => questionRow(place, question) !== from.row);
  const stepTo = (place: QueueMapPlace, question: QueueMapQuestion, meters: number): MapStep => ({
    row: questionRow(place, question),
    placeId: place.placeId,
    lon: place.lon,
    lat: place.lat,
    samePlace: place.placeId === from.placeId,
    meters,
  });

  const here = places.find(place => place.placeId === from.placeId);
  const another = here && firstOpen(here);
  if (here && another) return stepTo(here, another, 0);

  let nearest: MapStep | null = null;
  for (const place of places) {
    const question = place.placeId === from.placeId ? undefined : firstOpen(place);
    if (!question) continue;
    const meters = distanceMeters(from.lon, from.lat, place.lon, place.lat);
    if (!nearest || meters < nearest.meters) nearest = stepTo(place, question, meters);
  }
  return nearest;
}

/** What the line under the map says after the map walked on: where the next question is. */
export function stepLine(step: MapStep): string {
  if (step.samePlace) return 'Next: another question about this place.';
  if (Math.round(step.meters) === 0) return 'Next: a question about another place at the same point.';
  return `Next: the nearest open question, ${distanceLabel(step.meters)} away.`;
}
