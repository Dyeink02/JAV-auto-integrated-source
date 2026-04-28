'use strict';

const MODEL_VERSION = 1;
/** Only one model now: real ONNX MobileNetV3 */
const DEFAULT_AD_MODEL_TYPE = 'mobile-net-v3-onnx';

const AD_MODEL_PRESETS = Object.freeze({
  'mobile-net-v3-onnx': {
    id: 'mobile-net-v3-onnx',
    label: 'MobileNetV3 (ONNX)',
    frameSeconds: [1, 3, 5, 8, 10, 12],
    keywordScorePerHit: 15,
    keywordScoreMax: 40,
    domainPatternScore: 30,
    templateScore: { high: 55, medium: 35, low: 15 },
    adSampleScore: { high: 45, medium: 30, low: 12 },
    normalSamplePenalty: { high: 45, medium: 25 },
    // ONNX neural network bonus scores (added to adScore when embedding matches known ad patterns)
    onnxBonus: { embeddingHighSim: 25, embeddingMedSim: 15, embeddingLowSim: 8 }
  }
});

const DEFAULT_VIDEO_FRAME_SECONDS = [1, 3, 5, 8, 12];

/** Maximum seconds into the video to sample for intro-ad detection. */
const INTRO_AD_MAX_SECONDS = 15;

/** Pixel variance below which a frame is considered black (near-uniform dark). */
const BLACK_FRAME_VARIANCE_THRESHOLD = 5;

/** Pixel variance below which a frame is considered static (near-uniform, e.g. logo page). */
const STATIC_FRAME_VARIANCE_THRESHOLD = 15;

/** Minimum mean pixel value for white-background ad page detection. */
const VISUAL_AD_WHITE_BG_MIN_MEAN = 200;

/** Number of nearest neighbors to consider in Top-K voting. */
const TOP_K_VOTE_COUNT = 3;

/** Minimum score for a detection result to trigger auto-learning feedback. */
const AUTO_LEARN_MIN_SCORE = 80;

/** Pre-seeded ad keywords commonly found in intro ad filenames. */
const DEFAULT_AD_KEYWORDS = [
  'fc2', 'fc2ppv', 'mgs', 'avant', 'dlget',
  '1pon', 'pacopaco', '1000giri', 'mesubuta'
];

const DEFAULT_MODEL = {
  version: MODEL_VERSION,
  updatedAt: '',
  keywords: [],
  thresholds: {
    adScore: 60,
    highSimilarityDistance: 10,
    mediumSimilarityDistance: 16,
    lowSimilarityDistance: 22
  },
  adSamples: [],
  normalSamples: [],
  introTemplates: [],
  onnxAdEmbeddings: [],
  onnxNormalEmbeddings: [],
  meta: { activeModel: DEFAULT_AD_MODEL_TYPE },
  metrics: { lastLearning: null, totalLearningRuns: 0 }
};

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v']);
const MANAGED_DIR_NAMES = new Set(['\u5f85\u6574\u7406', '\u5f85\u5220\u9664', 'logs', '.video-organizer-state']);
const MANAGED_DIR_NAMES_LOWER = new Set(
  Array.from(MANAGED_DIR_NAMES).map((n) => String(n || '').trim().toLowerCase())
);
const DEFAULT_IGNORED_DIR_NAMES = new Set(['2048', '\u5ba3\u4f20\u6587\u4ef6', '\u5ba3\u50b3\u6587\u4ef6']);
const URL_PATTERN = /[a-z0-9-]+\.(com|net|org|cn|cc|tv|xyz|me|vip|top)/i;

const HASH_CACHE_VERSION = 1;
const HASH_CACHE_MAX_ITEMS = 12000;
/** Auto-flush dirty cache to disk every N writes (Task 2: batch write optimization). */
const HASH_CACHE_DIRTY_FLUSH_THRESHOLD = 50;

/** Maximum frame second allowed for normalizeFrameSeconds clamping. */
const MAX_FRAME_SECOND = 30;

/** FFmpeg execution timeout in milliseconds. */
const FFMPEG_TIMEOUT_MS = 12000;

/** FFmpeg max buffer size in bytes (4 MB). */
const FFMPEG_MAX_BUFFER_SIZE = 4 * 1024 * 1024;

/** Frame processing progress report step. */
const FRAME_PROCESSING_PROGRESS_STEP = 20;

/** Upper bound ratio for cache trim hysteresis (110%). */
const CACHE_TRIM_UPPER_RATIO = 1.1;

/** Target ratio for cache trim (90%). */
const CACHE_TRIM_TARGET_RATIO = 0.9;

/** Maximum score cap for ad threshold clamping. */
const AD_THRESHOLD_MAX = 100;

/** Bootstrap mode default threshold (no samples/templates). */
const BOOTSTRAP_MODE_THRESHOLD = 55;

module.exports = {
  MODEL_VERSION,
  DEFAULT_AD_MODEL_TYPE,
  AD_MODEL_PRESETS,
  DEFAULT_VIDEO_FRAME_SECONDS,
  DEFAULT_MODEL,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MANAGED_DIR_NAMES,
  MANAGED_DIR_NAMES_LOWER,
  DEFAULT_IGNORED_DIR_NAMES,
  URL_PATTERN,
  HASH_CACHE_VERSION,
  HASH_CACHE_MAX_ITEMS,
  HASH_CACHE_DIRTY_FLUSH_THRESHOLD,
  MAX_FRAME_SECOND,
  FFMPEG_TIMEOUT_MS,
  FFMPEG_MAX_BUFFER_SIZE,
  FRAME_PROCESSING_PROGRESS_STEP,
  CACHE_TRIM_UPPER_RATIO,
  CACHE_TRIM_TARGET_RATIO,
  AD_THRESHOLD_MAX,
  BOOTSTRAP_MODE_THRESHOLD,
  INTRO_AD_MAX_SECONDS,
  BLACK_FRAME_VARIANCE_THRESHOLD,
  STATIC_FRAME_VARIANCE_THRESHOLD,
  VISUAL_AD_WHITE_BG_MIN_MEAN,
  TOP_K_VOTE_COUNT,
  AUTO_LEARN_MIN_SCORE,
  DEFAULT_AD_KEYWORDS
};
