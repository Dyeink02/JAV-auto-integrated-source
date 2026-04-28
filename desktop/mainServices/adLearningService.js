'use strict';

/**
 * adLearningService - facade module.
 *
 * Assembles focused sub-modules into a single cohesive ad-learning service:
 *
 *   adLearning/hashCalculator.js   - FFmpeg-based perceptual hash computation
 *   adLearning/cacheManager.js     - Hash cache with dirty-flag batch writes
 *   adLearning/modelManager.js     - Learning model load / save / update
 *   adLearning/evaluationEngine.js - Risk evaluation + parallel frame extraction
 *   adLearning/onnxInference.js    - Real ONNX MobileNetV3 neural inference
 */

const { createHashCalculator } = require('./adLearning/hashCalculator');
const { createCacheManager } = require('./adLearning/cacheManager');
const { createModelManager } = require('./adLearning/modelManager');
const { createEvaluationEngine } = require('./adLearning/evaluationEngine');
const { createOnnxInference } = require('./adLearning/onnxInference');

/**
 * Creates the ad-learning service.
 *
 * @param {{ app: import('electron').App, fs: typeof import('fs'), path: typeof import('path') }} deps
 */
function createAdLearningService({ app, fs, path }) {
  const hashCalculator = createHashCalculator({ app, fs, path });
  const cacheManager = createCacheManager({ app, fs, path });
  const modelManager = createModelManager({ app, fs, path });
  const onnxInference = createOnnxInference({ app, fs, path });
  const engine = createEvaluationEngine({
    hashCalculator, cacheManager, modelManager, fs, path, onnxInference
  });

  return {
    /** Returns the absolute path of the persisted model JSON file. */
    getModelPath: modelManager.getModelPath,

    /** Returns the loaded model object. */
    loadModel: function () { return modelManager.loadModel(); },

    /** Returns a summary of the current model state. */
    getSummary: function () { return modelManager.getSummary(); },

    /** Clears all learning data (model, samples, templates). */
    clearModel: function () { return modelManager.clearModel(); },

    /** Updates model keywords, thresholds, and active model type. */
    updateModel: function (opts) { return modelManager.updateModel(opts); },

    /** Imports ad/normal sample files (images or videos) into the model. */
    importSamples: function (opts) { return engine.importSamples(opts); },

    /** Learns ad/normal samples by matching video files to film codes. */
    learnSamplesByCodes: function (opts) { return engine.learnSamplesByCodes(opts); },

    /** Evaluates a video's ad risk using the three-stage (coarse + fine + ONNX) pipeline. */
    evaluateVideoRisk: function (opts) { return engine.evaluateVideoRisk(opts); },

    /** Flushes any pending dirty cache entries to disk (call on app exit). */
    flushHashCache: function () { return cacheManager.flushHashCache(); },

    /** Auto-learns from high-confidence detection results (feedback loop). */
    autoLearnFromDetection: function (opts) { return engine.autoLearnFromDetection(opts); },

    /** Checks if ONNX model is available. */
    isOnnxAvailable: function () { return onnxInference.isModelAvailable(); }
  };
}

module.exports = { createAdLearningService };
