'use strict';

const crypto = require('crypto');
const { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, AUTO_LEARN_MIN_SCORE } = require('./constants');

/**
 * Creates the learning pipeline: sample import, code-based learning, and auto-learn feedback.
 *
 * @param {{ hashCalculator: object, modelManager: object, fs: object, path: object, sceneDetector: object, videoFrameProcessor: object }} deps
 */
function createLearningPipeline({ hashCalculator, modelManager, fs, path, sceneDetector, videoFrameProcessor, onnxInference }) {
  const { findBestSampleMatch, findTopKSampleMatch } = sceneDetector;
  const { collectVideoFilesWithManagedFallback, detectFilmCodeFromPath, emitProgress, shouldReportProgress } = videoFrameProcessor;

  /**
   * Extracts ONNX embeddings from video frames. Degrades gracefully if ONNX unavailable.
   * @param {string} videoPath
   * @param {number[]} frameSeconds
   * @returns {Promise<Array<{embedding: number[], second: number}>>}
   */
  async function extractOnnxEmbeddingsForVideo(videoPath, frameSeconds) {
    if (!onnxInference || !onnxInference.isModelAvailable || !onnxInference.isModelAvailable()) return [];
    try {
      const ready = await onnxInference.ensureReady();
      if (!ready) return [];
      const { frames } = await videoFrameProcessor.extractOnnxFrames(videoPath, frameSeconds);
      if (!frames || frames.length === 0) return [];
      const embeddings = [];
      for (const frame of frames) {
        try {
          const tensor = onnxInference.rgbToTensor(frame.rgb || []);
          const result = await onnxInference.predict(tensor);
          if (result && result.embedding && result.embedding.length > 0) {
            embeddings.push({ embedding: result.embedding, second: frame.frameSecond });
          }
        } catch (_) { /* single frame failure is non-critical */ }
      }
      return embeddings;
    } catch (_) {
      return [];
    }
  }

  /**
   * Imports ad/normal sample files (images or videos) into the learning model.
   * Uses parallel frame extraction for video samples.
   */
  async function importSamplesV2(options = {}) {
    const label = options.label === 'normal' ? 'normal' : 'ad';
    const samplePaths = Array.isArray(options.samplePaths) ? options.samplePaths : [];
    const model = modelManager.ensureLearningModelShape(modelManager.loadModel());
    const activeModelType = modelManager.normalizeAdModelType(
      options.modelType || (model.meta && model.meta.activeModel)
    );
    const frameSeconds = modelManager.getModelFrameSeconds(activeModelType);
    model.meta = {
      ...(model.meta && typeof model.meta === 'object' ? model.meta : {}),
      activeModel: activeModelType
    };

    const ffmpegReady = await hashCalculator.detectFfmpegAvailable();
    if (!ffmpegReady) {
      throw new Error(
        '\u672a\u68c0\u6d4b\u5230 ffmpeg\uff08\u5185\u7f6e\u4e0e\u7cfb\u7edf PATH \u5747\u4e0d\u53ef\u7528\uff09\uff0c\u6682\u65f6\u65e0\u6cd5\u5bfc\u5165\u6837\u672c\u3002'
      );
    }

    const targetList = label === 'ad' ? model.adSamples : model.normalSamples;
    const existingHashes = new Set(
      targetList
        .map((item) => `${label}:${String(item && item.hashBits ? item.hashBits : '')}`)
        .filter((item) => item !== `${label}:`)
    );

    const imported = [];
    const skipped = [];
    let sampleIncrement = 0;

    for (const rawPath of samplePaths) {
      const samplePath = String(rawPath || '').trim();
      if (!samplePath) continue;

      const ext = path.extname(samplePath).toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(ext);
      const isVideo = VIDEO_EXTENSIONS.has(ext);
      if (!isImage && !isVideo) {
        skipped.push({ path: samplePath, reason: '\u4ec5\u652f\u6301\u56fe\u7247\u6216\u89c6\u9891\u6837\u672c\u3002' });
        continue;
      }

      try {
        const frameEntries = [];
        if (isImage) {
          const { aHash, dHash, frameStats } = await hashCalculator.computeImageHash(samplePath);
          if (!aHash) throw new Error('\u6837\u672c\u54c8\u5e0c\u4e3a\u7a7a');
          if (frameStats && frameStats.isBlack) {
            skipped.push({ path: samplePath, reason: '\u9ed1\u5e27/\u9759\u5e27\uff0c\u5df2\u8df3\u8fc7' });
            continue;
          }
          frameEntries.push({ aHash, dHash, frameStats, frameSecond: null, sourceType: 'image' });
        } else {
          const frameResults = await Promise.allSettled(
            frameSeconds.map(async (second) => {
              const result = await hashCalculator.computeVideoFrameHash(samplePath, second);
              return { ...result, second };
            })
          );
          for (let i = 0; i < frameResults.length; i++) {
            const result = frameResults[i];
            if (result.status !== 'fulfilled' || !result.value || !result.value.aHash) continue;
            if (result.value.frameStats && result.value.frameStats.isBlack) {
              skipped.push({ path: samplePath, reason: `${result.value.second}s \u9ed1\u5e27\uff0c\u5df2\u8df3\u8fc7` });
              continue;
            }
            frameEntries.push({
              aHash: result.value.aHash,
              dHash: result.value.dHash || '',
              frameStats: result.value.frameStats,
              frameSecond: result.value.second,
              sourceType: 'video-frame'
            });
          }
          if (frameEntries.length === 0) throw new Error('\u65e0\u6cd5\u4ece\u89c6\u9891\u6293\u53d6\u6709\u6548\u6837\u672c\u5e27');
        }

        frameEntries.forEach((entry) => {
          const dedupeKey = `${label}:${entry.aHash}`;
          if (existingHashes.has(dedupeKey)) {
            skipped.push({
              path: samplePath,
              reason:
                entry.frameSecond === null
                  ? `\u6837\u672c\u91cd\u590d\uff08${label}\uff09`
                  : `${entry.frameSecond}s \u6293\u5e27\u6837\u672c\u91cd\u590d\uff08${label}\uff09`
            });
            return;
          }
          const id = crypto
            .createHash('sha1')
            .update(`${samplePath}-${entry.aHash}-${entry.frameSecond}-${Date.now()}-${targetList.length}`)
            .digest('hex')
            .slice(0, 12);
          targetList.push(
            modelManager.buildSampleRecord({
              id,
              label,
              sourcePath: samplePath,
              sourceType: entry.sourceType,
              frameSecond: entry.frameSecond,
              hashBits: entry.aHash,
              hashBitsD: entry.dHash,
              frameStats: entry.frameStats,
              confidence: 'high'
            })
          );
          existingHashes.add(dedupeKey);
          sampleIncrement++;
          imported.push(entry.frameSecond === null ? samplePath : `${samplePath} @${entry.frameSecond}s`);
          if (label === 'ad') {
            modelManager.appendIntroTemplate(model, {
              hashBits: entry.aHash,
              hashBitsD: entry.dHash,
              sourcePath: samplePath,
              frameSecond: entry.frameSecond
            });
          }
        });
      } catch (error) {
        skipped.push({ path: samplePath, reason: error instanceof Error ? error.message : String(error) });
      }
    }


    // Parallel ONNX embedding extraction for video samples
    const onnxFrameSeconds = modelManager.getModelFrameSeconds(activeModelType);
    for (const rawPath of samplePaths) {
      const samplePath = String(rawPath || '').trim();
      if (!samplePath) continue;
      const ext = path.extname(samplePath).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;
      try {
        const embeddings = await extractOnnxEmbeddingsForVideo(samplePath, onnxFrameSeconds);
        if (embeddings.length > 0) {
          const targetOnnxList = label === 'ad' ? model.onnxAdEmbeddings : model.onnxNormalEmbeddings;
          if (!Array.isArray(targetOnnxList)) {
            if (label === 'ad') model.onnxAdEmbeddings = [];
            else model.onnxNormalEmbeddings = [];
          }
          const targetList2 = label === 'ad' ? model.onnxAdEmbeddings : model.onnxNormalEmbeddings;
          const sampleId = require('crypto').createHash('sha1')
            .update('onnx-' + samplePath + '-' + Date.now())
            .digest('hex').slice(0, 12);
          embeddings.forEach(function(e) {
            targetList2.push({ embedding: e.embedding, label: label, sampleId: sampleId, second: e.second, sourcePath: samplePath, addedAt: new Date().toISOString() });
          });
        }
      } catch (_) { /* ONNX extraction is best-effort */ }
    }

    if (sampleIncrement > 0) modelManager.saveModel(model);
    return { summary: modelManager.summarizeModel(model), imported, skipped, sampleIncrement };
  }

  /**
   * Learns ad/normal samples by matching video files against provided film codes.
   * Uses parallel frame extraction per matched video.
   * Smart learning: evaluates each frame against current model before adding.
   */
  async function learnSamplesByCodesV2(options = {}) {
    const label = options.label === 'normal' ? 'normal' : 'ad';
    const codes = modelManager.normalizeCodeList(options.codes);
    const includeSubdirectories = options.includeSubdirectories !== false;
    const ignoredDirNames = Array.isArray(options.ignoredDirNames) ? options.ignoredDirNames : [];
    const rawRootPath = String(options.rootPath || '').trim();
    const sourceRoot = rawRootPath ? path.resolve(rawRootPath) : '';
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

    if (!sourceRoot) throw new Error('\u6309\u756a\u53f7\u5b66\u4e60\u65f6\uff0c\u6765\u6e90\u76ee\u5f55\u4e0d\u80fd\u4e3a\u7a7a\u3002');
    if (codes.length === 0) throw new Error('\u8bf7\u81f3\u5c11\u8f93\u5165\u4e00\u4e2a\u756a\u53f7\u3002');

    emitProgress(onProgress, {
      scope: 'learning', phase: 'starting', label, sourceRoot, requestedCodeCount: codes.length
    });

    const rootStat = await fs.promises.stat(sourceRoot).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw Error(`\u5b66\u4e60\u6765\u6e90\u76ee\u5f55\u4e0d\u5b58\u5728\uff1a${sourceRoot}`);
    }

    const ffmpegReady = await hashCalculator.detectFfmpegAvailable();
    if (!ffmpegReady) {
      throw new Error(
        '\u672a\u68c0\u6d4b\u5230 ffmpeg\uff08\u5185\u7f6e\u4e0e\u7cfb\u7edf PATH \u5747\u4e0d\u53ef\u7528\uff09\uff0c\u65e0\u6cd5\u6309\u756a\u53f7\u81ea\u52a8\u6293\u5e27\u5b66\u4e60\u3002'
      );
    }

    const model = modelManager.ensureLearningModelShape(modelManager.loadModel());
    const activeModelType = modelManager.normalizeAdModelType(
      options.modelType || (model.meta && model.meta.activeModel)
    );
    const frameSeconds = modelManager.getModelFrameSeconds(activeModelType);
    model.meta = {
      ...(model.meta && typeof model.meta === 'object' ? model.meta : {}),
      activeModel: activeModelType
    };

    const targetList = label === 'ad' ? model.adSamples : model.normalSamples;
    const oppositeList = label === 'ad' ? model.normalSamples : model.adSamples;
    const existingHashes = new Set(
      targetList
        .map((item) => `${label}:${String(item && item.hashBits ? item.hashBits : '')}`)
        .filter((item) => item !== `${label}:`)
    );

    const tokenMap = new Map();
    codes.forEach((code) => {
      const token = modelManager.normalizeCodeToken(code);
      if (!token) return;
      tokenMap.set(token, code);
    });

    const scanResult = await collectVideoFilesWithManagedFallback(sourceRoot, includeSubdirectories, {
      ignoredDirNames
    });
    const videoFiles = Array.isArray(scanResult.videoFiles) ? scanResult.videoFiles : [];
    const scannedRoots =
      Array.isArray(scanResult.scannedRoots) && scanResult.scannedRoots.length > 0
        ? scanResult.scannedRoots
        : [sourceRoot];
    const usedManagedFallback = Boolean(scanResult.usedManagedFallback);

    if (usedManagedFallback) {
      emitProgress(onProgress, {
        scope: 'learning', phase: 'managed-fallback', label, sourceRoot, scannedRoots, requestedCodeCount: codes.length
      });
    }

    const imported = [];
    const skipped = [];
    const matchedCodes = new Set();
    let matchedVideoCount = 0;
    let potentialFalsePositiveCount = 0;

    let highConfidenceCount = 0;
    let lowConfidenceCount = 0;
    let autoNormalCount = 0;
    let skippedBlackCount = 0;

    emitProgress(onProgress, {
      scope: 'learning', phase: 'scan-ready', label, sourceRoot, scannedRoots, usedManagedFallback,
      requestedCodeCount: codes.length, totalVideos: videoFiles.length, processedVideos: 0, matchedVideoCount, importedSampleCount: imported.length
    });

    for (let videoIndex = 0; videoIndex < videoFiles.length; videoIndex++) {
      const videoPath = videoFiles[videoIndex];
      const processedVideos = videoIndex + 1;

      if (shouldReportProgress(processedVideos, videoFiles.length, 30)) {
        emitProgress(onProgress, {
          scope: 'learning', phase: 'matching', label, sourceRoot, scannedRoots, usedManagedFallback,
          requestedCodeCount: codes.length, totalVideos: videoFiles.length, processedVideos, matchedVideoCount, importedSampleCount: imported.length
        });
      }

      const matchedCode = detectFilmCodeFromPath(videoPath, tokenMap);
      if (!matchedCode) continue;

      matchedVideoCount++;
      matchedCodes.add(matchedCode);

      const frameExtractionResults = await Promise.allSettled(
        frameSeconds.map(async (second) => {
          const result = await hashCalculator.computeVideoFrameHash(videoPath, second);
          return { second, ...result };
        })
      );

      const videoAHashes = [];
      const videoDHashes = [];

      for (let i = 0; i < frameExtractionResults.length; i++) {
        const result = frameExtractionResults[i];
        const second = frameSeconds[i];

        if (result.status !== 'fulfilled') {
          const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason || '\u6293\u5e27\u5931\u8d25');
          skipped.push({ path: videoPath, reason: `${second}s \u6293\u5e27\u5931\u8d25\uff1a${errorMsg}` });
          continue;
        }

        const { aHash, dHash, frameStats } = result.value;
        if (!aHash) {
          skipped.push({ path: videoPath, reason: `${second}s \u6293\u5e27\u54c8\u5e0c\u4e3a\u7a7a` });
          continue;
        }

        if (frameStats && frameStats.isBlack) {
          skippedBlackCount++;
          skipped.push({ path: videoPath, reason: `${second}s \u9ed1\u5e27\uff0c\u5df2\u8df3\u8fc7` });
          continue;
        }

        videoAHashes.push(aHash);
        videoDHashes.push(dHash || '');

        const dedupeKey = `${label}:${aHash}`;
        if (existingHashes.has(dedupeKey)) {
          skipped.push({ path: videoPath, reason: `${second}s \u6293\u5e27\u4e0e\u5df2\u6709${label === 'ad' ? '\u5e7f\u544a' : '\u6b63\u5e38'}\u6837\u672c\u91cd\u590d` });
          continue;
        }

        // Smart learning - evaluate frame against current model
        let frameConfidence = 'low';
        const frameAHashArr = [aHash];
        const frameDHashArr = [dHash || ''];

        if (model.adSamples.length > 0 || model.normalSamples.length > 0) {
          const adTopK = findTopKSampleMatch(frameAHashArr, frameDHashArr, model.adSamples || []);
          const normalTopK = findTopKSampleMatch(frameAHashArr, frameDHashArr, model.normalSamples || []);

          if (label === 'ad') {
            if (adTopK.bestDistance <= model.thresholds.highSimilarityDistance) {
              frameConfidence = 'high';
            } else if (normalTopK.bestDistance <= model.thresholds.highSimilarityDistance) {
              const normalDedupeKey = `normal:${aHash}`;
              const normalExistingHashes = new Set(
                model.normalSamples.map((s) => `normal:${String(s && s.hashBits ? s.hashBits : '')}`).filter((k) => k !== 'normal:')
              );
              if (!normalExistingHashes.has(normalDedupeKey)) {
                const normalId = crypto.createHash('sha1').update(`${videoPath}-normal-${second}-${aHash}-${Date.now()}`).digest('hex').slice(0, 12);
                model.normalSamples.push(
                  modelManager.buildSampleRecord({
                    id: normalId, label: 'normal', sourcePath: videoPath, sourceType: 'video-frame',
                    filmCode: matchedCode, frameSecond: second, hashBits: aHash, hashBitsD: dHash || '',
                    frameStats, confidence: 'high'
                  })
                );
                autoNormalCount++;
              }
              continue;
            }
          } else {
            if (normalTopK.bestDistance <= model.thresholds.highSimilarityDistance) {
              frameConfidence = 'high';
            } else if (adTopK.bestDistance <= model.thresholds.highSimilarityDistance) {
              const adDedupeKey = `ad:${aHash}`;
              const adExistingHashes = new Set(
                model.adSamples.map((s) => `ad:${String(s && s.hashBits ? s.hashBits : '')}`).filter((k) => k !== 'ad:')
              );
              if (!adExistingHashes.has(adDedupeKey)) {
                const adId = crypto.createHash('sha1').update(`${videoPath}-ad-${second}-${aHash}-${Date.now()}`).digest('hex').slice(0, 12);
                model.adSamples.push(
                  modelManager.buildSampleRecord({
                    id: adId, label: 'ad', sourcePath: videoPath, sourceType: 'video-frame',
                    filmCode: matchedCode, frameSecond: second, hashBits: aHash, hashBitsD: dHash || '',
                    frameStats, confidence: 'high'
                  })
                );
                modelManager.appendIntroTemplate(model, {
                  hashBits: aHash, hashBitsD: dHash || '', sourcePath: videoPath, frameSecond: second, filmCode: matchedCode
                });
              }
              continue;
            }
          }
        } else {
          frameConfidence = 'high';
        }

        if (frameConfidence === 'high') highConfidenceCount++;
        else lowConfidenceCount++;

        const id = crypto
          .createHash('sha1')
          .update(`${videoPath}-${matchedCode}-${second}-${aHash}-${Date.now()}-${targetList.length}`)
          .digest('hex')
          .slice(0, 12);

        targetList.push(
          modelManager.buildSampleRecord({
            id, label, sourcePath: videoPath, sourceType: 'video-frame',
            filmCode: matchedCode, frameSecond: second, hashBits: aHash, hashBitsD: dHash || '',
            frameStats, confidence: frameConfidence
          })
        );
        existingHashes.add(dedupeKey);
        imported.push(`${videoPath} @${second}s`);

        if (label === 'ad') {
          modelManager.appendIntroTemplate(model, {
            hashBits: aHash, hashBitsD: dHash || '', sourcePath: videoPath, frameSecond: second, filmCode: matchedCode
          });
        }
      }

      const oppositeMatch = findBestSampleMatch(videoAHashes, videoDHashes, oppositeList);
      if (oppositeMatch && oppositeMatch.distance <= model.thresholds.highSimilarityDistance) {
        potentialFalsePositiveCount++;
      }

      emitProgress(onProgress, {
        scope: 'learning', phase: 'learning', label, sourceRoot, scannedRoots, usedManagedFallback,
        requestedCodeCount: codes.length, totalVideos: videoFiles.length, processedVideos,
        matchedVideoCount, importedSampleCount: imported.length, currentCode: matchedCode
      });
    }

    const missingCodes = codes.filter((code) => !matchedCodes.has(code));
    const hitRate = codes.length > 0 ? (matchedVideoCount / codes.length) * 100 : 0;
    const falsePositiveRate =
      matchedVideoCount > 0 ? (potentialFalsePositiveCount / matchedVideoCount) * 100 : 0;
    const sampleIncrement = imported.length;

    model.metrics = {
      ...(model.metrics && typeof model.metrics === 'object' ? model.metrics : {}),
      totalLearningRuns: Number((model.metrics && model.metrics.totalLearningRuns) || 0) + 1,
      lastLearning: {
        at: new Date().toISOString(),
        label, rootPath: sourceRoot, scannedRoots, usedManagedFallback,
        requestedCodeCount: codes.length, matchedVideoCount,
        missingCodeCount: missingCodes.length, sampleIncrement, hitRate, falsePositiveRate, potentialFalsePositiveCount
      }
    };


    // Parallel ONNX embedding extraction for matched videos
    const learnFrameSeconds = modelManager.getModelFrameSeconds(activeModelType);
    for (let vIdx = 0; vIdx < videoFiles.length; vIdx++) {
      const vPath = videoFiles[vIdx];
      const matchedCode = detectFilmCodeFromPath(vPath, tokenMap);
      if (!matchedCode) continue;
      try {
        const onnxEmbs = await extractOnnxEmbeddingsForVideo(vPath, learnFrameSeconds);
        if (onnxEmbs.length > 0) {
          const targetOnnxList2 = label === 'ad' ? model.onnxAdEmbeddings : model.onnxNormalEmbeddings;
          if (!Array.isArray(targetOnnxList2)) {
            if (label === 'ad') model.onnxAdEmbeddings = [];
            else model.onnxNormalEmbeddings = [];
          }
          const finalList = label === 'ad' ? model.onnxAdEmbeddings : model.onnxNormalEmbeddings;
          const sampleId2 = require('crypto').createHash('sha1')
            .update('onnx-learn-' + vPath + '-' + Date.now())
            .digest('hex').slice(0, 12);
          onnxEmbs.forEach(function(e) {
            finalList.push({ embedding: e.embedding, label: label, sampleId: sampleId2, second: e.second, sourcePath: vPath, addedAt: new Date().toISOString() });
          });
        }
      } catch (_) { /* ONNX extraction is best-effort */ }
    }

    modelManager.saveModel(model);

    emitProgress(onProgress, {
      scope: 'learning', phase: 'completed', label, sourceRoot, scannedRoots, usedManagedFallback,
      requestedCodeCount: codes.length, totalVideos: videoFiles.length, processedVideos: videoFiles.length,
      matchedVideoCount, importedSampleCount: imported.length, missingCodeCount: missingCodes.length, hitRate, falsePositiveRate, sampleIncrement
    });

    return {
      summary: modelManager.summarizeModel(model), label, sourceRoot, scannedRoots, usedManagedFallback,
      requestedCodeCount: codes.length, matchedVideoCount, importedSampleCount: imported.length,
      matchedCodes: Array.from(matchedCodes).sort((a, b) => String(a).localeCompare(String(b), 'en')),
      missingCodes: missingCodes.sort((a, b) => String(a).localeCompare(String(b), 'en')),
      imported, skipped, hitRate, falsePositiveRate, sampleIncrement,
      observability: { hitRate, falsePositiveRate, sampleIncrement, potentialFalsePositiveCount },
      smartLearningStats: { highConfidence: highConfidenceCount, lowConfidence: lowConfidenceCount, autoNormal: autoNormalCount, skippedBlack: skippedBlackCount }
    };
  }

  /**
   * Automatically learns from high-confidence detection results.
   */
  function autoLearnFromDetection(options = {}) {
    const videoPath = String(options.videoPath || '').trim();
    const isAd = Boolean(options.isAd);
    const score = Number(options.score || 0);
    const aHashes = Array.isArray(options.aHashes) ? options.aHashes : [];
    const dHashes = Array.isArray(options.dHashes) ? options.dHashes : [];
    const frameStatsList = Array.isArray(options.frameStatsList) ? options.frameStatsList : [];
    const frameSeconds = Array.isArray(options.frameSeconds) ? options.frameSeconds : [];
    const filmCode = String(options.filmCode || '');

    if (!videoPath || aHashes.length === 0) {
      return { adSamplesAdded: 0, normalSamplesAdded: 0, skipped: 0 };
    }

    const model = modelManager.ensureLearningModelShape(modelManager.loadModel());
    let adSamplesAdded = 0;
    let normalSamplesAdded = 0;
    let skipped = 0;

    if (isAd && score >= AUTO_LEARN_MIN_SCORE) {
      const existingAdHashes = new Set(
        model.adSamples.map((s) => `ad:${String(s && s.hashBits ? s.hashBits : '')}`).filter((k) => k !== 'ad:')
      );
      for (let i = 0; i < aHashes.length; i++) {
        const aHash = aHashes[i];
        if (!aHash) continue;
        const stats = frameStatsList[i];
        if (stats && stats.isBlack) { skipped++; continue; }
        const dedupeKey = `ad:${aHash}`;
        if (existingAdHashes.has(dedupeKey)) { skipped++; continue; }

        const second = frameSeconds[i] || null;
        const dHash = dHashes[i] || '';
        const id = crypto.createHash('sha1').update(`auto-${videoPath}-${second}-${aHash}-${Date.now()}`).digest('hex').slice(0, 12);

        model.adSamples.push(
          modelManager.buildSampleRecord({
            id, label: 'ad', sourcePath: videoPath, sourceType: 'video-frame',
            filmCode, frameSecond: second, hashBits: aHash, hashBitsD: dHash,
            frameStats: stats, confidence: 'high'
          })
        );
        modelManager.appendIntroTemplate(model, {
          hashBits: aHash, hashBitsD: dHash, sourcePath: videoPath, frameSecond: second, filmCode
        });
        existingAdHashes.add(dedupeKey);
        adSamplesAdded++;
      }
    } else if (!isAd) {
      const existingNormalHashes = new Set(
        model.normalSamples.map((s) => `normal:${String(s && s.hashBits ? s.hashBits : '')}`).filter((k) => k !== 'normal:')
      );
      const normalBestDist = Number(options.normalBestDistance || Number.POSITIVE_INFINITY);
      if (normalBestDist <= model.thresholds.highSimilarityDistance) {
        for (let i = 0; i < aHashes.length; i++) {
          const aHash = aHashes[i];
          if (!aHash) continue;
          const stats = frameStatsList[i];
          if (stats && stats.isBlack) { skipped++; continue; }
          const dedupeKey = `normal:${aHash}`;
          if (existingNormalHashes.has(dedupeKey)) { skipped++; continue; }

          const second = frameSeconds[i] || null;
          const dHash = dHashes[i] || '';
          const id = crypto.createHash('sha1').update(`auto-normal-${videoPath}-${second}-${aHash}-${Date.now()}`).digest('hex').slice(0, 12);

          model.normalSamples.push(
            modelManager.buildSampleRecord({
              id, label: 'normal', sourcePath: videoPath, sourceType: 'video-frame',
              filmCode, frameSecond: second, hashBits: aHash, hashBitsD: dHash,
              frameStats: stats, confidence: 'high'
            })
          );
          existingNormalHashes.add(dedupeKey);
          normalSamplesAdded++;
        }
      }
    }

    if (adSamplesAdded > 0 || normalSamplesAdded > 0) {
      modelManager.saveModel(model);
    }

    return { adSamplesAdded, normalSamplesAdded, skipped };
  }

  return {
    importSamples: importSamplesV2,
    learnSamplesByCodes: learnSamplesByCodesV2,
    autoLearnFromDetection
  };
}

module.exports = { createLearningPipeline };
