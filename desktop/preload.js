const { contextBridge, ipcRenderer } = require('electron');

/**
 * preload.js 运行在 sandbox: true 环境中，只能 require Electron 内建模块，
 * 不能 require 本地文件（如 ipcChannels.js）。通道名称必须内联为字符串字面量，
 * 与 ipcChannels.js 中的定义保持一致即可。
 */

contextBridge.exposeInMainWorld('javDesktop', {
  // --- SETTINGS ---
  getSettings: () => ipcRenderer.invoke('app:get-settings'),
  getLogContext: () => ipcRenderer.invoke('app:get-log-context'),
  showAlert: (options) => ipcRenderer.invoke('app:show-alert', options),
  validateProxy: (proxyValue, options) => ipcRenderer.invoke('app:validate-proxy', proxyValue, options),
  chooseOutput: () => ipcRenderer.invoke('app:choose-output'),
  chooseBackgroundImage: () => ipcRenderer.invoke('app:choose-background-image'),
  clearBackgroundImage: () => ipcRenderer.invoke('app:clear-background-image'),
  chooseOrganizerRoot: () => ipcRenderer.invoke('app:choose-organizer-root'),
  chooseLearningSamples: () => ipcRenderer.invoke('app:choose-learning-samples'),
  getIntegrationContext: () => ipcRenderer.invoke('app:get-integration-context'),
  openPath: (targetPath) => ipcRenderer.invoke('app:open-path', targetPath),
  openOrganizerPath: (rootPath, kind) => ipcRenderer.invoke('app:open-organizer-path', rootPath, kind),
  openOutputDir: (targetPath) => ipcRenderer.invoke('app:open-output-dir', targetPath),
  openExternal: (targetUrl) => ipcRenderer.invoke('app:open-external', targetUrl),
  openLogFolder: () => ipcRenderer.invoke('app:open-log-folder'),
  openMagnetFile: (targetOutput) => ipcRenderer.invoke('app:open-magnet-file', targetOutput),

  // --- AD_LEARNING ---
  getAdLearningSummary: () => ipcRenderer.invoke('app:get-ad-learning-summary'),
  clearAdLearningModel: () => ipcRenderer.invoke('app:clear-ad-learning-model'),
  updateAdLearningModel: (options) => ipcRenderer.invoke('app:update-ad-learning-model', options),
  importAdLearningSamples: (options) => ipcRenderer.invoke('app:import-ad-learning-samples', options),
  learnAdSamplesByCodes: (options) => ipcRenderer.invoke('app:learn-ad-samples-by-codes', options),
  loadCrawlFilmCodes: (options) => ipcRenderer.invoke('app:load-crawl-film-codes', options),

  // --- RANKING ---
  getActressRankings: (options) => ipcRenderer.invoke('app:get-actress-rankings', options),
  resolveActressCrawlTarget: (options) => ipcRenderer.invoke('app:resolve-actress-crawl-target', options),

  // --- ORGANIZER ---
  runOrganizer: (options) => ipcRenderer.invoke('app:run-organizer', options),
  pauseOrganizer: () => ipcRenderer.invoke('app:pause-organizer'),
  stopOrganizer: () => ipcRenderer.invoke('app:stop-organizer'),
  exportOrganizerLog: (content) => ipcRenderer.invoke('app:export-organizer-log', content),

  // --- CRAWLER ---
  startCrawl: (settings) => ipcRenderer.invoke('app:start-crawl', settings),
  restartCrawl: (settings) => ipcRenderer.invoke('app:restart-crawl', settings),
  stopCrawl: () => ipcRenderer.invoke('app:stop-crawl'),
  updateAntiBlock: (settings) => ipcRenderer.invoke('app:update-antiblock', settings),

  // --- PUSH (主进程 → 渲染) ---
  onLog: (callback) => {
    const listener = (_, payload) => { try { callback(payload); } catch { /* renderer callback error */ } };
    ipcRenderer.on('runner:log', listener);
    return () => ipcRenderer.removeListener('runner:log', listener);
  },
  onState: (callback) => {
    const listener = (_, payload) => { try { callback(payload); } catch { /* renderer callback error */ } };
    ipcRenderer.on('runner:state', listener);
    return () => ipcRenderer.removeListener('runner:state', listener);
  },
  onLogContext: (callback) => {
    const listener = (_, payload) => { try { callback(payload); } catch { /* renderer callback error */ } };
    ipcRenderer.on('runner:log-context', listener);
    return () => ipcRenderer.removeListener('runner:log-context', listener);
  },
  onOrganizerLog: (callback) => {
    const listener = (_, payload) => { try { callback(payload); } catch { /* renderer callback error */ } };
    ipcRenderer.on('organizer:log', listener);
    return () => ipcRenderer.removeListener('organizer:log', listener);
  },
  onOrganizerState: (callback) => {
    const listener = (_, payload) => { try { callback(payload); } catch { /* renderer callback error */ } };
    ipcRenderer.on('organizer:state', listener);
    return () => ipcRenderer.removeListener('organizer:state', listener);
  }
});
