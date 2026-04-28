(function registerDesktopTaskConfig(globalScope) {
  const STATUS_LABELS = {
    idle: '待机',
    starting: '启动中',
    running: '运行中',
    stopping: '终止中',
    completed: '已完成',
    incomplete: '未完成',
    stopped: '已终止',
    error: '异常'
  };

  const FAILURE_CATEGORY_LABELS = {
    blocked: '验证拦截',
    network: '网络超时',
    empty: '空响应',
    parse: '解析失败',
    cloudflare: 'Cloudflare',
    unknown: '未知异常',
    stopped: '已终止'
  };

  const TASK_TEMPLATES = {
    balanced: {
      label: '均衡模板',
      parallel: 2,
      delay: 2,
      timeout: 30000,
      itemsPerPage: 30,
      cloudflare: false,
      secondValidation: true
    },
    stable: {
      label: '稳定模板',
      parallel: 1,
      delay: 4,
      timeout: 45000,
      itemsPerPage: 30,
      cloudflare: true,
      secondValidation: true
    },
    recovery: {
      label: '恢复模板',
      parallel: 1,
      delay: 3,
      timeout: 45000,
      itemsPerPage: 30,
      cloudflare: true,
      secondValidation: true
    }
  };

  const payload = {
    STATUS_LABELS,
    FAILURE_CATEGORY_LABELS,
    TASK_TEMPLATES
  };

  const registry = (globalScope.__desktopTextModules = globalScope.__desktopTextModules || {});
  Object.assign(registry, payload);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = payload;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
