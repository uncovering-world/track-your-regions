/**
 * What Discover's map is built from, pinned against the scene both maps draw
 * (`experienceMarkers/scene.ts`).
 *
 * Discover adds its layers by calling MapLibre, not through JSX, so nothing but
 * this spec connects what it adds to the declaration: a paint value restated
 * here, a layer id spelled by hand or an overlay added out of order would each
 * put the two maps back to drawing a pin, a badge or a ring two ways. The one
 * declared difference is the clustering — the bubbles, their counts and the
 * not-a-cluster test on every pin layer — and the spec holds it to exactly that.
 *
 * The map is a fake that records the calls: nothing here is about WebGL.
 */

import { describe, it, expect, vi } from 'vitest';
import type * as maplibregl from 'maplibre-gl';
import {
  addDiscoverMapLayers, LAYER_CLUSTERS, LAYER_CLUSTER_COUNT, NOT_CLUSTER,
} from './discoverMapLayers';
import {
  SCENE_SOURCES, SCENE_MARKER_ORDER, SCENE_OVERLAY_ORDER,
} from '../experienceMarkers/scene';

type AddedLayer = {
  id: string;
  type: string;
  source?: string;
  filter?: unknown;
  layout?: unknown;
  paint?: unknown;
};

function build() {
  const addSource = vi.fn();
  const addLayer = vi.fn();
  addDiscoverMapLayers({ addSource, addLayer } as unknown as maplibregl.Map);
  const layers = addLayer.mock.calls.map(([layer]) => layer as AddedLayer);
  const sources = addSource.mock.calls.map(([id, spec]) => ({ id: id as string, spec: spec as Record<string, unknown> }));
  return { layers, sources, layer: (id: string) => layers.find(l => l.id === id) };
}

describe("Discover's layers", () => {
  it('are its clusters, then the scene pins, then the scene overlays, in the declared order', () => {
    const { layers } = build();
    expect(layers.map(l => l.id)).toEqual([
      LAYER_CLUSTERS, LAYER_CLUSTER_COUNT,
      ...SCENE_MARKER_ORDER.map(l => l.id),
      ...SCENE_OVERLAY_ORDER.map(l => l.id),
    ]);
  });

  it.each([...SCENE_MARKER_ORDER, ...SCENE_OVERLAY_ORDER].map(l => [l.id, l] as const))(
    '%s is drawn as the scene declares it',
    (id, declared) => {
      const added = build().layer(id);
      expect(added).toBeDefined();
      expect(added?.type).toBe(declared.type);
      expect(added?.source).toBe(declared.source);
      expect(added?.paint).toEqual(declared.paint);
      expect(added?.layout).toEqual('layout' in declared ? declared.layout : undefined);
    },
  );

  it("keeps each pin layer off the clusters, and adds nothing else to its filter", () => {
    const { layer } = build();
    for (const declared of SCENE_MARKER_ORDER) {
      const expected = declared.filter ? ['all', NOT_CLUSTER, declared.filter] : NOT_CLUSTER;
      expect(layer(declared.id)?.filter).toEqual(expected);
    }
  });

  it('adds the overlays exactly as declared, filter and all', () => {
    const { layer } = build();
    for (const declared of SCENE_OVERLAY_ORDER) {
      expect(layer(declared.id)).toEqual(declared);
    }
  });
});

describe("Discover's sources", () => {
  it('are the scene sources, and only the markers cluster', () => {
    const { sources } = build();
    expect(sources.map(s => s.id)).toEqual([
      SCENE_SOURCES.markers, SCENE_SOURCES.highlight, SCENE_SOURCES.hover,
    ]);
    const clusterKeys = ['cluster', 'clusterMaxZoom', 'clusterRadius'];
    for (const { id, spec } of sources) {
      expect(spec.type).toBe('geojson');
      for (const key of clusterKeys) {
        if (id === SCENE_SOURCES.markers) expect(spec).toHaveProperty(key);
        else expect(spec).not.toHaveProperty(key);
      }
    }
    expect(sources[0].spec).toMatchObject({ cluster: true, clusterMaxZoom: 12, clusterRadius: 50 });
  });

  it('draw the clusters from the markers source', () => {
    const { layer } = build();
    expect(layer(LAYER_CLUSTERS)?.source).toBe(SCENE_SOURCES.markers);
    expect(layer(LAYER_CLUSTER_COUNT)?.source).toBe(SCENE_SOURCES.markers);
  });
});
