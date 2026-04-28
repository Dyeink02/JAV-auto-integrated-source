'use strict';

const { SETTINGS } = require('../../common/ipcChannels');

/**
 * Settings & utility IPC handlers.
 *
 * Channels registered:
 *   app:get-settings, app:get-log-context, app:show-alert, app:validate-proxy,
 *   app:choose-output, app:choose-background-image, app:clear-background-image,
 *   app:open-path, app:open-output-dir, app:open-external,
 *   app:open-log-folder, app:open-magnet-file
 *
 * @param {object} deps – all deps forwarded from createIpcHandlerRegistrar
 */
function registerSettingsHandlers(deps) {
  const {
    ipcMain,
    app,
    fs,
    path,
    dialog,
    shell,
    windowService,
    settingsStore,
    logBridge,
    state,
    appInfo,
    mainText,
    desktopTestMode,
    proxyValidationService,
    pathToFileURL
  } = deps;

  function resolveBackgroundImageUrl(backgroundImage) {
    const normalizedPath = typeof backgroundImage === 'string' ? backgroundImage.trim() : '';
    if (!normalizedPath || !fs.existsSync(normalizedPath)) return '';
    return pathToFileURL(normalizedPath).href;
  }

  function attachBackgroundSettings(settings = {}) {
    const backgroundImage =
      typeof settings.backgroundImage === 'string' ? settings.backgroundImage.trim() : '';
    return {
      ...settings,
      backgroundImage,
      backgroundImageUrl: resolveBackgroundImageUrl(backgroundImage)
    };
  }

  function persistBackgroundImage(backgroundImage) {
    const nextSettings = {
      ...settingsStore.loadSettings(),
      backgroundImage: typeof backgroundImage === 'string' ? backgroundImage.trim() : ''
    };
    settingsStore.saveSettings(nextSettings);
    return attachBackgroundSettings(nextSettings);
  }

  ipcMain.handle(SETTINGS.GET_SETTINGS, async () =>
    attachBackgroundSettings(settingsStore.loadSettings())
  );

  ipcMain.handle(SETTINGS.GET_LOG_CONTEXT, async () => logBridge.getLogContext());

  ipcMain.handle(SETTINGS.SHOW_ALERT, async (_, options = {}) => {
    const mainWindow = windowService.getWindow();
    const dialogOptions = {
      type: options.type || 'warning',
      title: String(options.title || (appInfo && appInfo.title) || 'JAV\u81ea\u52a8\u5316\u722c\u866b\u5de5\u5177'),
      message: String(options.message || ''),
      detail: String(options.detail || ''),
      buttons: [String(options.buttonLabel || '\u6211\u77e5\u9053\u4e86')],
      defaultId: 0,
      noLink: true
    };
    if (desktopTestMode || !mainWindow || mainWindow.isDestroyed()) {
      return dialogOptions;
    }
    const result = await dialog.showMessageBox(mainWindow, dialogOptions);
    mainWindow.focus();
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus();
    }
    return result;
  });

  ipcMain.handle(SETTINGS.VALIDATE_PROXY, async (_, proxyValue, options = {}) => {
    if (desktopTestMode) {
      const normalizedProxy = String(proxyValue || '').trim();
      return normalizedProxy
        ? { status: 'valid', normalizedProxy, message: '\u4ee3\u7406\u6b63\u5e38', detail: '\u684c\u9762\u6d4b\u8bd5\u6a21\u5f0f\u4e0b\u5df2\u8df3\u8fc7\u771f\u5b9e\u7f51\u7edc\u6821\u9a8c\u3002' }
        : { status: 'empty', normalizedProxy: '', message: '\u4ee3\u7406\u672a\u586b\u5199', detail: '\u5f53\u524d\u5c06\u4f7f\u7528\u76f4\u8fde\u65b9\u5f0f\u8fd0\u884c\u3002' };
    }
    return proxyValidationService.validateProxy(proxyValue, options);
  });

  ipcMain.handle(SETTINGS.CHOOSE_OUTPUT, async () => {
    if (desktopTestMode) {
      return settingsStore.ensureDesktopTestArtifacts().outputDir;
    }
    const result = await dialog.showOpenDialog(windowService.getWindow(), {
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(SETTINGS.CHOOSE_BACKGROUND, async () => {
    if (desktopTestMode) return persistBackgroundImage('');
    const result = await dialog.showOpenDialog(windowService.getWindow(), {
      properties: ['openFile'],
      filters: [{ name: '\u56fe\u7247\u6587\u4ef6', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return persistBackgroundImage(result.filePaths[0]);
  });

  ipcMain.handle(SETTINGS.CLEAR_BACKGROUND, async () => persistBackgroundImage(''));

  function isSafeExternalUrl(targetUrl) {
    const sanitized = String(targetUrl || '').trim();
    if (!sanitized) return false;
    if (/^(javascript|data|vbscript|file):/i.test(sanitized)) return false;
    return /^https?:\/\//i.test(sanitized);
  }

  ipcMain.handle(SETTINGS.OPEN_PATH, async (_, targetPath) => {
    if (!targetPath) return null;
    const normalizedPath = String(targetPath).trim();
    if (!normalizedPath) return null;
    if (!desktopTestMode) await shell.openPath(normalizedPath);
    return normalizedPath;
  });

  ipcMain.handle(SETTINGS.OPEN_OUTPUT_DIR, async (_, targetOutput) => {
    const targetDir =
      state.currentTaskOutputDir ||
      state.lastTaskOutputDir ||
      (typeof targetOutput === 'string' && targetOutput.trim()
        ? targetOutput.trim()
        : settingsStore.getCurrentOutputDir());
    fs.mkdirSync(targetDir, { recursive: true });
    if (!desktopTestMode) await shell.openPath(targetDir);
    return targetDir;
  });

  ipcMain.handle(SETTINGS.OPEN_EXTERNAL, async (_, targetUrl) => {
    if (!targetUrl || !isSafeExternalUrl(targetUrl)) return null;
    if (!desktopTestMode) await shell.openExternal(targetUrl);
    return targetUrl;
  });

  ipcMain.handle(SETTINGS.OPEN_LOG_FOLDER, async () => {
    const outputDir =
      state.currentTaskOutputDir ||
      state.lastTaskOutputDir ||
      settingsStore.loadSettings().output ||
      app.getPath('documents');
    const fallbackDir = path.join(outputDir, 'logs');
    const targetDir = logBridge.getLogContext().logDir || fallbackDir;
    fs.mkdirSync(targetDir, { recursive: true });
    if (!desktopTestMode) await shell.openPath(targetDir);
    return targetDir;
  });

  ipcMain.handle(SETTINGS.OPEN_MAGNET_FILE, async (_, targetOutput) => {
    const outputDir =
      state.currentTaskOutputDir ||
      state.lastTaskOutputDir ||
      (typeof targetOutput === 'string' && targetOutput.trim()
        ? targetOutput.trim()
        : settingsStore.getCurrentOutputDir());
    if (desktopTestMode) {
      settingsStore.ensureDesktopTestArtifacts(outputDir);
    }
    const magnetFilePath = settingsStore.getMagnetFilePath(outputDir);
    if (!fs.existsSync(magnetFilePath)) {
      throw new Error(`${mainText.magnetFileMissingPrefix}${magnetFilePath}`);
    }
    if (!desktopTestMode) await shell.openPath(magnetFilePath);
    return magnetFilePath;
  });
}

module.exports = { registerSettingsHandlers };
