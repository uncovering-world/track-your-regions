/**
 * ML model management — download, cache, and provide ONNX inference sessions.
 *
 * Models are downloaded on first use to `backend/data/models/` (gitignored).
 * Sessions are cached on globalThis to survive tsx hot-reloads.
 */

import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { stat, unlink, rename } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import * as ort from 'onnxruntime-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../data/models');

const TEXT_DET_MODEL = {
  filename: 'ch_PP-OCRv4_det_infer.onnx',
  url: 'https://huggingface.co/breezedeus/cnstd-ppocr-ch_PP-OCRv4_det/resolve/main/ch_PP-OCRv4_det_infer.onnx',
  expectedSizeMB: 4.75, // ±0.5MB tolerance
};

// Cache on globalThis to survive tsx hot-reloads (same pattern as OpenCV WASM)
const G = globalThis as unknown as {
  __textDetSession?: ort.InferenceSession | null;
  __textDetSessionReady?: Promise<ort.InferenceSession | null>;
};

async function downloadModel(url: string, destPath: string): Promise<void> {
  console.log(`[ML Models] Downloading ${path.basename(destPath)}...`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TrackYourRegions/1.0 (ML model download)' },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const tmpPath = destPath + '.tmp';
  const fileStream = createWriteStream(tmpPath);
  await pipeline(Readable.fromWeb(response.body as ReadableStream), fileStream);
  // Verify file size (±0.5MB tolerance)
  const stats = await stat(tmpPath);
  const sizeMB = stats.size / (1024 * 1024);
  if (Math.abs(sizeMB - TEXT_DET_MODEL.expectedSizeMB) > 0.5) {
    await unlink(tmpPath);
    throw new Error(`Model size mismatch: expected ~${TEXT_DET_MODEL.expectedSizeMB}MB, got ${sizeMB.toFixed(2)}MB`);
  }
  await rename(tmpPath, destPath);
  console.log(`[ML Models] Downloaded ${path.basename(destPath)} (${sizeMB.toFixed(1)}MB)`);
}

/**
 * Get the text detection ONNX session. Returns null if model is unavailable
 * (download failed, session creation failed). Caller should fall back to BlackHat.
 */
export function getTextDetSession(): Promise<ort.InferenceSession | null> {
  if (G.__textDetSessionReady) return G.__textDetSessionReady;

  G.__textDetSessionReady = (async () => {
    try {
      mkdirSync(MODELS_DIR, { recursive: true });
      const modelPath = path.join(MODELS_DIR, TEXT_DET_MODEL.filename);

      if (!existsSync(modelPath)) {
        await downloadModel(TEXT_DET_MODEL.url, modelPath);
      }

      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
      });
      G.__textDetSession = session;
      console.log('[ML Models] Text detection session ready');
      return session;
    } catch (err) {
      console.warn('[ML Models] Text detection unavailable, will use BlackHat fallback:', err instanceof Error ? err.message : err);
      G.__textDetSession = null;
      return null;
    }
  })();

  return G.__textDetSessionReady;
}
