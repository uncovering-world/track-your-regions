/**
 * The layers the review queue's map draws (#2477): Map mode's own, over this map's
 * sources (`experienceMarkers/layers.ts`). The heat below `HEATMAP_MAX_ZOOM`, the pin
 * fading in across the same band, and its count badge are those definitions with only
 * their id, their source and what the badge counts changed: a question's colour rides on
 * the feature as a kind's does there (#814), and the paint is shared rather than restated.
 *
 * The open question's place has a source of its own, without the fade: it is drawn as
 * selected at every zoom, the heat's included, as Map mode's highlight is.
 */

import type { LayerProps } from 'react-map-gl/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import {
  heatmapLayer, markerCountBadgeBgLayer, markerCountBadgeTextLayer, markerLayer,
} from '../../experienceMarkers/layers';
import { sceneHighlightRingLayer, sceneMarkerLayer } from '../../experienceMarkers/scene';

type CircleLayerProps = Extract<LayerProps, { type: 'circle' }>;
type HeatmapLayerProps = Extract<LayerProps, { type: 'heatmap' }>;
type SymbolLayerProps = Extract<LayerProps, { type: 'symbol' }>;

export const SOURCE_QUESTIONS = 'review-questions';
export const SOURCE_SELECTED = 'review-question-selected';

const LAYER_PIN = 'review-questions-pin';
const LAYER_BADGE_BG = 'review-questions-badge-bg';
const LAYER_BADGE_TEXT = 'review-questions-badge-text';

/** A place several questions are about: the badge counts its questions. */
const SEVERAL: FilterSpecification = ['>', ['get', 'count'], 1];

export const questionHeatLayer: HeatmapLayerProps = {
  ...heatmapLayer, id: 'review-questions-heat', source: SOURCE_QUESTIONS,
};

export const questionPinLayer: CircleLayerProps = {
  ...markerLayer, id: LAYER_PIN, source: SOURCE_QUESTIONS,
};

export const questionBadgeBgLayer: CircleLayerProps = {
  ...markerCountBadgeBgLayer, id: LAYER_BADGE_BG, source: SOURCE_QUESTIONS, filter: SEVERAL,
};

export const questionBadgeTextLayer: SymbolLayerProps = {
  ...markerCountBadgeTextLayer,
  id: LAYER_BADGE_TEXT,
  source: SOURCE_QUESTIONS,
  filter: SEVERAL,
  layout: { ...markerCountBadgeTextLayer.layout, 'text-field': ['to-string', ['get', 'count']] },
};

const LAYER_SELECTED_PIN = 'review-question-selected-pin';

export const selectedRingLayer: CircleLayerProps = {
  ...sceneHighlightRingLayer, id: 'review-question-selected-ring', source: SOURCE_SELECTED,
};

export const selectedPinLayer: CircleLayerProps = {
  ...sceneMarkerLayer, id: LAYER_SELECTED_PIN, source: SOURCE_SELECTED,
};

/**
 * The layers a click on a place is read from: the pin and its badge are the same place,
 * and the selected pin is too, so a place of several questions offers the rest of them
 * again from the marker it is drawn as once one is open.
 */
export const QUESTION_PIN_LAYERS = [LAYER_PIN, LAYER_BADGE_BG, LAYER_BADGE_TEXT, LAYER_SELECTED_PIN];
