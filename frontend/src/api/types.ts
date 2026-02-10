/**
 * API types
 */

import type { GeoJSONFeature } from '../types';

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

export interface HullParams {
  bufferKm: number;
  concavity: number;
  simplifyTolerance: number;
}

export const DEFAULT_HULL_PARAMS: HullParams = {
  bufferKm: 50,
  concavity: 0.9,
  simplifyTolerance: 0.02,
};

export interface ComputationStatus {
  running: boolean;
  progress?: number;
  total?: number;
  status?: string;
  percent?: number;
  computed?: number;
  skipped?: number;
  errors?: number;
  currentRegion?: string;
  currentMembers?: number;
}

export interface ComputationStartResult {
  started?: boolean;
  total?: number;
  needsComputation?: number;
  alreadyComputed?: number;
  message?: string;
  error?: string;
}

export interface DisplayGeometryStatus {
  total: number;
  withGeom: number;
  withDisplayGeom: number;
  withAnchor: number;
  archipelagos: number;
  withTsHull?: number;
}

export interface RegenerateDisplayGeometriesResult {
  regenerated: number;
  message: string;
}
