'use strict';

const { hammingDistance, combinedDistance } = require('./hashCalculator');
const { TOP_K_VOTE_COUNT, VISUAL_AD_WHITE_BG_MIN_MEAN } = require('./constants');

/**
 * Creates the scene detector: sample matching, Top-K voting,
 * visual feature detection, and frame transition analysis.
 */
function createSceneDetector() {
  /**
   * Finds the single best (nearest) sample match. Kept for backward-compat evidence.
   * @param {string[]} videoAHashes
   * @param {string[]} videoDHashes
   * @param {object[]} samples
   * @returns {object|null}
   */
  function findBestSampleMatch(videoAHashes, videoDHashes, samples = []) {
    if (
      !Array.isArray(videoAHashes) ||
      videoAHashes.length === 0 ||
      !Array.isArray(samples) ||
      samples.length === 0
    ) {
      return null;
    }
    let best = null;
    samples.forEach((sample) => {
      if (!sample || !sample.hashBits) return;
      videoAHashes.forEach((videoAHash, index) => {
        const videoD = (videoDHashes && videoDHashes[index]) || '';
        const sampleD = sample.hashBitsD || '';
        const dist = combinedDistance(videoAHash, videoD, sample.hashBits, sampleD);
        if (best === null || dist < best.distance) {
          best = {
            sampleId: sample.id || '',
            distance: dist,
            label: sample.label || '',
            sourcePath: sample.sourcePath || '',
            frameSecond: sample.frameSecond || null,
            filmCode: sample.filmCode || '',
            hashBits: sample.hashBits,
            hashBitsD: sampleD,
            matchedFrameIndex: index
          };
        }
      });
    });
    return best;
  }

  /**
   * Top-K voting: finds the K nearest samples and counts label votes.
   * @param {string[]} videoAHashes
   * @param {string[]} videoDHashes
   * @param {object[]} samples
   * @returns {{ matches: object[], voteCount: number, avgDistance: number, bestDistance: number }}
   */
  function findTopKSampleMatch(videoAHashes, videoDHashes, samples = []) {
    const K = TOP_K_VOTE_COUNT;
    if (
      !Array.isArray(videoAHashes) ||
      videoAHashes.length === 0 ||
      !Array.isArray(samples) ||
      samples.length === 0
    ) {
      return { matches: [], voteCount: 0, avgDistance: Infinity, bestDistance: Infinity };
    }
    const candidates = [];
    samples.forEach((sample) => {
      if (!sample || !sample.hashBits) return;
      let bestDist = Infinity;
      let bestFrameIndex = 0;
      videoAHashes.forEach((videoAHash, index) => {
        const videoD = (videoDHashes && videoDHashes[index]) || '';
        const sampleD = sample.hashBitsD || '';
        const dist = combinedDistance(videoAHash, videoD, sample.hashBits, sampleD);
        if (dist < bestDist) { bestDist = dist; bestFrameIndex = index; }
      });
      candidates.push({
        sampleId: sample.id || '',
        distance: bestDist,
        label: sample.label || '',
        sourcePath: sample.sourcePath || '',
        frameSecond: sample.frameSecond || null,
        filmCode: sample.filmCode || '',
        hashBits: sample.hashBits,
        hashBitsD: sample.hashBitsD || '',
        matchedFrameIndex: bestFrameIndex
      });
    });
    candidates.sort((a, b) => a.distance - b.distance);
    const topK = candidates.slice(0, K);
    const voteCount = topK.filter((m) => m.label === 'ad' || m.label === 'intro-template').length;
    const avgDistance = topK.length > 0
      ? topK.reduce((sum, m) => sum + m.distance, 0) / topK.length
      : Infinity;
    const bestDistance = topK.length > 0 ? topK[0].distance : Infinity;
    return { matches: topK, voteCount, avgDistance, bestDistance };
  }

  /**
   * Detects visual ad features from frame statistics.
   * Returns { coarseByVisual, visualReason }.
   */
  function detectVisualFeatures(matchAHashes, frameStatsList, staticFrameCount, bootstrapMode) {
    let coarseByVisual = false;
    let visualReason = '';

    // Condition 1: >=3 static/low-variance frames in intro (ad logo page)
    if (staticFrameCount >= 3) {
      coarseByVisual = true;
      visualReason = `前15秒内发现 ${staticFrameCount} 个静止/低方差帧（疑似广告Logo页）`;
    }

    // Condition 2: adjacent non-black frames with very low inter-frame distance (static ad)
    if (!coarseByVisual && matchAHashes.length >= 3) {
      let lowDistPairCount = 0;
      for (let i = 0; i < matchAHashes.length - 1; i++) {
        const interDist = hammingDistance(matchAHashes[i], matchAHashes[i + 1]);
        if (interDist < 3) {
          lowDistPairCount++;
        }
      }
      if (lowDistPairCount >= 2) {
        coarseByVisual = true;
        visualReason = `发现 ${lowDistPairCount} 对相邻帧汉明距离<3（静态广告特征）`;
      }
    }

    // Condition 3: white-background ad page (high mean brightness)
    if (!coarseByVisual && frameStatsList.length > 0) {
      const whiteFrameCount = frameStatsList.filter((s) => s && !s.isBlack && s.mean >= VISUAL_AD_WHITE_BG_MIN_MEAN).length;
      if (whiteFrameCount >= 3) {
        coarseByVisual = true;
        visualReason = `发现 ${whiteFrameCount} 个白底高亮帧（疑似广告页）`;
      }
    }

    return { coarseByVisual, visualReason };
  }

  /**
   * Detects frame transition (ad→content sharp cut).
   * Returns { coarseByTransition, transitionReason }.
   */
  function detectFrameTransition(matchAHashes, aHashes, frameSeconds, frameStatsList) {
    let coarseByTransition = false;
    let transitionReason = '';

    if (matchAHashes.length >= 3) {
      const earlyIndices = [];
      const lateIndices = [];
      for (let i = 0; i < frameSeconds.length; i++) {
        const stats = frameStatsList[i];
        if (stats && stats.isBlack) continue;
        if (frameSeconds[i] <= 5) earlyIndices.push(i);
        else lateIndices.push(i);
      }
      if (earlyIndices.length >= 2 && lateIndices.length >= 2) {
        let totalTransDist = 0;
        let transCount = 0;
        for (const ei of earlyIndices) {
          for (const li of lateIndices) {
            totalTransDist += hammingDistance(matchAHashes[ei] || aHashes[ei], matchAHashes[li] || aHashes[li]);
            transCount++;
          }
        }
        const avgTransDist = transCount > 0 ? totalTransDist / transCount : 0;
        let lateInternalDist = 0;
        let lateInternalCount = 0;
        for (let li1 = 0; li1 < lateIndices.length; li1++) {
          for (let li2 = li1 + 1; li2 < lateIndices.length; li2++) {
            lateInternalDist += hammingDistance(
              matchAHashes[lateIndices[li1]] || aHashes[lateIndices[li1]],
              matchAHashes[lateIndices[li2]] || aHashes[lateIndices[li2]]
            );
            lateInternalCount++;
          }
        }
        const avgLateInternal = lateInternalCount > 0 ? lateInternalDist / lateInternalCount : 0;
        if (avgTransDist > 30 && avgLateInternal <= 20) {
          coarseByTransition = true;
          transitionReason = `前后段帧平均汉明距离 ${Math.round(avgTransDist)}（广告→正片过渡特征，正片内部距离 ${Math.round(avgLateInternal)}）`;
        }
      }
    }

    return { coarseByTransition, transitionReason };
  }

  return {
    findBestSampleMatch,
    findTopKSampleMatch,
    detectVisualFeatures,
    detectFrameTransition
  };
}

module.exports = { createSceneDetector };
