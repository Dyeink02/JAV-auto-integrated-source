'use strict';

/**
 * ONNX runtime inference module for JAV ad detection.
 *
 * Uses onnxruntime-node to run MobileNetV3 Small on video frames,
 * extracting 576-dim embeddings for comparison with learned ad/normal samples.
 *
 * Two output modes:
 *   1) classify - ImageNet 1000-class prediction (for general scene understanding)
 *   2) embedding - 576-dim feature vector (for ad/normal similarity matching)
 */

const ort = require('onnxruntime-node');
const path = require('path');

const MODEL_FILENAME = 'mobile-net-v3-small.onnx';
const INPUT_SIZE = 224;

/**
 * @param {{ app: object, fs: object, path: object }} deps
 */
function createOnnxInference({ app, fs, path: pathMod }) {
  let session = null;
  let sessionLoading = null;
  let modelAvailable = null; // null = unchecked, true/false after check

  // ── Internal helpers ──────────────────────────────────────────────────

  function resolveModelPath() {
    // Priority 1: userData (allows user to override with custom model)
    const userDataPath = pathMod.join(app.getPath('userData'), MODEL_FILENAME);
    if (fs.existsSync(userDataPath)) return userDataPath;

    // Priority 2: resources (bundled with app)
    const resourcePath = pathMod.join(process.resourcesPath || '', MODEL_FILENAME);
    if (fs.existsSync(resourcePath)) return resourcePath;

    // Priority 3: resources/models subdirectory
    const modelsPath = pathMod.join(process.resourcesPath || '', 'models', MODEL_FILENAME);
    if (fs.existsSync(modelsPath)) return modelsPath;

    // Priority 4: development path
    const devPath = pathMod.join(__dirname, '..', '..', 'resources', 'models', MODEL_FILENAME);
    if (fs.existsSync(devPath)) return devPath;

    return null;
  }

  function isModelAvailable() {
    if (modelAvailable !== null) return modelAvailable;
    modelAvailable = !!resolveModelPath();
    return modelAvailable;
  }

  async function getSession() {
    if (session) return session;
    if (sessionLoading) return sessionLoading;

    const modelPath = resolveModelPath();
    if (!modelPath) {
      throw new Error('ONNX model file not found: ' + MODEL_FILENAME);
    }

    sessionLoading = ort.InferenceSession.create(modelPath, {
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
      enableCpuMemArena: true
    });

    session = await sessionLoading;
    sessionLoading = null;

    // Log session info
    try {
      const inputNames = session.inputNames;
      const outputNames = session.outputNames;
      console.log(`[ONNX] 模型加载成功: ${MODEL_FILENAME} (inputs: ${inputNames.join(',')}, outputs: ${outputNames.join(',')})`);
    } catch (_) { /* logging best-effort */ }

    return session;
  }

  /**
   * Preprocesses a raw RGB pixel buffer into a normalized Float32Array
   * ready for MobileNetV3 inference.
   *
   * @param {Buffer|Uint8Array} pixelData - Raw RGB pixel data (INPUT_SIZE × INPUT_SIZE × 3)
   * @returns {Float32Array} CHW format, normalized to [0, 1] with ImageNet stats
   */
  function preprocessFrame(pixelData) {
    const totalPixels = INPUT_SIZE * INPUT_SIZE;
    const channels = 3;
    const floatData = new Float32Array(totalPixels * channels);

    // ImageNet normalization stats
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < totalPixels; i++) {
      const srcIdx = i * channels;
      for (let c = 0; c < channels; c++) {
        const val = (pixelData[srcIdx + c] || 0) / 255.0;
        floatData[c * totalPixels + i] = (val - mean[c]) / std[c];
      }
    }

    return floatData;
  }

  /**
   * Creates a simple Float32Array from RGB data without full preprocessing.
   * Used when the frame data comes from a different source.
   *
   * @param {number[]|Float32Array} rgbFlat - Flat RGB array [0-255]
   * @returns {Float32Array}
   */
  function rgbToTensor(rgbFlat) {
    const totalPixels = INPUT_SIZE * INPUT_SIZE;
    const channels = 3;
    const tensor = new Float32Array(1 * channels * INPUT_SIZE * INPUT_SIZE);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];

    for (let i = 0; i < Math.min(rgbFlat.length / channels, totalPixels); i++) {
      for (let c = 0; c < channels; c++) {
        const val = (rgbFlat[i * channels + c] || 0) / 255.0;
        tensor[c * totalPixels + i] = (val - mean[c]) / std[c];
      }
    }

    return tensor;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Checks if the ONNX model file is available and loads the session.
   * Returns true if ready, false if model is missing.
   */
  async function ensureReady() {
    if (!isModelAvailable()) return false;
    try {
      await getSession();
      return true;
    } catch (err) {
      console.warn('[ONNX] 模型初始化失败:', err.message);
      modelAvailable = false;
      return false;
    }
  }

  /**
   * Runs inference on a preprocessed frame tensor.
   *
   * @param {Float32Array|number[]} inputTensor - CHW normalized tensor of shape [1, 3, 224, 224]
   * @returns {Promise<{ logits: number[], embedding: number[] }>}
   */
  async function predict(inputTensor) {
    const sess = await getSession();
    const dims = [1, 3, INPUT_SIZE, INPUT_SIZE];
    const tensor = new ort.Tensor('float32', Float32Array.from(inputTensor), dims);

    const feeds = {};
    feeds[sess.inputNames[0]] = tensor;
    const results = await sess.run(feeds);

    const logits = Array.from(results.logits?.data || results[sess.outputNames[0]]?.data || []);
    const embedding = Array.from(results.embedding?.data || results[sess.outputNames[1]]?.data || []);

    return { logits, embedding };
  }

  /**
   * Computes cosine similarity between two embedding vectors.
   *
   * @param {number[]} embA
   * @param {number[]} embB
   * @returns {number} similarity in [-1, 1], higher = more similar
   */
  function cosineSimilarity(embA, embB) {
    if (!embA || !embB || embA.length === 0 || embB.length === 0) return 0;

    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(embA.length, embB.length);
    for (let i = 0; i < len; i++) {
      dot += (embA[i] || 0) * (embB[i] || 0);
      normA += (embA[i] || 0) ** 2;
      normB += (embB[i] || 0) ** 2;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Computes embedding for a frame and compares it to stored ad/normal embeddings.
   *
   * @param {Float32Array} inputTensor - preprocessed frame tensor
   * @param {Array<{embedding: number[], label: string}>} referenceEmbeddings
   * @returns {{ embedding: number[], bestMatch: {index: number, similarity: number, label: string}|null, topMatches: Array }}
   */
  async function compareEmbedding(inputTensor, referenceEmbeddings = []) {
    const { embedding } = await predict(inputTensor);

    if (!referenceEmbeddings.length) {
      return { embedding, bestMatch: null, topMatches: [] };
    }

    const matches = referenceEmbeddings
      .map((ref, index) => ({
        index,
        label: ref.label,
        similarity: cosineSimilarity(embedding, ref.embedding)
      }))
      .sort((a, b) => b.similarity - a.similarity);

    return {
      embedding,
      bestMatch: matches[0] || null,
      topMatches: matches.slice(0, 5)
    };
  }

  return {
    isModelAvailable,
    ensureReady,
    predict,
    compareEmbedding,
    cosineSimilarity,
    preprocessFrame,
    rgbToTensor,
    INPUT_SIZE,
    getSession
  };
}

module.exports = { createOnnxInference };
