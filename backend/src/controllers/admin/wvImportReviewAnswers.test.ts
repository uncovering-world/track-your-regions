/**
 * A reviewer's answers to a waiting colour-match run, and the review screen's
 * images (ADR-0071): an answer to a question nobody holds any more is a 404,
 * and the cluster review's body is one of two shapes, told apart by `type`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./wvImportMatchReview.js', () => ({
  resolveWaterReview: vi.fn(),
  resolveClusterReview: vi.fn(),
  resolveIcpAdjustment: vi.fn(),
  getWaterCropImage: vi.fn(),
  getClusterPreviewImage: vi.fn(),
  getClusterHighlightImage: vi.fn(),
}));
vi.mock('../../services/cv/pythonReviewBridge.js', () => ({
  isPythonReviewId: (id: string) => id.startsWith('py-'),
  resolvePythonReview: vi.fn(),
}));

import {
  getClusterPreviewImage, getWaterCropImage, resolveClusterReview, resolveWaterReview,
} from './wvImportMatchReview.js';
import { resolvePythonReview } from '../../services/cv/pythonReviewBridge.js';
import {
  answerClusterReview, answerWaterReview, clusterPreviewImage, waterCropImage,
} from './wvImportReviewAnswers.js';
import { wvImportClusterReviewAnswerSchema } from '../../types/index.js';

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const WATER = { approvedIds: [1], mixDecisions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('the water review answer', () => {
  it('reaches the run holding the question', async () => {
    mocked(resolveWaterReview).mockReturnValue(true);
    await expect(answerWaterReview({ params: { reviewId: 'r1' }, body: WATER })).resolves.toEqual({ ok: true });
    expect(resolveWaterReview).toHaveBeenCalledWith('r1', WATER);
  });

  it('goes to the Python worker for a run there', async () => {
    mocked(resolvePythonReview).mockReturnValue(true);
    await answerWaterReview({ params: { reviewId: 'py-7' }, body: WATER });
    expect(resolvePythonReview).toHaveBeenCalledWith('py-7', WATER);
    expect(resolveWaterReview).not.toHaveBeenCalled();
  });

  it('is a 404 once nobody holds the question', async () => {
    mocked(resolveWaterReview).mockReturnValue(false);
    await expect(answerWaterReview({ params: { reviewId: 'r1' }, body: WATER }))
      .rejects.toMatchObject({ statusCode: 404, message: 'Review not found or expired' });
  });
});

describe('the cluster review answer', () => {
  it('hands the ordinary decisions on with numeric merge keys', async () => {
    mocked(resolveClusterReview).mockReturnValue(true);
    const body = wvImportClusterReviewAnswerSchema.parse({ merges: { 3: 1 }, excludes: [2] });
    await answerClusterReview({ params: { reviewId: 'r1' }, body });
    expect(resolveClusterReview).toHaveBeenCalledWith('r1', {
      merges: { 3: 1 }, excludes: [2], recluster: undefined, split: undefined,
    });
  });

  it('hands a painted overlay on as one', async () => {
    mocked(resolveClusterReview).mockReturnValue(true);
    const body = wvImportClusterReviewAnswerSchema.parse({
      type: 'manual_clusters', overlayPng: 'data:image/png;base64,AAAA', palette: [{ label: 0, color: [1, 2, 3] }],
    });
    await answerClusterReview({ params: { reviewId: 'r1' }, body });
    expect(mocked(resolveClusterReview).mock.calls[0][1]).toMatchObject({ type: 'manual_clusters' });
  });

  it('refuses a painted overlay missing its picture rather than reading it as no decisions', () => {
    expect(wvImportClusterReviewAnswerSchema.safeParse({ type: 'manual_clusters', palette: [] }).success).toBe(false);
  });
});

describe('the review screen images', () => {
  it('answers a crop as its bytes, drawable from another origin', async () => {
    mocked(getWaterCropImage).mockReturnValue(`data:image/png;base64,${Buffer.from('png!').toString('base64')}`);
    const image = await waterCropImage({ params: { reviewId: 'r1', componentId: 1, subCluster: 0 } });
    expect(image).toMatchObject({ contentType: 'image/png', crossOrigin: true });
    expect(image.bytes.toString()).toBe('png!');
  });

  it('is a 404 for a preview nobody holds', async () => {
    mocked(getClusterPreviewImage).mockReturnValue(undefined);
    await expect(clusterPreviewImage({ params: { reviewId: 'r1' } }))
      .rejects.toMatchObject({ statusCode: 404, message: 'Preview not found' });
  });
});
