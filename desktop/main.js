const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, ipcMain, shell, Notification } = require('electron');

const { APP_INFO, FILE_NAMES, MAIN_TEXT, LOG_FILTER_PATTERNS, URL_SUGGESTIONS, STATUS_LABELS } = require(
  path.join(__dirname, 'common', 'appText.js')
);
const { getActressRankings } = require(path.join(__dirname, 'common', 'actressRankingService.js'));
const { resolveActressCrawlTarget } = require(path.join(__dirname, 'common', 'javBusActressLookupService.js'));
const { createRuntimeState } = require(path.join(__dirname, 'mainServices', 'runtimeState.js'));
const { createSettingsStore } = require(path.join(__dirname, 'mainServices', 'settingsStore.js'));
const { createWindowService } = require(path.join(__dirname, 'mainServices', 'windowService.js'));
const { createLogBridge } = require(path.join(__dirname, 'mainServices', 'logBridge.js'));
const { createRunnerService } = require(path.join(__dirname, 'mainServices', 'runnerService.js'));
const { createProxyValidationService } = require(path.join(__dirname, 'mainServices', 'proxyValidationService.js'));
const { createOrganizerService } = require(path.join(__dirname, 'mainServices', 'organizerService.js'));
const { createAdLearningService } = require(path.join(__dirname, 'mainServices', 'adLearningService.js'));
const { createIpcHandlerRegistrar } = require(path.join(__dirname, 'mainServices', 'ipcHandlers.js'));
const RUNTIME_PACKAGE = require(path.join(__dirname, '..', 'package.json'));

const APP_TITLE = RUNTIME_PACKAGE.productDisplayName || APP_INFO.title;
const APP_VERSION = APP_INFO.version || RUNTIME_PACKAGE.productDisplayVersion || RUNTIME_PACKAGE.version;
const APP_DEMO_LABEL = RUNTIME_PACKAGE.demoLabel || '';
const MAGNET_FILENAME = FILE_NAMES.magnetFilename || 'magnet-links.txt';
const WINDOW_ICON_PATH = path.join(__dirname, 'renderer', 'assets', 'app-icon.png');
const DESKTOP_TEST_MODE = process.env.JAV_DESKTOP_TEST_MODE === '1' || process.argv.includes('--desktop-test-mode');
const REMOTE_DEBUG_PORT = String(process.env.JAV_DESKTOP_REMOTE_DEBUG_PORT || '').trim();

if (REMOTE_DEBUG_PORT && process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUG_PORT);
  app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost:*');
}

const state = createRuntimeState();
const settingsStore = createSettingsStore({
  app,
  fs,
  path,
  appInfo: APP_INFO,
  magnetFilename: MAGNET_FILENAME
});
const windowService = createWindowService({
  BrowserWindow,
  path,
  state,
  desktopRoot: __dirname,
  windowIconPath: WINDOW_ICON_PATH,
  appTitle: APP_TITLE,
  appVersion: APP_VERSION,
  appDemoLabel: APP_DEMO_LABEL,
  mainText: MAIN_TEXT
});
const logBridge = createLogBridge({
  fs,
  path,
  sendToRenderer: windowService.sendToRenderer,
  mainText: MAIN_TEXT,
  statusLabels: STATUS_LABELS,
  logFilterPatterns: LOG_FILTER_PATTERNS,
  fileNames: FILE_NAMES,
  appTitle: APP_TITLE,
  appVersion: APP_VERSION,
  appDemoLabel: APP_DEMO_LABEL
});
const runnerService = createRunnerService({
  state,
  app,
  dialog,
  Notification,
  path,
  desktopRoot: __dirname,
  runtimePackage: RUNTIME_PACKAGE,
  appTitle: APP_TITLE,
  appVersion: APP_VERSION,
  appDemoLabel: APP_DEMO_LABEL,
  mainText: MAIN_TEXT,
  windowService,
  settingsStore,
  logBridge
});
const proxyValidationService = createProxyValidationService();
const organizerService = createOrganizerService({ fs, path });
const adLearningService = createAdLearningService({ app, fs, path });
const registerIpcHandlers = createIpcHandlerRegistrar({
  state,
  app,
  fs,
  path,
  ipcMain,
  dialog,
  shell,
  windowService,
  settingsStore,
  logBridge,
  runnerService,
  appInfo: APP_INFO,
  mainText: MAIN_TEXT,
  urlSuggestions: URL_SUGGESTIONS,
  desktopTestMode: DESKTOP_TEST_MODE,
  proxyValidationService,
  getActressRankings,
  resolveActressCrawlTarget,
  organizerService,
  adLearningService
});

app.whenReady().then(async () => {
  registerIpcHandlers();
  settingsStore.ensureRankingHistoryArtifacts();
  await windowService.createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  // Flush any dirty hash cache writes before the process exits (Task 2).
  try {
    adLearningService.flushHashCache();
  } catch {
    // Non-critical: ignore flush errors on exit.
  }
  await runnerService.handleBeforeQuit(event);
});
