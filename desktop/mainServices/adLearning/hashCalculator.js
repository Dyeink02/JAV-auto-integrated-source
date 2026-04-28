'use strict';

const { execFile } = require('child_process');
const {
  DEFAULT_VIDEO_FRAME_SECONDS,
  BLACK_FRAME_VARIANCE_THRESHOLD,
  STATIC_FRAME_VARIANCE_THRESHOLD,
  MAX_FRAME_SECOND,
  FFMPEG_TIMEOUT_MS,
  FFMPEG_MAX_BUFFER_SIZE
} = require('./constants');

/**
 * Converts a 64-byte raw pixel buffer to a 64-bit average-hash (aHash) bit string.
 * @param {Buffer} rawBuffer
 * @returns {string}
 */
function toPerceptualBits(rawBuffer) {
  const bytes = rawBuffer.length >= 64 ? rawBuffer.subarray(0, 64) : null;
  if (!bytes) return '';
  let total = 0;
  for (let i = 0; i < 64; i++) total += bytes[i];
  const avg = total / 64;
  let bits = '';
  for (let i = 0; i < 64; i++) bits += bytes[i] >= avg ? '1' : '0';
  return bits;
}

/**
 * Converts a 72-byte raw pixel buffer (9x8) to a 64-bit difference-hash (dHash) bit string.
 * dHash compares adjacent horizontal pixels, making it far more robust to brightness shifts.
 * @param {Buffer} rawBuffer - 72 bytes from FFmpeg scale=9:8
 * @returns {string}
 */
function toDifferenceBits(rawBuffer) {
  const bytes = rawBuffer.length >= 72 ? rawBuffer.subarray(0, 72) : null;
  if (!bytes) return '';
  let bits = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = bytes[row * 9 + col];
      const right = bytes[row * 9 + col + 1];
      bits += left < right ? '1' : '0';
    }
  }
  return bits;
}

/**
 * Computes frame statistics from a raw pixel buffer for black/static frame detection.
 * @param {Buffer} rawBuffer - raw grayscale pixel data
 * @returns {{ mean: number, variance: number, isBlack: boolean, isStatic: boolean }}
 */
function computeFrameStatistics(rawBuffer) {
  const len = rawBuffer.length;
  if (len === 0) return { mean: 0, variance: 0, isBlack: true, isStatic: true };

  let sum = 0;
  for (let i = 0; i < len; i++) sum += rawBuffer[i];
  const mean = sum / len;

  let sqDiff = 0;
  for (let i = 0; i < len; i++) {
    const diff = rawBuffer[i] - mean;
    sqDiff += diff * diff;
  }
  const variance = sqDiff / len;

  return {
    mean,
    variance,
    isBlack: variance < BLACK_FRAME_VARIANCE_THRESHOLD && mean < 30,
    isStatic: variance < STATIC_FRAME_VARIANCE_THRESHOLD
  };
}

/**
 * Computes weighted combined distance from aHash and dHash distances.
 * Weights: aHash 40%, dHash 60% (dHash is more discriminative).
 * Falls back to pure aHash if dHashDist is null.
 * @param {number} aHashDist
 * @param {number|null} dHashDist
 * @returns {number}
 */
function combinedDistance(aHashDist, dHashDist) {
  if (!Number.isFinite(dHashDist)) return aHashDist;
  return Math.round(aHashDist * 0.4 + dHashDist * 0.6);
}

/**
 * Converts a bit string hash to hexadecimal string.
 * @param {string} bits
 * @returns {string}
 */
function hashBitsToHex(bits) {
  if (!bits) return '';
  const paddedBits = bits.padEnd(Math.ceil(bits.length / 4) * 4, '0');
  let output = '';
  for (let i = 0; i < paddedBits.length; i += 4) {
    output += Number.parseInt(paddedBits.slice(i, i + 4), 2).toString(16);
  }
  return output;
}

/**
 * Calculates Hamming distance between two bit strings.
 * @param {string} leftBits
 * @param {string} rightBits
 * @returns {number}
 */
function hammingDistance(leftBits, rightBits) {
  const left = String(leftBits || '');
  const right = String(rightBits || '');
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return Number.POSITIVE_INFINITY;
  let diff = 0;
  for (let i = 0; i < maxLength; i++) {
    if ((left[i] || '0') !== (right[i] || '0')) diff++;
  }
  return diff;
}

/**
 * Normalizes a frame seconds list: dedup, clamp 0-30, fallback to defaults.
 * @param {number[]} rawValue
 * @returns {number[]}
 */
function normalizeFrameSeconds(rawValue) {
  const input = Array.isArray(rawValue) ? rawValue : [];
  const output = [];
  const seen = new Set();
  input.forEach((item) => {
    const parsed = Number.parseInt(String(item ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return;
    const second = Math.max(0, Math.min(MAX_FRAME_SECOND, parsed));
    if (seen.has(second)) return;
    seen.add(second);
    output.push(second);
  });
  return output.length > 0 ? output : DEFAULT_VIDEO_FRAME_SECONDS.slice();
}

/**
 * Creates an FFmpeg-based hash calculator with in-process resolution cache.
 * @param {{ app: object, fs: object, path: object }} deps
 * @returns {{ detectFfmpegAvailable: Function, computeImageHash: Function, computeVideoFrameHash: Function }}
 */
function createHashCalculator({ app, fs, path }) {
  let ffmpegAvailable = null;
  let ffmpegCommand = '';

  function execFileBuffer(command, args, timeoutMs = FFMPEG_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      execFile(
        command,
        args,
        { windowsHide: true, encoding: 'buffer', maxBuffer: FFMPEG_MAX_BUFFER_SIZE, timeout: timeoutMs },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                `ffmpeg\u6267\u884c\u5931\u8d25: ${error.message}; ${Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '')}`
              )
            );
            return;
          }
          resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''));
        }
      );
    });
  }

  function getBundledFfmpegCandidates() {
    const candidates = [];
    const resourcesPath = process && process.resourcesPath ? String(process.resourcesPath || '') : '';
    if (resourcesPath) {
      candidates.push(path.join(resourcesPath, 'tools', 'ffmpeg', 'ffmpeg.exe'));
    }
    const appPath = typeof app.getAppPath === 'function' ? String(app.getAppPath() || '') : '';
    if (appPath) {
      candidates.push(path.join(appPath, 'desktop', 'resources', 'ffmpeg', 'win-x64', 'ffmpeg.exe'));
      candidates.push(path.join(appPath, 'resources', 'ffmpeg', 'win-x64', 'ffmpeg.exe'));
    }
    // Relative to this file: adLearning/ -> mainServices/ -> desktop/ -> resources/
    candidates.push(path.join(__dirname, '..', '..', 'resources', 'ffmpeg', 'win-x64', 'ffmpeg.exe'));
    return Array.from(
      new Set(candidates.map((c) => path.resolve(String(c || '').trim())).filter(Boolean))
    );
  }

  async function probeFfmpegCommand(command) {
    try {
      await execFileBuffer(command, ['-version'], 5000);
      return true;
    } catch {
      return false;
    }
  }

  async function resolveFfmpegCommand() {
    if (typeof ffmpegAvailable === 'boolean') {
      return ffmpegAvailable ? ffmpegCommand : '';
    }
    const bundledCandidates = getBundledFfmpegCandidates().filter((c) => fs.existsSync(c));
    for (const candidate of bundledCandidates) {
      if (await probeFfmpegCommand(candidate)) {
        ffmpegAvailable = true;
        ffmpegCommand = candidate;
        return ffmpegCommand;
      }
    }
    if (await probeFfmpegCommand('ffmpeg')) {
      ffmpegAvailable = true;
      ffmpegCommand = 'ffmpeg';
      return ffmpegCommand;
    }
    ffmpegAvailable = false;
    ffmpegCommand = '';
    return '';
  }

  /**
   * Returns true if any FFmpeg executable is available.
   * @returns {Promise<boolean>}
   */
  async function detectFfmpegAvailable() {
    return Boolean(await resolveFfmpegCommand());
  }

  /**
   * Computes perceptual hashes (aHash + dHash) and frame statistics of a single image file.
   * @param {string} filePath
   * @returns {Promise<{ aHash: string, dHash: string, frameStats: { mean: number, variance: number, isBlack: boolean, isStatic: boolean } }>}
   */
  async function computeImageHash(filePath) {
    const command = await resolveFfmpegCommand();
    if (!command) throw new Error('\u672a\u68c0\u6d4b\u5230 ffmpeg \u53ef\u6267\u884c\u6587\u4ef6');
    // Extract 9x8 grayscale pixels: first 64 bytes for aHash, all 72 bytes for dHash
    const raw = await execFileBuffer(command, [
      '-v', 'error', '-i', filePath, '-frames:v', '1',
      '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', '-'
    ]);
    const aHash = toPerceptualBits(raw);
    const dHash = toDifferenceBits(raw);
    const frameStats = computeFrameStatistics(raw);
    return { aHash, dHash, frameStats };
  }

  /**
   * Computes perceptual hashes (aHash + dHash) and frame statistics of a video frame at the given second.
   * @param {string} filePath
   * @param {number} second
   * @returns {Promise<{ aHash: string, dHash: string, frameStats: { mean: number, variance: number, isBlack: boolean, isStatic: boolean } }>}
   */
  async function computeVideoFrameHash(filePath, second) {
    const command = await resolveFfmpegCommand();
    if (!command) throw new Error('\u672a\u68c0\u6d4b\u5230 ffmpeg \u53ef\u6267\u884c\u6587\u4ef6');
    // Extract 9x8 grayscale pixels: first 64 bytes for aHash, all 72 bytes for dHash
    const raw = await execFileBuffer(command, [
      '-v', 'error', '-ss', String(second), '-i', filePath,
      '-frames:v', '1', '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', '-'
    ]);
    const aHash = toPerceptualBits(raw);
    const dHash = toDifferenceBits(raw);
    const frameStats = computeFrameStatistics(raw);
    return { aHash, dHash, frameStats };
  }


  /**
   * Extracts a 224x224 RGB raw pixel buffer from a video frame at the given second.
   * Used by the ONNX neural stage for MobileNetV3 inference.
   * @param {string} filePath
   * @param {number} second
   * @returns {Promise<Buffer>} raw RGB pixel data (224*224*3 bytes)
   */
  async function computeVideoFrameRgb(filePath, second) {
    const command = await resolveFfmpegCommand();
    if (!command) throw new Error('ffmpeg not available');
    const raw = await execFileBuffer(command, [
      '-v', 'error', '-ss', String(second), '-i', filePath,
      '-frames:v', '1', '-vf', 'scale=224:224,format=rgb24', '-f', 'rawvideo', '-'
    ]);
    return raw;
  }

  return { detectFfmpegAvailable, computeImageHash, computeVideoFrameHash, computeVideoFrameRgb };
}

module.exports = {
  toPerceptualBits,
  toDifferenceBits,
  computeFrameStatistics,
  combinedDistance,
  hashBitsToHex,
  hammingDistance,
  normalizeFrameSeconds,
  createHashCalculator
};
