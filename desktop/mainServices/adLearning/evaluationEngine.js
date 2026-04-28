'use strict';

const { createVideoFrameProcessor } = require('./videoFrameProcessor');
const { createSceneDetector } = require('./sceneDetector');
const { createRiskScorer } = require('./riskScorer');
const { createLearningPipeline } = require('./learningPipeline');

/**
 * Creates the evaluation engine: video risk assessment, sample import, and code-based learning.
 *
 * Facade layer - delegates to four sub-modules:
 *   - videoFrameProcessor  (FFmpeg frame extraction + video file collection)
 *   - sceneDetector         (Top-K voting + visual/transition detection)
 *   - riskScorer            (three-stage coarse/fine/ONNX risk evaluation)
 *   - learningPipeline      (sample import + code learning + auto-learn feedback)
 *
 * @param {{ hashCalculator: object, cacheManager: object, modelManager: object, fs: object, path: object, onnxInference?: object }} deps
 */
function createEvaluationEngine({ hashCalculator, cacheManager, modelManager, fs, path, onnxInference }) {
  const videoFrameProcessor = createVideoFrameProcessor({ hashCalculator, cacheManager, modelManager, fs, path });
  const sceneDetector = createSceneDetector();
  const riskScorer = createRiskScorer({
    modelManager, path, sceneDetector, videoFrameProcessor, onnxInference
  });
  const learningPipeline = createLearningPipeline({
    hashCalculator, modelManager, fs, path, sceneDetector, videoFrameProcessor, onnxInference
  });

  return {
    buildVideoHashes: videoFrameProcessor.buildVideoHashes,
    importSamples: learningPipeline.importSamples,
    learnSamplesByCodes: learningPipeline.learnSamplesByCodes,
    evaluateVideoRisk: riskScorer.evaluateVideoRisk,
    autoLearnFromDetection: learningPipeline.autoLearnFromDetection
  };
}

module.exports = { createEvaluationEngine };
