'use strict';

const progressSchema = require('../../common/progressSchema.js');
const { SETTINGS, ORGANIZER, AD_LEARNING, PUSH } = require('../../common/ipcChannels');
const { classifyError, formatClassifiedError } = require('../../common/errorClassifier');
const { normalizeKeywordList, normalizeFilmCode: _normalizeFilmCode, normalizeCodeList, normalizeAdModelType, createRendererMessenger } = require('./sharedIpcUtils.js');

/**
 * Organizer IPC handlers.
 *
 * Channels registered:
 *   app:choose-organizer-root, app:run-organizer,
 *   app:load-crawl-film-codes, app:open-organizer-path,
 *   app:get-integration-context
 *
 * @param {object} deps – all deps forwarded from createIpcHandlerRegistrar
 */
function registerOrganizerHandlers(deps) {
  const {
    ipcMain,
    fs,
    path,
    dialog,
    shell,
    windowService,
    settingsStore,
    state,
    desktopTestMode,
    organizerService,
    adLearningService
  } = deps;

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  const safeOrganizerService =
    organizerService &&
    typeof organizerService.runOrganizer === 'function' &&
    typeof organizerService.resolveTargetPath === 'function' &&
    typeof organizerService.loadCrawlFilmCodes === 'function'
      ? organizerService
      : {
          resolveTargetPath: (rootPath) => String(rootPath || ''),
          resolveCrawlOutputPaths: (outputDir) => ({ outputDir: String(outputDir || ''), filmDataPath: '' }),
          loadCrawlFilmCodes: async () => {
            throw new Error('\u89c6\u9891\u6574\u7406\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002');
          },
          runOrganizer: async () => {
            throw new Error('\u89c6\u9891\u6574\u7406\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002');
          }
        };

  const safeAdLearningService =
    adLearningService &&
    typeof adLearningService.getSummary === 'function' &&
    typeof adLearningService.evaluateVideoRisk === 'function'
      ? adLearningService
      : {
          updateModel: async () => { throw new Error('\u5e7f\u544a\u5b66\u4e60\u670d\u52a1\u672a\u521d\u59cb\u5316\u3002'); },
          evaluateVideoRisk: async () => ({ videoPath: '', ffmpegAvailable: false, score: 0, threshold: 60, isAd: false, reasons: [] }),
          autoLearnFromDetection: null
        };

  function resolvePreferredCrawlOutputDir(overrideOutputDir) {
    const provided = typeof overrideOutputDir === 'string' ? overrideOutputDir.trim() : '';
    if (provided) return provided;
    const settings = settingsStore.loadSettings();
    return (
      state.currentTaskOutputDir ||
      state.lastTaskOutputDir ||
      (typeof settings.organizerCrawlOutput === 'string' ? settings.organizerCrawlOutput.trim() : '') ||
      (typeof settings.output === 'string' ? settings.output.trim() : '') ||
      settingsStore.getCurrentOutputDir()
    );
  }

  const { sendOrganizerLog, sendOrganizerState } = createRendererMessenger(windowService);

  function buildOrganizerProgressMessage(progress = {}) {
    return progressSchema.buildOrganizerProgressMessage(progress);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  ipcMain.handle(SETTINGS.GET_INTEGRATION_CONTEXT, async () => {
    const preferredOutputDir = resolvePreferredCrawlOutputDir('');
    const crawlPaths = safeOrganizerService.resolveCrawlOutputPaths
      ? safeOrganizerService.resolveCrawlOutputPaths(preferredOutputDir)
      : { outputDir: preferredOutputDir, filmDataPath: '' };
    return {
      currentTaskOutputDir: state.currentTaskOutputDir || '',
      lastTaskOutputDir: state.lastTaskOutputDir || '',
      preferredOutputDir: crawlPaths.outputDir || preferredOutputDir,
      preferredFilmDataPath: crawlPaths.filmDataPath || ''
    };
  });

  ipcMain.handle(SETTINGS.CHOOSE_ORGANIZER_ROOT, async () => {
    if (desktopTestMode) {
      return settingsStore.ensureDesktopTestArtifacts().outputDir;
    }
    const result = await dialog.showOpenDialog(windowService.getWindow(), {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(AD_LEARNING.LOAD_CRAWL_CODES, async (_, options = {}) => {
    const outputDir = resolvePreferredCrawlOutputDir(options.outputDir);
    if (desktopTestMode) {
      const testOutputDir = settingsStore.ensureDesktopTestArtifacts(outputDir).outputDir;
      return {
        outputDir: testOutputDir,
        filmDataPath: path.join(testOutputDir, 'filmData.json'),
        totalRecords: 3,
        codeCount: 3,
        codes: ['ABP-001', 'IPX-777', 'SSIS-321'],
        codeEntries: [
          { code: 'ABP-001', magnets: [{ link: 'magnet:?xt=urn:btih:abp001-main', size: '3.2GB' }] },
          { code: 'IPX-777', magnets: [{ link: 'magnet:?xt=urn:btih:ipx777-main', size: '2.9GB' }] },
          { code: 'SSIS-321', magnets: [{ link: 'magnet:?xt=urn:btih:ssis321-main', size: '4.1GB' }] }
        ]
      };
    }
    return safeOrganizerService.loadCrawlFilmCodes({ outputDir });
  });

  ipcMain.handle(SETTINGS.OPEN_ORGANIZER_PATH, async (_, rootPath, kind = 'root') => {
    const targetRoot =
      typeof rootPath === 'string' && rootPath.trim()
        ? rootPath.trim()
        : settingsStore.loadSettings().organizerRoot || '';
    if (!targetRoot) throw new Error('\u8bf7\u5148\u9009\u62e9\u89c6\u9891\u6574\u7406\u6839\u76ee\u5f55\u3002');
    const resolvedPath = safeOrganizerService.resolveTargetPath(targetRoot, kind);
    if (kind !== 'root' && kind !== 'reports') {
      fs.mkdirSync(resolvedPath, { recursive: true });
    }
    if (!desktopTestMode) await shell.openPath(resolvedPath);
    return resolvedPath;
  });

  ipcMain.handle(ORGANIZER.RUN, async (_, options = {}) => {
    if (state.organizerRunning) throw new Error('\u5f53\u524d\u5df2\u6709\u89c6\u9891\u6574\u7406\u4efb\u52a1\u6b63\u5728\u8fd0\u884c\u3002');

    const abortController = new AbortController();
    state.organizerAbortController = abortController;
    state.organizerPaused = false;

    const currentSettings = settingsStore.loadSettings();
    const parsedAdThreshold = Number.parseInt(String(options.adThreshold ?? ''), 10);
    const resolvedAdThreshold = Number.isFinite(parsedAdThreshold)
      ? Math.max(1, Math.min(100, parsedAdThreshold))
      : Number.parseInt(String(currentSettings.organizerAdThreshold ?? ''), 10) || 60;
    const explicitKeywords = normalizeKeywordList(options.adKeywords);
    const fallbackKeywords = normalizeKeywordList(currentSettings.organizerAdKeywords);
    const resolvedKeywords = explicitKeywords.length > 0 ? explicitKeywords : fallbackKeywords;
    const adDetectionEnabled = options.adDetectionEnabled !== false;
    const resolvedAdModelType = normalizeAdModelType(
      options.adModelType || currentSettings.organizerAdModelType
    );
    const adFileAction = progressSchema.normalizeAdFileAction(
      options.adFileAction || currentSettings.organizerAdFileAction
    );

    const mergedSettings = {
      ...currentSettings,
      organizerRoot: String(options.rootPath || '').trim(),
      organizerMinSizeMB: Number.parseInt(String(options.minSizeMB ?? ''), 10) || 100,
      organizerSuffix: String(options.suffix || '').trim() || '-A',
      organizerAdFileAction: adFileAction,
      organizerDryRun: Boolean(options.dryRun),
      organizerIncludeSubdirectories: options.includeSubdirectories !== false,
      organizerCrawlOutput: resolvePreferredCrawlOutputDir(options.crawlOutputDir),
      organizerAdDetectionEnabled: adDetectionEnabled,
      organizerAdThreshold: resolvedAdThreshold,
      organizerAdKeywords: resolvedKeywords.join(', '),
      organizerAdModelType: resolvedAdModelType
    };
    settingsStore.saveSettings(mergedSettings);

    if (adDetectionEnabled) {
      await safeAdLearningService
        .updateModel({
          keywords: resolvedKeywords,
          adScore: resolvedAdThreshold,
          modelType: resolvedAdModelType
        })
        .catch((error) => {
          sendOrganizerLog({
            level: 'warn',
            message: `广告学习模型同步失败，将继续按当前策略执行：${classifyError(error, '广告模型').message}`,
            timestamp: new Date().toISOString()
          });
        });
    }

    state.organizerRunning = true;
    sendOrganizerState({
      status: 'starting',
      message: `${
        mergedSettings.organizerDryRun ? '\u9884\u89c8\u626b\u63cf\u542f\u52a8\u4e2d...' : '\u89c6\u9891\u6574\u7406\u4efb\u52a1\u542f\u52a8\u4e2d...'
      } \u5e7f\u544a\u5904\u7406\uff1a${adFileAction === 'delete-directly' ? '\u76f4\u63a5\u5220\u9664' : '\u79fb\u5165\u5f85\u5220\u9664'}`
    });

    try {
      const evaluateAdRisk = adDetectionEnabled
        ? async ({ videoPath, adThreshold }) =>
            safeAdLearningService.evaluateVideoRisk({
              videoPath,
              adThreshold: Number.isFinite(adThreshold) ? adThreshold : resolvedAdThreshold,
              modelType: resolvedAdModelType
            })
        : null;

      const result = await safeOrganizerService.runOrganizer({
        ...options,
        expectedCodes: Array.isArray(options.expectedCodes) ? options.expectedCodes : [],
        expectedCodeEntries: Array.isArray(options.expectedCodeEntries)
          ? options.expectedCodeEntries
          : [],
        adDetectionEnabled,
        adModelType: resolvedAdModelType,
        adThreshold: resolvedAdThreshold,
        adFileAction,
        evaluateAdRisk,
        signal: abortController.signal,
        isPaused: () => state.organizerPaused,
        autoLearnFromDetection: safeAdLearningService.autoLearnFromDetection
          ? (opts) => safeAdLearningService.autoLearnFromDetection(opts)
          : null,
        onLog: sendOrganizerLog,
        onProgress: (progress) => {
          const normalizedProgress = progressSchema.createProgress(
            progress.scope || 'organizer',
            progress.phase,
            progress
          );
          const message = buildOrganizerProgressMessage(normalizedProgress);
          sendOrganizerState({
            status: 'running',
            mode: 'organizer-progress',
            message,
            progress: normalizedProgress
          });
        }
      });

      sendOrganizerState({
        status: 'completed',
        message: result.dryRun
          ? `\u9884\u89c8\u5b8c\u6210\uff1a\u547d\u4e2d ${result.summary.qualifiedVideo} \u4e2a\u89c6\u9891\u3002`
          : `\u6574\u7406\u5b8c\u6210\uff1a\u5f85\u6574\u7406 ${result.summary.movedToWaiting} \u4e2a\uff0c\u5f85\u5220\u9664 ${result.summary.movedToDelete} \u4e2a\uff0c\u542b\u5f00\u5934\u5e7f\u544a ${
              result.summary.movedToIntroAd || 0
            } \u4e2a\uff0c\u76f4\u63a5\u5220\u9664 ${
              result.summary.deletedDirectly || 0
            } \u4e2a\uff0c\u9057\u6f0f\u756a\u53f7 ${result.summary.missingCodeCount || 0} \u6761\u3002`,
        summary: result.summary,
        reportMap: result.reportMap || {},
        reportFiles: result.reportFiles || [],
        missingDownload: result.missingDownload || {},
        adRisk: result.adRisk || {}
      });

      return result;
    } catch (error) {
      const classified = classifyError(error, '视频整理');
      sendOrganizerLog({ level: 'error', message: classified.message, timestamp: new Date().toISOString() });
      sendOrganizerState({ status: 'error', message: classified.message, errorType: classified.type, userHint: classified.userHint });
      throw error;
    } finally {
      state.organizerRunning = false;
      state.organizerPaused = false;
      state.organizerAbortController = null;
    }
  });

  ipcMain.handle(ORGANIZER.PAUSE, async () => {
    if (!state.organizerRunning) return { paused: false };
    state.organizerPaused = !state.organizerPaused;
    const label = state.organizerPaused ? '\u5df2\u6682\u505c' : '\u5df2\u7ee7\u7eed';
    sendOrganizerLog({ level: 'info', message: `\u6574\u7406\u4efb\u52a1${label}\u3002`, timestamp: new Date().toISOString() });
    sendOrganizerState({ status: 'running', message: `\u6574\u7406\u4efb\u52a1${label}\u3002` });
    return { paused: state.organizerPaused };
  });

  ipcMain.handle(ORGANIZER.STOP, async () => {
    if (!state.organizerRunning) return { stopped: false };
    if (state.organizerAbortController) {
      state.organizerAbortController.abort();
    }
    state.organizerPaused = false;
    sendOrganizerLog({ level: 'warn', message: '\u7528\u6237\u5df2\u624b\u52a8\u505c\u6b62\u6574\u7406\u4efb\u52a1\u3002', timestamp: new Date().toISOString() });
    sendOrganizerState({ status: 'error', message: '\u6574\u7406\u4efb\u52a1\u5df2\u505c\u6b62\u3002' });
    return { stopped: true };
  });

  ipcMain.handle(ORGANIZER.EXPORT_LOG, async (_, content) => {
    const logText = String(content || '').trim();
    if (!logText) throw new Error('\u65e5\u5fd7\u5185\u5bb9\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u5bfc\u51fa\u3002');
    const mainWindow = windowService.getWindow();
    const defaultName = `\u6574\u7406\u65e5\u5fd7_${new Date().toISOString().slice(0, 10)}.txt`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '\u5bfc\u51fa\u6574\u7406\u65e5\u5fd7',
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    });
    if (result.canceled || !result.filePath) return { saved: false };
    fs.writeFileSync(result.filePath, logText, 'utf8');
    return { saved: true, filePath: result.filePath };
  });
}

module.exports = { registerOrganizerHandlers };
