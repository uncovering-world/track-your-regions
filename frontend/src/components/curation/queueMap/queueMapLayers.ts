/**
 * The layers the review queue's map draws (#2477): Map mode's heat and pin over this map's
 * sources (`experienceMarkers/layers.ts`), the heat below `HEATMAP_MAX_ZOOM` and the pin
 * fading in across the same band, spread with only their id and their source changed: a
 * question's colour rides on the feature as a kind's does there (#814), and the paint is
 * shared rather than restated. The count badge is this map's own: it counts the questions
 * a place holds.
 *
 * The open question's place has a source of its own, without the fade: it is drawn as
 * selected at every zoom, the heat's included, as Map mode's highlight is.
 */

import type { LayerProps } from 'react-map-gl/maplibre';
import type { FilterSpecification } from 'maplibre-gl';
import {
  heatmapLayer, markerLayer, MARKER_FADE_IN, MARKER_FADE_START,
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

/**
 * The count of a place's questions: a dark disc at the pin's upper right with the number
 * in white, fading in with the pin it sits on.
 */
export const questionBadgeBgLayer: CircleLayerProps = {
  id: LAYER_BADGE_BG,
  type: 'circle',
  source: SOURCE_QUESTIONS,
  filter: SEVERAL,
  minzoom: MARKER_FADE_START,
  paint: {
    'circle-color': '#0f172a',
    'circle-radius': 8,
    'circle-stroke-width': 1.5,
    'circle-stroke-color': '#ffffff',
    'circle-translate': [8, -8],
    'circle-translate-anchor': 'viewport',
    'circle-opacity': MARKER_FADE_IN,
    'circle-stroke-opacity': MARKER_FADE_IN,
  },
};

export const questionBadgeTextLayer: SymbolLayerProps = {
  id: LAYER_BADGE_TEXT,
  type: 'symbol',
  source: SOURCE_QUESTIONS,
  filter: SEVERAL,
  minzoom: MARKER_FADE_START,
  layout: {
    'text-field': ['to-string', ['get', 'count']],
    'text-size': 9,
    'text-font': ['Open Sans Bold'],
    'text-offset': [0.88, -0.88],
    'text-anchor': 'center',
    'text-allow-overlap': true,
  },
  paint: {
    'text-color': '#ffffff',
    'text-halo-color': '#0f172a',
    'text-halo-width': 0.2,
    'text-opacity': MARKER_FADE_IN,
  },
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
