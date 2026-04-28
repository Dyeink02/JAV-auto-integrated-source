'use strict';

const progressSchema = require('../../common/progressSchema.js');
const { AD_LEARNING, SETTINGS } = require('../../common/ipcChannels');
const { classifyError } = require('../../common/errorClassifier');
const { normalizeKeywordList, normalizeFilmCode: _normalizeFilmCode, normalizeCodeList, normalizeAdModelType, createRendererMessenger } = require('./sharedIpcUtils.js');

/**
 * Ad-learning IPC handlers.
 *
 * Channels registered:
 *   app:choose-learning-samples, app:get-ad-learning-summary,
 *   app:update-ad-learning-model, app:import-ad-learning-samples,
 *   app:learn-ad-samples-by-codes
 *
 * @param {object} deps – all deps forwarded from createIpcHandlerRegistrar
 */
function registerAdLearningHandlers(deps) {
  const {
    ipcMain,
    dialog,
    windowService,
    settingsStore,
    adLearningService,
    desktopTestMode
  } = deps;

  // ── safe guard ────────────────────────────────────────────────────────────
  const safeAdLearningService =
    adLearningService &&
    typeof adLearningService.getSummary === 'function' &&
    typeof adLearningService.updateModel === 'function' &&
    typeof adLearningService.importSamples === 'function' &&
    typeof adLearningService.learnSamplesByCodes === 'function' &&
    typeof adLearningService.evaluateVideoRisk === 'function'
      ? adLearningService
      : {
          getSummary: () => ({
            modelPath: '',
            version: 1,
            updatedAt: '',
            keywordCount: 0,
            adSampleCount: 0,
            normalSampleCount: 0,
            activeModel: 'mobile-net-v3-onnx',
            activeModelLabel: 'MobileNetV3 (ONNX)',
            thresholds: { adScore: 60, highSimilarityDistance: 10, mediumSimilarityDistance: 16, lowSimilarityDistance: 22 }
          }),
          updateModel: async () => { throw new Error('\u5e7f\u544a\u5b66\u4e60\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002'); },
          importSamples: async () => { throw new Error('\u5e7f\u544a\u5b66\u4e60\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002'); },
          learnSamplesByCodes: async () => { throw new Error('\u5e7f\u544a\u5b66\u4e60\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002'); },
          evaluateVideoRisk: async () => ({
            videoPath: '',
            ffmpegAvailable: false,
            score: 0,
            threshold: 60,
            isAd: false,
            reasons: []
          }),
          autoLearnFromDetection: null
        };

  // ── local helpers ─────────────────────────────────────────────────────────

  const { sendOrganizerLog, sendOrganizerState } = createRendererMessenger(windowService);

  // ── channel registrations ─────────────────────────────────────────────────

  ipcMain.handle(SETTINGS.CHOOSE_LEARNING_SAMPLES, async () => {
    if (desktopTestMode) return [];
    const result = await dialog.showOpenDialog(windowService.getWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '\u56fe\u7247\u6216\u89c6\u9891\u6837\u672c',
          extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'mp4', 'mkv', 'avi', 'mov', 'wmv']
        }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  ipcMain.handle(AD_LEARNING.GET_SUMMARY, async () => safeAdLearningService.getSummary());

  ipcMain.handle(AD_LEARNING.CLEAR_MODEL, async () => {
    if (typeof safeAdLearningService.clearModel === 'function') {
      return safeAdLearningService.clearModel();
    }
    throw new Error('\u5e7f\u544a\u5b66\u4e60\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002');
  });

  ipcMain.handle(AD_LEARNING.UPDATE_MODEL, async (_, options = {}) => {
    const keywords = normalizeKeywordList(options.keywords);
    const adScore = Number.parseInt(String(options.adScore ?? ''), 10);
    const modelType = normalizeAdModelType(options.modelType);
    const currentSettings = settingsStore.loadSettings();

    const result = await safeAdLearningService.updateModel({
      keywords,
      adScore: Number.isFinite(adScore) ? adScore : undefined,
      modelType
    });

    const mergedSettings = {
      ...currentSettings,
      organizerAdKeywords: keywords.join(', '),
      organizerAdThreshold: Number.isFinite(adScore) ? adScore : currentSettings.organizerAdThreshold || 60,
      organizerAdModelType: modelType
    };
    settingsStore.saveSettings(mergedSettings);

    return result;
  });

  ipcMain.handle(AD_LEARNING.IMPORT_SAMPLES, async (_, options = {}) => {
    const label = options.label === 'normal' ? 'normal' : 'ad';
    const samplePaths = Array.isArray(options.samplePaths) ? options.samplePaths : [];
    return safeAdLearningService.importSamples({
      label,
      samplePaths,
      modelType: normalizeAdModelType(options.modelType)
    });
  });

  ipcMain.handle(AD_LEARNING.LEARN_BY_CODES, async (_, options = {}) => {
    const label = options.label === 'normal' ? 'normal' : 'ad';
    const codes = normalizeCodeList(options.codes);
    const rootPath = String(options.rootPath || '').trim();
    const includeSubdirectories = options.includeSubdirectories !== false;

    sendOrganizerState({
      status: 'running',
      mode: 'learning',
      message: `\u5f00\u59cb\u6309\u756a\u53f7\u5b66\u4e60\uff08${label === 'normal' ? '\u6b63\u5e38\u6837\u672c' : '\u5e7f\u544a\u6837\u672c'}\uff09...`
    });

    try {
      const result = await safeAdLearningService.learnSamplesByCodes({
        label,
        codes,
        rootPath,
        includeSubdirectories,
        modelType: normalizeAdModelType(options.modelType),
        onProgress: (progress) => {
          const normalizedProgress = progressSchema.createProgress(progress.scope || 'learning', progress.phase, progress);
          const message = progressSchema.buildLearningProgressMessage(normalizedProgress);
          sendOrganizerState({
            status: 'running',
            mode: 'learning-progress',
            message,
            progress: normalizedProgress
          });
          sendOrganizerLog({
            level: 'info',
            message,
            timestamp: new Date().toISOString()
          });
        }
      });

      sendOrganizerState({
        status: 'completed',
        mode: 'learning',
        message: `\u6309\u756a\u53f7\u5b66\u4e60\u5b8c\u6210\uff1a\u547d\u4e2d ${result.matchedVideoCount || 0}\uff0c\u65b0\u589e\u6837\u672c ${result.importedSampleCount || 0}\u3002`,
        progress: progressSchema.createProgress('learning', 'completed', {
          matchedVideoCount: result.matchedVideoCount || 0,
          importedSampleCount: result.importedSampleCount || 0,
          missingCodeCount: Array.isArray(result.missingCodes) ? result.missingCodes.length : 0,
          hitRate: Number(result.hitRate || 0),
          falsePositiveRate: Number(result.falsePositiveRate || 0),
          sampleIncrement: Number(result.sampleIncrement || result.importedSampleCount || 0)
        })
      });

      return result;
    } catch (error) {
      const classified = classifyError(error, '按番号学习');
      sendOrganizerState({
        status: 'error',
        mode: 'learning',
        message: classified.message,
        errorType: classified.type,
        userHint: classified.userHint
      });
      throw error;
    }
  });
}

module.exports = { registerAdLearningHandlers };
