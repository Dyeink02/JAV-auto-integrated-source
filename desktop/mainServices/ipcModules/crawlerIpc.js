'use strict';

const { CRAWLER } = require('../../common/ipcChannels');

/**
 * Crawler IPC handlers.
 *
 * Channels registered:
 *   app:start-crawl, app:restart-crawl, app:stop-crawl, app:update-antiblock
 *
 * @param {object} deps – all deps forwarded from createIpcHandlerRegistrar
 */
function registerCrawlerHandlers(deps) {
  const {
    ipcMain,
    app,
    fs,
    path,
    runnerService,
    appInfo,
    desktopTestMode
  } = deps;

  ipcMain.handle(CRAWLER.START, async (_, settings) =>
    runnerService.startRunner({
      ...settings,
      resumeExisting: false
    })
  );

  ipcMain.handle(CRAWLER.RESTART, async (_, settings) => runnerService.restartRunner(settings));

  ipcMain.handle(CRAWLER.STOP, async () => runnerService.stopRunner());

  ipcMain.handle(CRAWLER.UPDATE_ANTIBLOCK, async (_, settings) => {
    if (desktopTestMode) {
      const filePath = path.join(app.getPath('temp'), 'jav-desktop-ui-test-antiblock.json');
      const antiBlockUrls = Array.from(
        new Set([
          settings && settings.base ? settings.base : (appInfo.defaultBaseUrl || 'https://www.javbus.com'),
          ...(appInfo.defaultBaseUrl ? [appInfo.defaultBaseUrl] : []),
          'https://www.javbus.com'
        ])
      );
      fs.writeFileSync(
        filePath,
        JSON.stringify({ updatedAt: new Date().toISOString(), antiBlockUrls }, null, 2),
        'utf8'
      );
      return { antiBlockUrls, filePath };
    }

    return runnerService.updateAntiBlockUrls(settings);
  });
}

module.exports = { registerCrawlerHandlers };
