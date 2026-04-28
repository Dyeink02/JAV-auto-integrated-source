function createWindowService({ BrowserWindow, path, state, desktopRoot, windowIconPath, appTitle, appVersion, appDemoLabel, mainText }) {
  function shouldOpenExternally(targetUrl) {
    const sanitized = String(targetUrl || '').trim();
    if (!sanitized) return false;
    if (/^(javascript|data|vbscript|file):/i.test(sanitized)) return false;
    return /^https?:\/\//i.test(sanitized);
  }

  function attachExternalNavigationGuards(windowInstance) {
    if (!windowInstance || !windowInstance.webContents) {
      return;
    }

    windowInstance.webContents.setWindowOpenHandler(({ url }) => {
      if (shouldOpenExternally(url)) {
        require('electron').shell.openExternal(url).catch(() => undefined);
      }
      return { action: 'deny' };
    });

    windowInstance.webContents.on('will-navigate', (event, url) => {
      if (!shouldOpenExternally(url)) {
        return;
      }

      event.preventDefault();
      require('electron').shell.openExternal(url).catch(() => undefined);
    });
  }

  async function createWindow() {
    state.mainWindow = new BrowserWindow({
      width: 1500,
      height: 980,
      minWidth: 1260,
      minHeight: 840,
      title: `${appTitle}${appDemoLabel ? `${mainText.demoTitleSeparator}${appDemoLabel}` : ''} v${appVersion}`,
      backgroundColor: '#070a16',
      icon: windowIconPath,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(desktopRoot, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    state.mainWindow.on('closed', () => {
      state.mainWindow = null;
    });

    attachExternalNavigationGuards(state.mainWindow);

    await state.mainWindow.loadFile(path.join(desktopRoot, 'renderer', 'index.html'));
    return state.mainWindow;
  }

  function getWindow() {
    return state.mainWindow;
  }

  function sendToRenderer(channel, payload) {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send(channel, payload);
    }
  }

  return {
    createWindow,
    getWindow,
    sendToRenderer
  };
}

module.exports = {
  createWindowService
};
