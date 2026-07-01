import { pipeline, env } from '@xenova/transformers';

// Suppress the "Downloading..." logs from transformers.js
env.allowLocalModels = true;

type FeatureExtractionPipeline = Awaited<ReturnType<typeof pipeline<'feature-extraction'>>>;

let embedder: FeatureExtractionPipeline | null = null;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;
  if (!loadPromise) {
    loadPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2').then(fn => {
      embedder = fn;
      return fn;
    }).catch(err => {
      loadPromise = null; // allow retry on next call
      throw err;
    });
  }
  return loadPromise;
}

export async function embed(text: string): Promise<Float32Array> {
  const fn = await getEmbedder();
  const result = await fn(text, { pooling: 'mean', normalize: true });
  return result.data as Float32Array;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  // Vectors are already normalized by the model, so dot product = cosine similarity
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function bufferToFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function float32ArrayToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}
