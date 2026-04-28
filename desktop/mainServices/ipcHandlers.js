'use strict';

/**
 * IPC handler registrar – facade.
 *
 * Delegates channel registration to dedicated sub-modules:
 *   ipcModules/settingsIpc.js   – settings / utility channels
 *   ipcModules/organizerIpc.js  – organizer channels
 *   ipcModules/adLearningIpc.js – ad-learning channels
 *   ipcModules/crawlerIpc.js    – crawler channels
 *   ipcModules/rankingIpc.js    – actress ranking channels
 */

const { pathToFileURL } = require('url');
const { registerSettingsHandlers } = require('./ipcModules/settingsIpc.js');
const { registerOrganizerHandlers } = require('./ipcModules/organizerIpc.js');
const { registerAdLearningHandlers } = require('./ipcModules/adLearningIpc.js');
const { registerCrawlerHandlers } = require('./ipcModules/crawlerIpc.js');
const { registerRankingHandlers } = require('./ipcModules/rankingIpc.js');

/**
 * @param {object} deps
 * @returns {() => void} registerIpcHandlers
 */
function createIpcHandlerRegistrar(deps) {
  return function registerIpcHandlers() {
    if (deps.state.ipcHandlersRegistered) {
      return;
    }

    deps.state.ipcHandlersRegistered = true;

    // Inject pathToFileURL so settingsIpc can resolve background-image URLs.
    const depsWithUrl = { ...deps, pathToFileURL };

    registerSettingsHandlers(depsWithUrl);
    registerOrganizerHandlers(depsWithUrl);
    registerAdLearningHandlers(depsWithUrl);
    registerCrawlerHandlers(depsWithUrl);
    registerRankingHandlers(depsWithUrl);
  };
}

module.exports = {
  createIpcHandlerRegistrar
};
