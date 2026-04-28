'use strict';

const { hashBitsToHex } = require('./hashCalculator');
const { TOP_K_VOTE_COUNT, URL_PATTERN, AD_THRESHOLD_MAX, BOOTSTRAP_MODE_THRESHOLD } = require('./constants');

/**
 * Creates the risk scorer: three-stage (coarse + fine + ONNX neural) video ad risk evaluation.
 *
 * @param {{ modelManager: object, path: object, sceneDetector: object, videoFrameProcessor: object, onnxInference?: object }} deps
 */
function createRiskScorer({ modelManager, path, sceneDetector, videoFrameProcessor, onnxInference }) {
  const { findTopKSampleMatch, detectVisualFeatures, detectFrameTransition } = sceneDetector;
  const { buildVideoHashes, clamp } = videoFrameProcessor;

  /**
   * Evaluates a video's ad risk using the V3 three-stage detection pipeline.
   */
  async function evaluateVideoRiskV3(options = {}) {
    const videoPath = String(options.videoPath || '').trim();
    if (!videoPath) throw new Error('videoPath cannot be empty.');

    function pickMatchPayload(match, includeFilmCode = false) {
      if (!match) return null;
      const payload = {
        sampleId: match.sampleId || '',
        distance: match.distance,
        sourcePath: match.sourcePath || '',
        frameSecond: match.frameSecond
      };
      if (includeFilmCode) payload.filmCode = match.filmCode || '';
      return payload;
    }

    const model = modelManager.ensureLearningModelShape(modelManager.loadModel());
    const modelType = modelManager.normalizeAdModelType(
      options.modelType || (model.meta && model.meta.activeModel)
    );
    const modelPreset = modelManager.getAdModelPreset(modelType);
    const frameSeconds = modelManager.getModelFrameSeconds(modelType);
    const parsedThreshold = Number.parseInt(String(options.adThreshold ?? '').trim(), 10);
    const userThreshold = Number.isFinite(parsedThreshold)
      ? Math.max(1, Math.min(AD_THRESHOLD_MAX, parsedThreshold))
      : model.thresholds.adScore || 60;

    const bootstrapMode = (model.adSamples || []).length === 0 && (model.introTemplates || []).length === 0;
    const hasModelData = (model.adSamples || []).length > 0 || (model.introTemplates || []).length > 0;
    const resolvedThreshold = bootstrapMode ? Math.min(userThreshold, BOOTSTRAP_MODE_THRESHOLD) : userThreshold;

    const filename = path.basename(videoPath).toLowerCase();
    const reasons = [];
    let score = 0;

    const MAX_REASONS = 30;
    const keywordHits = (model.keywords || []).filter((keyword) => filename.includes(keyword));
    const domainPatternHit = URL_PATTERN.test(filename);

    if (keywordHits.length > 0) {
      const keywordScore = Math.min(
        modelPreset.keywordScoreMax,
        keywordHits.length * modelPreset.keywordScorePerHit
      );
      score += keywordScore;
      reasons.push('命中广告关键词：' + keywordHits.join(', '));
    }

    if (domainPatternHit) {
      score += modelPreset.domainPatternScore;
      reasons.push('文件名疑似包含广告站点域名特征');
    }

    const {
      ffmpegAvailable, aHashes, dHashes, frameStatsList, fromCache, blackFrameCount, staticFrameCount
    } = await buildVideoHashes(videoPath, frameSeconds);

    // Filter out black frames for matching
    const alignedDHashes = aHashes.map((_, i) => (dHashes[i] || ''));
    const filteredAHashes = [];
    const filteredDHashes = [];
    let filteredBlackCount = 0;
    for (let i = 0; i < aHashes.length; i++) {
      const stats = frameStatsList[i];
      if (stats && stats.isBlack) {
        filteredBlackCount++;
        continue;
      }
      filteredAHashes.push(aHashes[i]);
      filteredDHashes.push(alignedDHashes[i]);
    }
    if (filteredBlackCount > 0) {
      reasons.push('跳过 ' + filteredBlackCount + ' 个黑帧');
    }

    const matchAHashes = filteredAHashes.length > 0 ? filteredAHashes : aHashes;
    const matchDHashes = filteredAHashes.length > 0 ? filteredDHashes : alignedDHashes;

    // Top-K voting for ad, normal, and template samples
    const adTopK = findTopKSampleMatch(matchAHashes, matchDHashes, model.adSamples || []);
    const normalTopK = findTopKSampleMatch(matchAHashes, matchDHashes, model.normalSamples || []);
    const templateTopK = findTopKSampleMatch(
      matchAHashes, matchDHashes,
      (model.introTemplates || []).map((item) => ({ ...item, label: 'intro-template' }))
    );

    const adMatch = adTopK.matches.length > 0 ? adTopK.matches[0] : null;
    const normalMatch = normalTopK.matches.length > 0 ? normalTopK.matches[0] : null;
    const templateMatch = templateTopK.matches.length > 0 ? templateTopK.matches[0] : null;

    // Coarse stage
    const coarseByTemplate =
      (templateTopK.matches.length > 0 && templateTopK.voteCount >= 1 && templateTopK.avgDistance <= model.thresholds.lowSimilarityDistance) ||
      (templateTopK.matches.length > 0 && templateTopK.bestDistance <= model.thresholds.highSimilarityDistance);
    const coarseByAdSample =
      (adTopK.matches.length > 0 && adTopK.voteCount >= 1 && adTopK.avgDistance <= model.thresholds.lowSimilarityDistance) ||
      (adTopK.matches.length > 0 && adTopK.bestDistance <= model.thresholds.highSimilarityDistance);
    const coarseByKeyword = keywordHits.length > 0 || domainPatternHit;

    // Visual coarse channel
    const { coarseByVisual, visualReason } = detectVisualFeatures(matchAHashes, frameStatsList, staticFrameCount, bootstrapMode);

    // Frame transition detection
    const { coarseByTransition, transitionReason } = detectFrameTransition(matchAHashes, aHashes, frameSeconds, frameStatsList);

    const coarsePassed = Boolean(coarseByTemplate || coarseByAdSample || coarseByKeyword || coarseByVisual || coarseByTransition);

    const buildEvidenceBase = () => ({
      frameHashes: (aHashes || []).map((hashBits, index) => ({
        index, frameSecond: frameSeconds[index] || null,
        hashBits,
        hashBitsD: alignedDHashes[index] || '',
        hashHex: hashBitsToHex(hashBits),
        isBlack: frameStatsList[index] ? frameStatsList[index].isBlack : false,
        isStatic: frameStatsList[index] ? frameStatsList[index].isStatic : false
      })),
      keywordHits,
      model: { modelType, modelLabel: modelPreset.label, frameSeconds },
      bestTemplateMatch: templateMatch
        ? { templateId: templateMatch.sampleId || '', distance: templateMatch.distance, sourcePath: templateMatch.sourcePath || '', frameSecond: templateMatch.frameSecond }
        : null,
      bestAdSampleMatch: pickMatchPayload(adMatch, true),
      bestNormalSampleMatch: pickMatchPayload(normalMatch, true),
      cacheInfo: { fromCache: Boolean(fromCache) },
      topKInfo: {
        adVoteCount: adTopK.voteCount, adAvgDistance: Math.round(adTopK.avgDistance * 100) / 100,
        normalVoteCount: normalTopK.voteCount, normalAvgDistance: Math.round(normalTopK.avgDistance * 100) / 100
      }
    });

    // Soft-pass: when model has sample data, always proceed to fine stage
    if (!coarsePassed && !hasModelData) {
      reasons.unshift('模型策略：' + modelPreset.label);
      reasons.push('FFmpeg粗筛未命中广告特征且模型无样本数据，跳过AI精筛。');
      return {
        videoPath, modelType, modelLabel: modelPreset.label, ffmpegAvailable,
        hashesFromCache: Boolean(fromCache), score: 0, threshold: resolvedThreshold, isAd: false,
        reasons, bestAdDistance: adMatch ? adMatch.distance : null,
        bestNormalDistance: normalMatch ? normalMatch.distance : null,
        sampleCounts: {
          ad: (model.adSamples || []).length, normal: (model.normalSamples || []).length,
          introTemplates: (model.introTemplates || []).length
        },
        evidence: {
          ...buildEvidenceBase(),
          onnx: null,
          coarseStage: { passed: false, byTemplate: null, byAdSample: null, byKeyword: coarseByKeyword, byVisual: false, byTransition: false, bootstrapMode }
        }
      };
    }
    if (!coarsePassed && hasModelData) {
      reasons.push('粗筛未命中但模型有样本数据，进入精筛（软通过）。');
    }

    // Coarse contributions
    if (coarseByTemplate) {
      const dist = templateTopK.avgDistance;
      if (dist <= model.thresholds.highSimilarityDistance) {
        score += 20;
        reasons.push('FFmpeg粗筛命中片头模板（高相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else {
        score += 12;
        reasons.push('FFmpeg粗筛命中片头模板（中低相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      }
    }

    if (coarseByAdSample) {
      const dist = adTopK.avgDistance;
      if (dist <= model.thresholds.highSimilarityDistance) {
        score += 20;
        reasons.push('FFmpeg粗筛命中广告样本（高相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else {
        score += 10;
        reasons.push('FFmpeg粗筛命中广告样本（中相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      }
    }

    if (coarseByVisual) {
      const visualScore = bootstrapMode ? 12 : 5;
      score += visualScore;
      reasons.push(visualReason);
    }

    if (coarseByTransition) {
      score += 8;
      reasons.push(transitionReason);
    }

    // Fine stage
    if (templateTopK.matches.length > 0) {
      const dist = templateTopK.avgDistance;
      if (dist <= model.thresholds.highSimilarityDistance) {
        score += modelPreset.templateScore.high;
        reasons.push('命中片头模板（高相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else if (dist <= model.thresholds.mediumSimilarityDistance) {
        score += modelPreset.templateScore.medium;
        reasons.push('命中片头模板（中相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else if (dist <= model.thresholds.lowSimilarityDistance) {
        score += modelPreset.templateScore.low;
        reasons.push('命中片头模板（低相似，Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      }
    }

    if (adTopK.matches.length > 0) {
      const dist = adTopK.avgDistance;
      if (dist <= model.thresholds.highSimilarityDistance) {
        score += modelPreset.adSampleScore.high;
        reasons.push('与广告样本高相似（Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else if (dist <= model.thresholds.mediumSimilarityDistance) {
        score += modelPreset.adSampleScore.medium;
        reasons.push('与广告样本中相似（Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else if (dist <= model.thresholds.lowSimilarityDistance) {
        score += modelPreset.adSampleScore.low;
        reasons.push('与广告样本低相似（Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      }
    }

    if (normalTopK.matches.length > 0) {
      const dist = normalTopK.avgDistance;
      if (dist <= model.thresholds.highSimilarityDistance) {
        score -= modelPreset.normalSamplePenalty.high;
        reasons.push('与正常样本高相似（Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      } else if (dist <= model.thresholds.mediumSimilarityDistance) {
        score -= modelPreset.normalSamplePenalty.medium;
        reasons.push('与正常样本中相似（Top-K均距 ' + Math.round(dist * 10) / 10 + '）');
      }
    }

    // Top-K voting consistency bonus
    if (adTopK.matches.length >= TOP_K_VOTE_COUNT && adTopK.voteCount >= TOP_K_VOTE_COUNT) {
      score += 8;
      reasons.push('Top-' + TOP_K_VOTE_COUNT + '投票一致命中广告（奖励8分）');
    }

    // ── ONNX Neural Stage (real MobileNetV3 CNN inference) ──────────────
    let onnxEvidence = null;
    if (onnxInference && onnxInference.isModelAvailable()) {
      try {
        const onnxResult = await evaluateOnnxStage({
          videoPath, frameSeconds, model,
          onnxInference, modelPreset, reasons
        });
        if (onnxResult) {
          score += onnxResult.scoreBonus;
          onnxEvidence = onnxResult.evidence;
        }
      } catch (onnxErr) {
        reasons.push('ONNX推理跳过: ' + (onnxErr && onnxErr.message ? onnxErr.message : 'unknown'));
      }
    }

    score = clamp(score, 0, 100);
    const isAd = score >= resolvedThreshold;
    if (reasons.length > MAX_REASONS) reasons.length = MAX_REASONS;
    reasons.unshift('模型策略：' + modelPreset.label);

    return {
      videoPath, modelType, modelLabel: modelPreset.label, ffmpegAvailable,
      hashesFromCache: Boolean(fromCache), score, threshold: resolvedThreshold, isAd,
      reasons, bestAdDistance: adMatch ? adMatch.distance : null,
      bestNormalDistance: normalMatch ? normalMatch.distance : null,
      sampleCounts: {
        ad: (model.adSamples || []).length, normal: (model.normalSamples || []).length,
        introTemplates: (model.introTemplates || []).length
      },
      evidence: {
        ...buildEvidenceBase(),
        onnx: onnxEvidence,
        coarseStage: {
          passed: true,
          byTemplate: coarseByTemplate ? { avgDistance: Math.round(templateTopK.avgDistance * 10) / 10, voteCount: templateTopK.voteCount } : null,
          byAdSample: coarseByAdSample ? { avgDistance: Math.round(adTopK.avgDistance * 10) / 10, voteCount: adTopK.voteCount } : null,
          byKeyword: coarseByKeyword,
          byVisual: coarseByVisual,
          byTransition: coarseByTransition,
          visualReason: visualReason || '',
          transitionReason: transitionReason || '',
          bootstrapMode
        }
      }
    };
  }

  /**
   * ONNX neural network stage: runs real MobileNetV3 inference on video frames,
   * compares embeddings with stored ad/normal reference embeddings,
   * and returns bonus score contributions.
   */
  async function evaluateOnnxStage({ videoPath, frameSeconds, model, onnxInference, modelPreset, reasons }) {
    if (!onnxInference || !onnxInference.isModelAvailable()) return null;

    const ready = await onnxInference.ensureReady();
    if (!ready) {
      reasons.push('ONNX模型未就绪，跳过神经网络推理。');
      return null;
    }

    // Get stored ONNX embeddings from model
    const adEmbeddings = (model.onnxAdEmbeddings || []).filter(function(e) { return e && e.embedding && e.embedding.length > 0; });
    const normalEmbeddings = (model.onnxNormalEmbeddings || []).filter(function(e) { return e && e.embedding && e.embedding.length > 0; });
    const referenceEmbeddings = [].concat(
      adEmbeddings.map(function(e) { return { embedding: e.embedding, label: 'ad', sampleId: e.sampleId }; }),
      normalEmbeddings.map(function(e) { return { embedding: e.embedding, label: 'normal', sampleId: e.sampleId }; })
    );

    if (referenceEmbeddings.length === 0) {
      reasons.push('缺少ONNX参考嵌入向量（无学习样本），跳过神经网络推理。');
      return null;
    }

    // Extract frames for ONNX (use same timestamps as hash stage)
    const frameResults = await videoFrameProcessor.extractOnnxFrames(videoPath, frameSeconds);
    if (!frameResults || !frameResults.frames || frameResults.frames.length === 0) {
      reasons.push('ONNX帧提取失败，跳过神经网络推理。');
      return null;
    }

    let totalBonus = 0;
    const frameMatches = [];
    const onnxBonus = modelPreset.onnxBonus || { embeddingHighSim: 25, embeddingMedSim: 15, embeddingLowSim: 8 };

    for (var fi = 0; fi < frameResults.frames.length; fi++) {
      var frame = frameResults.frames[fi];
      try {
        var tensor = onnxInference.rgbToTensor(frame.rgb || []);
        var result = await onnxInference.compareEmbedding(tensor, referenceEmbeddings);

        if (result.bestMatch && result.bestMatch.similarity > 0.6) {
          var sim = result.bestMatch.similarity;
          var isAd = result.bestMatch.label === 'ad';
          var bonus = 0;

          if (sim > 0.85) {
            bonus = isAd ? onnxBonus.embeddingHighSim : -onnxBonus.embeddingHighSim;
          } else if (sim > 0.7) {
            bonus = isAd ? onnxBonus.embeddingMedSim : -onnxBonus.embeddingMedSim;
          } else {
            bonus = isAd ? onnxBonus.embeddingLowSim : -onnxBonus.embeddingLowSim;
          }

          totalBonus += bonus;
          frameMatches.push({
            frameSecond: frame.frameSecond,
            bestLabel: result.bestMatch.label,
            similarity: Math.round(sim * 1000) / 1000,
            bonus: bonus
          });
        }
      } catch (_) {
        // Individual frame inference failure is non-critical
      }
    }

    var netBonus = Math.round(totalBonus);
    if (netBonus !== 0) {
      reasons.push('ONNX神经网络推理得分: ' + (netBonus > 0 ? '+' : '') + netBonus + ' 分');
    }

    return {
      scoreBonus: netBonus,
      evidence: {
        available: true,
        referenceCount: referenceEmbeddings.length,
        framesProcessed: frameResults.frames.length,
        frameMatches: frameMatches
      }
    };
  }

  return { evaluateVideoRisk: evaluateVideoRiskV3 };
}

module.exports = { createRiskScorer };
