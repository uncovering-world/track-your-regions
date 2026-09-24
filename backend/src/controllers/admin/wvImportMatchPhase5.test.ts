import { describe, expect, it } from 'vitest';
import { ColorMatchComplete } from '../../api/responses/wvImportCvMatch.js';
import { buildCompletePayload, type BuildCompletePayloadParams } from './wvImportMatchPhase5.js';

// Angola's colour match: Cabinda province (GADM 2607) already belongs to the
// Cabinda region, and one cluster covers Luanda province (GADM 2886), which no
// child region holds yet. The cluster's colour and the centroids are illustrative.
const luandaCluster = {
  clusterId: 4,
  color: '#e4b36a',
  pixelShare: 0.03,
  suggestedRegion: { id: 165, name: 'Greater Luanda' },
  divisions: [{ id: 2886, name: 'Luanda', confidence: 0.91, depth: 0 }],
  unsplittable: [],
};

function params(overrides: Partial<BuildCompletePayloadParams> = {}): BuildCompletePayloadParams {
  return {
    cvClusterResult: [luandaCluster],
    cvChildRegions: [{ id: 170, name: 'Cabinda' }, { id: 165, name: 'Greater Luanda' }],
    cvOutOfBounds: [],
    debugImages: [{ label: 'Step 1: GADM divisions', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    geoPreview: { featureCollection: { type: 'FeatureCollection', features: [] }, clusterInfos: [] },
    spatialAnomalies: [],
    adjacencyEdges: [],
    centroids: [
      { id: 2607, cx: 12.3, cy: -5.1, assigned: { regionId: 170, regionName: 'Cabinda' } },
      { id: 2886, cx: 13.3, cy: -8.9, assigned: null },
    ],
    assignedCount: 1,
    countryName: 'Angola',
    startTime: Date.now(),
    ...overrides,
  };
}

describe('the colour-match run\'s last event', () => {
  it('is a complete event the stream\'s schema holds', () => {
    const event = ColorMatchComplete.parse(buildCompletePayload(params()));
    expect(event.data.stats).toEqual({
      totalDivisions: 2,
      assignedDivisions: 1,
      cvClusters: 1,
      cvAssignedDivisions: 1,
      cvUnsplittable: 0,
      cvOutOfBounds: 0,
      countryName: 'Angola',
    });
  });

  it('leaves out the lists a run found nothing for', () => {
    const sent = JSON.parse(JSON.stringify(buildCompletePayload(params())));
    expect(sent.data).not.toHaveProperty('outOfBounds');
    expect(sent.data).not.toHaveProperty('spatialAnomalies');
    expect(sent.data).not.toHaveProperty('adjacencyEdges');
  });

  it('sends the divisions outside the map where there are some', () => {
    const payload = buildCompletePayload(params({ cvOutOfBounds: [{ id: 2607, name: 'Cabinda' }] }));
    expect(ColorMatchComplete.parse(payload).data.outOfBounds).toEqual([{ id: 2607, name: 'Cabinda' }]);
  });
});
