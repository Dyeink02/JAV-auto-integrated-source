'use strict';

const { normalizeFrameSeconds } = require('./hashCalculator');
const {
  VIDEO_EXTENSIONS, MANAGED_DIR_NAMES_LOWER, DEFAULT_IGNORED_DIR_NAMES,
  FRAME_PROCESSING_PROGRESS_STEP
} = require('./constants');

/**
 * Creates the video frame processor: utility functions, video file collection,
 * film code detection, and hash extraction.
 *
 * @param {{ hashCalculator: object, cacheManager: object, modelManager: object, fs: object, path: object }} deps
 */
function createVideoFrameProcessor({ hashCalculator, cacheManager, modelManager, fs, path }) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function emitProgress(onProgress, payload = {}) {
    if (typeof onProgress !== 'function') return;
    onProgress({ ...payload, timestamp: new Date().toISOString() });
  }

  function shouldReportProgress(processed, total, step = FRAME_PROCESSING_PROGRESS_STEP) {
    if (total <= 0) return true;
    if (processed <= 1 || processed >= total) return true;
    return processed % Math.max(1, step) === 0;
  }

  function normalizeDirName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function buildIgnoredDirNameSet(rawNames, options = {}) {
    const values = new Set();
    if (!Boolean(options.includeManagedDirs)) {
      MANAGED_DIR_NAMES_LOWER.forEach((item) => values.add(item));
    }
    if (options.includeDefaultIgnored !== false) {
      Array.from(DEFAULT_IGNORED_DIR_NAMES)
        .map(normalizeDirName)
        .filter(Boolean)
        .forEach((item) => values.add(item));
    }
    if (Array.isArray(rawNames)) {
      rawNames.map(normalizeDirName).filter(Boolean).forEach((item) => values.add(item));
    }
    return values;
  }

  function shouldSkipDirectory(entryName, ignoredDirNames) {
    if (!(ignoredDirNames instanceof Set)) return false;
    const normalized = normalizeDirName(entryName);
    if (!normalized) return false;
    return ignoredDirNames.has(normalized);
  }

  async function collectVideoFiles(rootPath, includeSubdirectories = true, options = {}) {
    const normalizedRoot = path.resolve(String(rootPath || '').trim());
    const files = [];
    const ignoredDirNames = buildIgnoredDirNameSet(options.ignoredDirNames, {
      includeManagedDirs: options.includeManagedDirs === true
    });

    async function walk(currentPath) {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isFile()) {
          if (VIDEO_EXTENSIONS.has(path.extname(entryPath).toLowerCase())) {
            files.push(entryPath);
          }
          continue;
        }
        if (!entry.isDirectory()) continue;
        if (shouldSkipDirectory(entry.name, ignoredDirNames)) continue;
        if (!includeSubdirectories) continue;
        await walk(entryPath);
      }
    }

    await walk(normalizedRoot);
    return files;
  }

  async function collectVideoFilesWithManagedFallback(sourceRoot, includeSubdirectories = true, options = {}) {
    const normalizedRoot = path.resolve(String(sourceRoot || '').trim());
    const ignoredDirNames = Array.isArray(options.ignoredDirNames) ? options.ignoredDirNames : [];
    const baseFiles = await collectVideoFiles(normalizedRoot, includeSubdirectories, { ignoredDirNames });

    if (baseFiles.length > 0) {
      return { videoFiles: baseFiles, scannedRoots: [normalizedRoot], usedManagedFallback: false };
    }

    const fallbackRoots = [
      path.join(normalizedRoot, '\u5f85\u6574\u7406'),
      path.join(normalizedRoot, '\u542b\u5f00\u5934\u5e7f\u544a'),
      path.join(normalizedRoot, '\u5f85\u5220\u9664')
    ];
    const existingFallbackRoots = [];
    for (const candidateRoot of fallbackRoots) {
      const stat = await fs.promises.stat(candidateRoot).catch(() => null);
      if (stat && stat.isDirectory()) existingFallbackRoots.push(candidateRoot);
    }

    if (existingFallbackRoots.length === 0) {
      return { videoFiles: baseFiles, scannedRoots: [normalizedRoot], usedManagedFallback: false };
    }

    const fallbackFiles = [];
    const seenFiles = new Set();
    for (const fallbackRoot of existingFallbackRoots) {
      const currentFiles = await collectVideoFiles(fallbackRoot, includeSubdirectories, {
        ignoredDirNames,
        includeManagedDirs: true
      });
      currentFiles.forEach((filePath) => {
        const dedupeKey = path.resolve(filePath).toLowerCase();
        if (seenFiles.has(dedupeKey)) return;
        seenFiles.add(dedupeKey);
        fallbackFiles.push(filePath);
      });
    }

    if (fallbackFiles.length === 0) {
      return { videoFiles: baseFiles, scannedRoots: [normalizedRoot], usedManagedFallback: false };
    }

    return { videoFiles: fallbackFiles, scannedRoots: existingFallbackRoots, usedManagedFallback: true };
  }

  function detectFilmCodeFromPath(filePath, tokenMap) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const compact = String(fileName || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
    if (!compact) return '';
    for (const [token, code] of tokenMap.entries()) {
      if (token && compact.includes(token)) return code;
    }
    return '';
  }

  /**
   * Extracts perceptual hashes for the given video using the in-memory cache.
   * Uses parallel frame extraction for improved throughput.
   */
  async function buildVideoHashes(videoPath, frameSeconds) {
    const ffmpegReady = await hashCalculator.detectFfmpegAvailable();
    if (!ffmpegReady) return { ffmpegAvailable: false, aHashes: [], dHashes: [], frameStatsList: [], fromCache: false, blackFrameCount: 0, staticFrameCount: 0 };

    const stat = await fs.promises.stat(videoPath).catch(() => null);
    if (!stat || !stat.isFile()) return { ffmpegAvailable: true, aHashes: [], dHashes: [], frameStatsList: [], fromCache: false, blackFrameCount: 0, staticFrameCount: 0 };

    const normalizedFrameSeconds = normalizeFrameSeconds(frameSeconds);
    const cacheKey = cacheManager.buildVideoHashCacheKey(videoPath, stat, normalizedFrameSeconds);
    const cached = cacheManager.getCachedVideoHashes(cacheKey);
    if (cached.aHashes.length > 0) {
      return {
        ffmpegAvailable: true,
        aHashes: cached.aHashes,
        dHashes: cached.dHashes.length > 0 ? cached.dHashes : [],
        frameStatsList: [],
        fromCache: true,
        blackFrameCount: 0,
        staticFrameCount: 0
      };
    }

    const results = await Promise.allSettled(
      normalizedFrameSeconds.map((second) => hashCalculator.computeVideoFrameHash(videoPath, second))
    );

    const aHashes = [];
    const dHashes = [];
    const frameStatsList = [];
    let blackFrameCount = 0;
    let staticFrameCount = 0;

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { aHash, dHash, frameStats } = result.value;
      if (!aHash) continue;
      aHashes.push(aHash);
      dHashes.push(dHash || '');
      frameStatsList.push(frameStats || { mean: 0, variance: 0, isBlack: false, isStatic: false });
      if (frameStats && frameStats.isBlack) blackFrameCount++;
      if (frameStats && frameStats.isStatic && !frameStats.isBlack) staticFrameCount++;
    }

    if (aHashes.length > 0) {
      cacheManager.setCachedVideoHashes(cacheKey, aHashes, dHashes);
    }

    return { ffmpegAvailable: true, aHashes, dHashes, frameStatsList, fromCache: false, blackFrameCount, staticFrameCount };
  }

  /**
   * Extracts 224x224 RGB frames from a video for ONNX inference.
   * Returns raw RGB pixel buffers for each frame.
   * @param {string} videoPath
   * @param {number[]} frameSeconds
   * @returns {Promise<{ frames: Array<{ frameSecond: number, rgb: number[] }> }>}
   */
  async function extractOnnxFrames(videoPath, frameSeconds) {
    const normalizedSeconds = normalizeFrameSeconds(frameSeconds);
    const results = await Promise.allSettled(
      normalizedSeconds.map((second) => hashCalculator.computeVideoFrameRgb(videoPath, second))
    );
    const frames = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled' || !result.value) continue;
      const rgb = Array.from(result.value);
      frames.push({ frameSecond: normalizedSeconds[i], rgb });
    }
    return { frames };
  }

  return {
    clamp,
    emitProgress,
    shouldReportProgress,
    collectVideoFiles,
    collectVideoFilesWithManagedFallback,
    detectFilmCodeFromPath,
    buildVideoHashes,
    extractOnnxFrames
  };
}

module.exports = { createVideoFrameProcessor };
