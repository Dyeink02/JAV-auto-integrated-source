'use strict';

/**
 * errorClassifier.js
 * 统一错误分类体系 —— 在 IPC 边界和 UI 层提供一致的错误类型与用户提示。
 *
 * 设计原则：
 *   - 轻量：仅做分类与格式化，不做诊断日志（诊断由 errorHandler.ts / logFormatUtils 负责）
 *   - 跨层：主进程、渲染进程均可引用
 *   - 可序列化：分类结果可直接通过 IPC 传递
 */

// ── 错误类型枚举 ──────────────────────────────────────────────────────────

const ErrorType = Object.freeze({
  NETWORK:     'NETWORK',
  PROXY:       'PROXY',
  CLOUDFLARE:  'CLOUDFLARE',
  FILESYSTEM:  'FILESYSTEM',
  PARSER:      'PARSER',
  USER_INPUT:  'USER_INPUT',
  TIMEOUT:     'TIMEOUT',
  ABORT:       'ABORT',
  UNKNOWN:     'UNKNOWN'
});

// ── 用户友好提示映射 ──────────────────────────────────────────────────────

const USER_HINTS = Object.freeze({
  [ErrorType.NETWORK]:    '请检查网络连接是否正常。',
  [ErrorType.PROXY]:      '代理服务器异常，请检查代理设置或更换代理。',
  [ErrorType.CLOUDFLARE]: '目标网站触发了反爬保护，请稍后重试或更新防屏蔽地址。',
  [ErrorType.FILESYSTEM]: '文件操作失败，请检查路径和磁盘权限。',
  [ErrorType.PARSER]:     '数据解析异常，可能是网站结构变更。',
  [ErrorType.USER_INPUT]: '请检查输入参数是否正确。',
  [ErrorType.TIMEOUT]:    '操作超时，请检查网络或稍后重试。',
  [ErrorType.ABORT]:      '操作已被用户取消。',
  [ErrorType.UNKNOWN]:    '发生未知错误，请查看日志获取详情。'
});

// ── 分类关键词规则（按优先级排列） ────────────────────────────────────────

const CLASSIFICATION_RULES = [
  // ABORT — 最高优先级，用户主动取消
  {
    type: ErrorType.ABORT,
    recoverable: false,
    keywords: ['abort', 'cancelled', 'canceled', '已取消', '已停止', '用户中断'],
    codes: ['ERR_CANCELED', 'ABORT_ERR']
  },
  // PROXY
  {
    type: ErrorType.PROXY,
    recoverable: true,
    keywords: ['proxy', '代理', 'ECONNREFUSED', 'tunnel', 'socks'],
    codes: ['ECONNREFUSED']
  },
  // CLOUDFLARE
  {
    type: ErrorType.CLOUDFLARE,
    recoverable: true,
    keywords: ['cloudflare', 'challenge', 'turnstile', '5秒盾', 'cf-browser', 'cf-challenge', '403 forbidden'],
    statusCodes: [403, 503]
  },
  // TIMEOUT
  {
    type: ErrorType.TIMEOUT,
    recoverable: true,
    keywords: ['timeout', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', '超时', 'timed out'],
    codes: ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED']
  },
  // NETWORK
  {
    type: ErrorType.NETWORK,
    recoverable: true,
    keywords: ['ECONNRESET', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'socket hang up', 'network', '网络'],
    codes: ['ECONNRESET', 'ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN', 'EPIPE']
  },
  // FILESYSTEM
  {
    type: ErrorType.FILESYSTEM,
    recoverable: false,
    keywords: ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS', 'EBUSY', 'EMFILE', '文件', '目录', '磁盘'],
    codes: ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ENOSPC', 'EROFS', 'EBUSY', 'EMFILE', 'ENFILE']
  },
  // PARSER
  {
    type: ErrorType.PARSER,
    recoverable: false,
    keywords: ['parse', 'JSON', 'unexpected token', 'syntax', '解析'],
    errorNames: ['SyntaxError']
  },
  // USER_INPUT
  {
    type: ErrorType.USER_INPUT,
    recoverable: false,
    keywords: ['invalid', '无效', '为空', '不能为空', '格式错误', '请先', '请输入', '参数'],
  }
];

// ── 核心分类函数 ──────────────────────────────────────────────────────────

/**
 * 对任意错误进行分类，返回结构化的错误描述。
 *
 * @param {unknown} error - 原始错误对象
 * @param {string}  [context] - 可选的上下文标签（如 '爬虫请求' / '视频整理'）
 * @returns {{ type: string, message: string, recoverable: boolean, userHint: string, context: string }}
 */
function classifyError(error, context) {
  const message = extractMessage(error);
  const code = extractCode(error);
  const statusCode = extractStatusCode(error);
  const errorName = error instanceof Error ? error.name : '';

  for (const rule of CLASSIFICATION_RULES) {
    // 检查 error code
    if (code && rule.codes && rule.codes.includes(code)) {
      return buildResult(rule.type, message, rule.recoverable, context);
    }
    // 检查 HTTP status code
    if (statusCode && rule.statusCodes && rule.statusCodes.includes(statusCode)) {
      return buildResult(rule.type, message, rule.recoverable, context);
    }
    // 检查 error name
    if (errorName && rule.errorNames && rule.errorNames.includes(errorName)) {
      return buildResult(rule.type, message, rule.recoverable, context);
    }
    // 检查关键词（不区分大小写）
    if (rule.keywords) {
      const lowerMessage = message.toLowerCase();
      if (rule.keywords.some((kw) => lowerMessage.includes(kw.toLowerCase()))) {
        return buildResult(rule.type, message, rule.recoverable, context);
      }
    }
  }

  return buildResult(ErrorType.UNKNOWN, message, false, context);
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────

function extractMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function extractCode(error) {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code);
  }
  return '';
}

function extractStatusCode(error) {
  if (error && typeof error === 'object') {
    // Axios style
    const response = /** @type {any} */ (error).response;
    if (response && typeof response.status === 'number') {
      return response.status;
    }
    // Generic statusCode property
    if (typeof /** @type {any} */ (error).statusCode === 'number') {
      return /** @type {any} */ (error).statusCode;
    }
  }
  return 0;
}

function buildResult(type, message, recoverable, context) {
  return {
    type,
    message,
    recoverable,
    userHint: USER_HINTS[type] || USER_HINTS[ErrorType.UNKNOWN],
    context: context || ''
  };
}

/**
 * 格式化分类结果为单行用户可读字符串。
 * 适合直接显示在 UI 的状态栏或日志面板中。
 *
 * @param {{ type: string, message: string, userHint: string, context: string }} classified
 * @returns {string}
 */
function formatClassifiedError(classified) {
  const prefix = classified.context ? `[${classified.context}] ` : '';
  return `${prefix}${classified.message}（${classified.userHint}）`;
}

/**
 * 判断错误是否可恢复（快捷方法，无需先调用 classifyError）。
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isRecoverable(error) {
  return classifyError(error).recoverable;
}

module.exports = {
  ErrorType,
  USER_HINTS,
  classifyError,
  formatClassifiedError,
  isRecoverable
};
