'use strict';

const crypto = require('crypto');
const { hashBitsToHex, normalizeFrameSeconds } = require('./hashCalculator');
const { MODEL_VERSION, DEFAULT_AD_MODEL_TYPE, AD_MODEL_PRESETS, DEFAULT_MODEL, DEFAULT_AD_KEYWORDS } = require('./constants');

/**
 * Creates the model manager: load/save/update the ad learning model and all domain helpers.
 *
 * @param {{ app: object, fs: object, path: object }} deps
 * @returns {object}
 */
function createModelManager({ app, fs, path }) {
  /**
   * Returns the absolute path of the persisted model JSON file.
   * @returns {string}
   */
  function getModelPath() {
    return path.join(app.getPath('userData'), 'ad-learning-model.json');
  }

  function ensureParentDir(filePath) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch {
      // Directory may already exist or parent creation may fail; callers handle write errors.
    }
  }

  function uniqueText(values = []) {
    return Array.from(
      new Set(values.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))
    );
  }

  function normalizeThreshold(value, fallback) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(100, parsed));
  }

  /** Only one model now: always returns the ONNX MobileNetV3 type. */
  function normalizeAdModelType(_rawValue) {
    return DEFAULT_AD_MODEL_TYPE;
  }

  /** @returns {object} The single ONNX MobileNetV3 preset. */
  function getAdModelPreset() {
    return AD_MODEL_PRESETS[DEFAULT_AD_MODEL_TYPE];
  }

  /** @returns {number[]} Normalized frame seconds for the ONNX model. */
  function getModelFrameSeconds() {
    return normalizeFrameSeconds(getAdModelPreset().frameSeconds);
  }

  function getModelLabel() {
    return getAdModelPreset().label;
  }

  function normalizeFilmId(rawValue) {
    const compactValue = String(rawValue || '')
      .toUpperCase()
      .trim()
      .replace(/[_\s]+/g, '-')
      .replace(/-+/g, '-');
    const match = compactValue.match(/^([A-Z]{2,12})-?(\d{2,8})([A-Z]*)$/);
    if (!match) return compactValue;
    const [, prefix, digits, suffix] = match;
    // 保守规范化：仅统一格式（大写、分隔符），保留原始数字格式
    return `${prefix}-${digits}${suffix}`.replace(/-+/g, '-');
  }

  function normalizeCodeToken(code) {
    return normalizeFilmId(code).replace(/[^A-Z0-9]/g, '');
  }

  function normalizeCodeList(rawCodes) {
    const rawList = Array.isArray(rawCodes)
      ? rawCodes
      : String(rawCodes || '')
          .split(/[\r\n,\uff0c\u3001;；\s]+/)
          .map((item) => item.trim())
          .filter(Boolean);
    return Array.from(new Set(rawList.map((item) => normalizeFilmId(item)).filter(Boolean)));
  }

  function buildIntroTemplatesFromAdSamples(adSamples = []) {
    const templates = [];
    const seenHashes = new Set();
    const list = Array.isArray(adSamples) ? adSamples : [];
    for (let i = 0; i < list.length; i++) {
      const sample = list[i] || {};
      const hb = String(sample.hashBits || '').trim();
      if (!hb || seenHashes.has(hb)) continue;
      seenHashes.add(hb);
      const templateId = String(sample.id || '').trim() || `legacy-template-${i + 1}`;
      templates.push({
        id: templateId,
        hashBits: hb,
        hashHex: hashBitsToHex(hb),
        sourcePath: String(sample.sourcePath || '').trim(),
        frameSecond: Number.isFinite(Number(sample.frameSecond)) ? Number(sample.frameSecond) : null,
        filmCode: normalizeFilmId(sample.filmCode || ''),
        addedAt: String(sample.addedAt || '').trim() || new Date().toISOString()
      });
    }
    return templates;
  }

  function ensureLearningModelShape(model) {
    const nm = model && typeof model === 'object' ? model : {};
    const adSamples = Array.isArray(nm.adSamples) ? nm.adSamples : [];
    const introTemplatesRaw = Array.isArray(nm.introTemplates) ? nm.introTemplates : [];
    const introTemplates =
      introTemplatesRaw.length > 0 ? introTemplatesRaw : buildIntroTemplatesFromAdSamples(adSamples);
    return {
      ...DEFAULT_MODEL,
      ...nm,
      keywords: uniqueText([...DEFAULT_AD_KEYWORDS, ...(nm.keywords || [])]),
      thresholds: { ...DEFAULT_MODEL.thresholds, ...(nm.thresholds || {}) },
      adSamples,
      normalSamples: Array.isArray(nm.normalSamples) ? nm.normalSamples : [],
      introTemplates,
      onnxAdEmbeddings: Array.isArray(nm.onnxAdEmbeddings) ? nm.onnxAdEmbeddings : [],
      onnxNormalEmbeddings: Array.isArray(nm.onnxNormalEmbeddings) ? nm.onnxNormalEmbeddings : [],
      meta:
        nm.meta && typeof nm.meta === 'object'
          ? { ...DEFAULT_MODEL.meta, ...nm.meta, activeModel: normalizeAdModelType(nm.meta.activeModel) }
          : { ...DEFAULT_MODEL.meta },
      metrics:
        nm.metrics && typeof nm.metrics === 'object'
          ? { ...DEFAULT_MODEL.metrics, ...nm.metrics }
          : { ...DEFAULT_MODEL.metrics }
    };
  }

  /**
   * Loads the ad learning model from disk. Returns default model if absent.
   * @returns {object}
   */
  function loadModel() {
    const modelPath = getModelPath();
    if (!fs.existsSync(modelPath)) return { ...DEFAULT_MODEL };
    try {
      const parsed = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
      return {
        ...DEFAULT_MODEL,
        ...parsed,
        keywords: uniqueText(parsed.keywords || []),
        thresholds: { ...DEFAULT_MODEL.thresholds, ...(parsed.thresholds || {}) },
        adSamples: Array.isArray(parsed.adSamples) ? parsed.adSamples : [],
        normalSamples: Array.isArray(parsed.normalSamples) ? parsed.normalSamples : [],
        introTemplates: Array.isArray(parsed.introTemplates) ? parsed.introTemplates : [],
        meta:
          parsed.meta && typeof parsed.meta === 'object'
            ? { ...DEFAULT_MODEL.meta, ...parsed.meta, activeModel: normalizeAdModelType(parsed.meta.activeModel) }
            : { ...DEFAULT_MODEL.meta },
        metrics:
          parsed.metrics && typeof parsed.metrics === 'object'
            ? { ...DEFAULT_MODEL.metrics, ...parsed.metrics }
            : { ...DEFAULT_MODEL.metrics }
      };
    } catch {
      return { ...DEFAULT_MODEL };
    }
  }

  function saveModel(model) {
    const modelPath = getModelPath();
    ensureParentDir(modelPath);
    const nextModel = {
      ...DEFAULT_MODEL,
      ...model,
      keywords: uniqueText(model.keywords || []),
      adSamples: Array.isArray(model.adSamples) ? model.adSamples : [],
      normalSamples: Array.isArray(model.normalSamples) ? model.normalSamples : [],
      introTemplates: Array.isArray(model.introTemplates) ? model.introTemplates : [],
      meta:
        model.meta && typeof model.meta === 'object'
          ? { ...DEFAULT_MODEL.meta, ...model.meta, activeModel: normalizeAdModelType(model.meta.activeModel) }
          : { ...DEFAULT_MODEL.meta },
      metrics:
        model.metrics && typeof model.metrics === 'object'
          ? { ...DEFAULT_MODEL.metrics, ...model.metrics }
          : { ...DEFAULT_MODEL.metrics },
      updatedAt: new Date().toISOString()
    };
    // Atomic write: write to temp file first, then rename to prevent corruption on crash
    const tempPath = modelPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(nextModel, null, 2), 'utf8');
    fs.renameSync(tempPath, modelPath);
    return nextModel;
  }

  /**
   * Returns a summary object for the current model state.
   * @param {object} [model]
   * @returns {object}
   */
  function summarizeModel(model) {
    const nm = ensureLearningModelShape(model || loadModel());
    const activeModel = normalizeAdModelType(nm && nm.meta ? nm.meta.activeModel : '');
    return {
      modelPath: getModelPath(),
      version: nm.version,
      updatedAt: nm.updatedAt || '',
      keywordCount: (nm.keywords || []).length,
      adSampleCount: (nm.adSamples || []).length,
      normalSampleCount: (nm.normalSamples || []).length,
      introTemplateCount: (nm.introTemplates || []).length,
      activeModel,
      activeModelLabel: getModelLabel(activeModel),
      thresholds: nm.thresholds,
      metrics:
        nm.metrics && typeof nm.metrics === 'object' ? nm.metrics : { ...DEFAULT_MODEL.metrics }
    };
  }

  /**
   * Returns a live summary of the loaded model (convenience wrapper).
   * @returns {object}
   */
  function getSummary() {
    return summarizeModel(loadModel());
  }

  /**
   * Clears all learning data by deleting the model file and returning default summary.
   * @returns {object} Default model summary
   */
  function clearModel() {
    const modelPath = getModelPath();
    try {
      if (fs.existsSync(modelPath)) {
        fs.unlinkSync(modelPath);
      }
    } catch {
      // Ignore deletion failures.
    }
    return summarizeModel({ ...DEFAULT_MODEL });
  }

  /**
   * Updates keywords, thresholds, and active model type in the persisted model.
   * @param {object} options
   * @returns {Promise<object>} Updated model summary
   */
  async function updateModel(options = {}) {
    const model = loadModel();
    model.keywords = uniqueText([...(model.keywords || []), ...(options.keywords || [])]);
    model.meta = {
      ...(model.meta && typeof model.meta === 'object' ? model.meta : {}),
      activeModel: normalizeAdModelType(options.modelType || (model.meta && model.meta.activeModel))
    };
    model.thresholds = {
      ...model.thresholds,
      adScore: normalizeThreshold(options.adScore, model.thresholds.adScore || 60),
      highSimilarityDistance: normalizeThreshold(
        options.highSimilarityDistance,
        model.thresholds.highSimilarityDistance || 10
      ),
      mediumSimilarityDistance: normalizeThreshold(
        options.mediumSimilarityDistance,
        model.thresholds.mediumSimilarityDistance || 16
      ),
      lowSimilarityDistance: normalizeThreshold(
        options.lowSimilarityDistance,
        model.thresholds.lowSimilarityDistance || 22
      )
    };
    return summarizeModel(saveModel(model));
  }

  /**
   * Builds a sample record object for storage.
   * @param {object} params
   * @returns {object}
   */
  function buildSampleRecord({ id, label, sourcePath, sourceType, filmCode = '', frameSecond = null, hashBits, hashBitsD = '', frameStats = null, confidence = 'high' }) {
    return {
      id,
      label,
      sourcePath,
      sourceType,
      filmCode: filmCode || '',
      frameSecond: Number.isFinite(Number(frameSecond)) ? Number(frameSecond) : null,
      hashBits,
      hashBitsD: hashBitsD || '',
      hashHex: hashBitsToHex(hashBits),
      frameStats: frameStats || null,
      confidence: confidence || 'high',
      addedAt: new Date().toISOString()
    };
  }

  /**
   * Appends a new intro-template entry to the model if not already present.
   * @param {object} model
   * @param {object} payload
   */
  function appendIntroTemplate(model, payload = {}) {
    if (!model || typeof model !== 'object') return;
    if (!Array.isArray(model.introTemplates)) model.introTemplates = [];
    const hb = String(payload.hashBits || '').trim();
    if (!hb) return;
    const exists = model.introTemplates.some(
      (item) => String(item && item.hashBits ? item.hashBits : '') === hb
    );
    if (exists) return;
    const templateId = crypto
      .createHash('sha1')
      .update(`intro-${hb}-${payload.sourcePath || ''}-${Date.now()}-${model.introTemplates.length}`)
      .digest('hex')
      .slice(0, 12);
    model.introTemplates.push({
      id: templateId,
      hashBits: hb,
      hashBitsD: String(payload.hashBitsD || '').trim(),
      hashHex: hashBitsToHex(hb),
      sourcePath: String(payload.sourcePath || ''),
      frameSecond: Number.isFinite(Number(payload.frameSecond)) ? Number(payload.frameSecond) : null,
      filmCode: String(payload.filmCode || ''),
      addedAt: new Date().toISOString()
    });
  }

  return {
    getModelPath,
    loadModel,
    saveModel,
    summarizeModel,
    getSummary,
    clearModel,
    updateModel,
    ensureLearningModelShape,
    buildSampleRecord,
    appendIntroTemplate,
    normalizeAdModelType,
    getAdModelPreset,
    getModelFrameSeconds,
    normalizeFilmId,
    normalizeCodeToken,
    normalizeCodeList
  };
}

module.exports = { createModelManager };
