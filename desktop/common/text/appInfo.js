(function registerDesktopAppInfo(globalScope) {
  const APP_VERSION = '0.26';
  const APP_TITLE = 'JAV自动化爬虫工具';
  const SOURCE_NAME = 'raawaa/jav-scrapy';
  const SOURCE_URL = 'https://github.com/raawaa/jav-scrapy';
  const DEFAULT_BASE_URL = 'https://www.javbus.com';

  const APP_INFO = {
    title: APP_TITLE,
    version: APP_VERSION,
    subtitle: '基于JAV自动化整理归纳视频软件',
    eyebrow: 'Windows EXE',
    sourcePrefix: '感谢开源：',
    sourceName: SOURCE_NAME,
    sourceUrl: SOURCE_URL,
    defaultBaseUrl: DEFAULT_BASE_URL,
    outputFolderName: `${APP_TITLE}输出`
  };

  const FILE_NAMES = {
    magnetFilename: 'magnet-links.txt',
    latestLogFilename: 'latest-log.txt',
    taskLogPrefix: '运行日志'
  };

  const URL_SUGGESTIONS = [
    'https://www.javbus.com/',
    'https://www.busjav.cyou',
    'https://www.fanbus.bond',
    'https://www.cdnbus.bond'
  ];

  const payload = {
    APP_INFO,
    FILE_NAMES,
    URL_SUGGESTIONS
  };

  const registry = (globalScope.__desktopTextModules = globalScope.__desktopTextModules || {});
  Object.assign(registry, payload);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = payload;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
