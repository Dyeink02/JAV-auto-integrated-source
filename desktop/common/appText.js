(function initializeDesktopAppText(globalScope) {
  const registry = (globalScope.__desktopTextModules = globalScope.__desktopTextModules || {});
  const isNode = typeof module !== 'undefined' && module.exports;
  const loadNodeModule = (relativePath) => (isNode ? require(relativePath) : {});

  const appInfoModule = registry.APP_INFO ? registry : loadNodeModule('./text/appInfo.js');
  const taskConfigModule = registry.STATUS_LABELS ? registry : loadNodeModule('./text/taskConfig.js');
  const versionHistoryModule = registry.VERSION_HISTORY ? registry : loadNodeModule('./text/versionHistory.js');
  const uiTextModule = registry.UI_TEXT_SOURCE ? registry : loadNodeModule('./text/uiTextSource.js');
  const runtimeTextModule = registry.MAIN_TEXT ? registry : loadNodeModule('./text/runtimeText.js');

  const api = {
    APP_INFO: appInfoModule.APP_INFO || {},
    FILE_NAMES: appInfoModule.FILE_NAMES || {},
    STATUS_LABELS: taskConfigModule.STATUS_LABELS || {},
    FAILURE_CATEGORY_LABELS: taskConfigModule.FAILURE_CATEGORY_LABELS || {},
    TASK_TEMPLATES: taskConfigModule.TASK_TEMPLATES || {},
    URL_SUGGESTIONS: appInfoModule.URL_SUGGESTIONS || [],
    VERSION_HISTORY: versionHistoryModule.VERSION_HISTORY || [],
    UI_TEXT_SOURCE: uiTextModule.UI_TEXT_SOURCE || {},
    MAIN_TEXT: runtimeTextModule.MAIN_TEXT || {},
    LOG_FILTER_PATTERNS: runtimeTextModule.LOG_FILTER_PATTERNS || {}
  };

  globalScope.desktopAppText = api;

  if (isNode) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
