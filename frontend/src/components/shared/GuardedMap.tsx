/**
 * `react-map-gl`'s `<Map>` with the WebGL check built in.
 *
 * Exists because the alternative — remembering to wrap each map — already
 * failed once: the first pass at this enumerated map surfaces by grepping for
 * `maplibre-gl` imports and missed twelve files, because a component that
 * imports only from `react-map-gl/maplibre` never contains that string. A rule
 * you have to remember at 19 call sites is a rule that will be missed again, so
 * the guard lives here and arrives by import instead.
 *
 * Drop-in: alias it to whatever local name the file already uses
 * (`import { GuardedMap as MapGL } from '…/GuardedMap'`) and nothing else in
 * the file changes. Children — `Source`, `Layer`, `NavigationControl` — still
 * come from `react-map-gl/maplibre`; they only ever render inside a map, so
 * they disappear with it.
 *
 * When WebGL is missing the ref is never attached. Every caller already
 * tolerates that: it is the same null the ref holds before the map loads.
 *
 * Prefer an early return in the component instead when overlays sit *over* the
 * map and drive it — a paint palette, a legend, instructions for clicking it.
 * Those have to disappear with the map rather than float above the explanation.
 */

import { forwardRef, type ComponentProps } from 'react';
import MapGL, { type MapRef } from 'react-map-gl/maplibre';
import { isWebGLAvailable } from '../../utils/webgl';
import { MapUnavailable } from './MapUnavailable';

type GuardedMapProps = ComponentProps<typeof MapGL> & {
  /** Surface-specific note on what still works — see `MapUnavailable`. */
  unavailableDetail?: string;
  /** Dense fallback layout, for maps in small panes. */
  unavailableCompact?: boolean;
};

export const GuardedMap = forwardRef<MapRef, GuardedMapProps>(function GuardedMap(
  { unavailableDetail, unavailableCompact, ...mapProps },
  ref,
) {
  if (!isWebGLAvailable()) {
    return <MapUnavailable detail={unavailableDetail} compact={unavailableCompact} />;
  }
  return <MapGL ref={ref} {...mapProps} />;
});
