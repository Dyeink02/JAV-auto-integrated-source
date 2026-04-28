/**
 * ipcChannels.js
 * IPC 通道名称集中注册表 —— 消除主进程/预加载/渲染进程之间的字符串重复。
 *
 * 所有通道名称在此统一定义，主进程 handle 端和渲染进程 invoke 端均引用此文件。
 * 命名约定：
 *   - app:*      渲染 → 主进程 invoke 通道
 *   - runner:*   主进程 → 渲染 推送通道（爬虫运行时）
 *   - organizer:*主进程 → 渲染 推送通道（整理服务）
 */

/* ------------------------------------------------------------------ */
/*  invoke 通道（渲染 → 主进程，request / response）                      */
/* ------------------------------------------------------------------ */

/** 设置与工具 */
const SETTINGS = {
  GET_SETTINGS:          'app:get-settings',
  GET_LOG_CONTEXT:       'app:get-log-context',
  SHOW_ALERT:            'app:show-alert',
  VALIDATE_PROXY:        'app:validate-proxy',
  CHOOSE_OUTPUT:         'app:choose-output',
  CHOOSE_BACKGROUND:     'app:choose-background-image',
  CLEAR_BACKGROUND:      'app:clear-background-image',
  CHOOSE_ORGANIZER_ROOT: 'app:choose-organizer-root',
  CHOOSE_LEARNING_SAMPLES: 'app:choose-learning-samples',
  GET_INTEGRATION_CONTEXT: 'app:get-integration-context',
  OPEN_PATH:             'app:open-path',
  OPEN_ORGANIZER_PATH:   'app:open-organizer-path',
  OPEN_OUTPUT_DIR:       'app:open-output-dir',
  OPEN_EXTERNAL:         'app:open-external',
  OPEN_LOG_FOLDER:       'app:open-log-folder',
  OPEN_MAGNET_FILE:      'app:open-magnet-file'
};

/** 爬虫控制 */
const CRAWLER = {
  START:           'app:start-crawl',
  RESTART:         'app:restart-crawl',
  STOP:            'app:stop-crawl',
  UPDATE_ANTIBLOCK:'app:update-antiblock'
};

/** 视频整理 */
const ORGANIZER = {
  RUN:             'app:run-organizer',
  PAUSE:           'app:pause-organizer',
  STOP:            'app:stop-organizer',
  EXPORT_LOG:      'app:export-organizer-log'
};

/** 广告学习 */
const AD_LEARNING = {
  GET_SUMMARY:     'app:get-ad-learning-summary',
  CLEAR_MODEL:     'app:clear-ad-learning-model',
  UPDATE_MODEL:    'app:update-ad-learning-model',
  IMPORT_SAMPLES:  'app:import-ad-learning-samples',
  LEARN_BY_CODES:  'app:learn-ad-samples-by-codes',
  LOAD_CRAWL_CODES:'app:load-crawl-film-codes'
};

/** 女优榜单 */
const RANKING = {
  GET_RANKINGS:    'app:get-actress-rankings',
  RESOLVE_TARGET:  'app:resolve-actress-crawl-target'
};

/* ------------------------------------------------------------------ */
/*  push 通道（主进程 → 渲染，单向推送）                                   */
/* ------------------------------------------------------------------ */

const PUSH = {
  RUNNER_LOG:        'runner:log',
  RUNNER_STATE:      'runner:state',
  RUNNER_LOG_CONTEXT:'runner:log-context',
  ORGANIZER_LOG:     'organizer:log',
  ORGANIZER_STATE:   'organizer:state'
};

module.exports = {
  SETTINGS,
  CRAWLER,
  ORGANIZER,
  AD_LEARNING,
  RANKING,
  PUSH
};
