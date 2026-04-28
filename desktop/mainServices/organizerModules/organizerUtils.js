'use strict';

const progressSchema = require('../../common/progressSchema.js');
const {
  PROGRESS_REPORT_STEP
} = require('../organizerConstants.js');

/* ------------------------------------------------------------------ */
/*  常量                                                                */
/* ------------------------------------------------------------------ */

const MANAGED_TOP_DIRS = new Set([
  '\u5f85\u6574\u7406',
  '\u5f85\u5220\u9664',
  '\u542b\u5f00\u5934\u5e7f\u544a',
  'logs',
  '.video-organizer-state'
]);
const MANAGED_TOP_DIRS_LOWER = new Set(
  Array.from(MANAGED_TOP_DIRS).map((item) => String(item || '').trim().toLowerCase())
);

/* ------------------------------------------------------------------ */
/*  事件发送                                                             */
/* ------------------------------------------------------------------ */

function emitLog(onLog, level, message) {
  if (typeof onLog !== 'function') {
    return;
  }

  onLog({
    level,
    message: String(message || ''),
    timestamp: new Date().toISOString()
  });
}

function emitProgress(onProgress, payload = {}) {
  if (typeof onProgress !== 'function') {
    return;
  }

  onProgress(progressSchema.createProgress(payload.scope, payload.phase, payload));
}

function shouldReportProgress(processed, total, step = PROGRESS_REPORT_STEP) {
  if (total <= 0) {
    return true;
  }
  if (processed <= 1 || processed >= total) {
    return true;
  }
  return processed % Math.max(1, step) === 0;
}

/* ------------------------------------------------------------------ */
/*  目录 / 路径                                                          */
/* ------------------------------------------------------------------ */

function isManagedDirectoryName(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return false;
  }
  return MANAGED_TOP_DIRS.has(raw) || MANAGED_TOP_DIRS_LOWER.has(raw.toLowerCase());
}

/* ------------------------------------------------------------------ */
/*  数值 / 类型转换                                                      */
/* ------------------------------------------------------------------ */

function toSafeInteger(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(minimum, fallback);
  }
  return Math.max(minimum, parsed);
}

function formatBytesToGB(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num < 0) return '0.00';
  return (num / 1024 / 1024 / 1024).toFixed(2);
}

/* ------------------------------------------------------------------ */
/*  番号 / 文本规范化                                                     */
/* ------------------------------------------------------------------ */

function normalizeAdFileAction(rawValue) {
  return String(rawValue || '').trim() === 'delete-directly' ? 'delete-directly' : 'move-to-delete';
}

function getAdFileActionLabel(action) {
  return action === 'delete-directly' ? '\u76f4\u63a5\u5220\u9664\u5e7f\u544a\u6587\u4ef6' : '\u79fb\u5165\u5f85\u5220\u9664';
}

function normalizeSuffixInput(rawInput) {
  const normalized = String(rawInput || '').trim();
  return normalized || '-A';
}

function normalizeFilmId(rawValue) {
  const compactValue = String(rawValue || '')
    .toUpperCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
  const match = compactValue.match(/^([A-Z]{2,12})-?(\d{2,8})([A-Z]*)$/);

  if (!match) {
    return compactValue;
  }

  const [, prefix, digits, suffix] = match;
  // 保守规范化：仅统一格式（大写、分隔符），保留原始数字格式
  // 这样从 JAV 网站 URL 提取的番号（如 FNC-210548）不会被错误修改
  // 本地文件名提取的番号也能保持原始格式进行匹配
  return `${prefix}-${digits}${suffix}`.replace(/-+/g, '-');
}

function normalizeCodeToken(code) {
  return normalizeFilmId(code).replace(/[^A-Z0-9]/g, '');
}

function extractFilmId(value) {
  const normalizedValue = String(value || '').toUpperCase();
  const directMatch = normalizedValue.match(/([A-Z]{2,12}-?\d{2,8}[A-Z]*)/);
  if (directMatch && directMatch[1]) {
    return normalizeFilmId(directMatch[1]);
  }

  try {
    const parsedUrl = new URL(String(value || ''));
    const pathname = parsedUrl.pathname.split('/').filter(Boolean).pop() || '';
    const pathMatch = pathname.toUpperCase().match(/([A-Z]{2,12}-?\d{2,8}[A-Z]*)/);
    return pathMatch && pathMatch[1] ? normalizeFilmId(pathMatch[1]) : '';
  } catch {
    return '';
  }
}

function sortCodeAlphabetically(codes) {
  return Array.from(codes || []).sort((left, right) => String(left || '').localeCompare(String(right || ''), 'en'));
}

/* ------------------------------------------------------------------ */
/*  文件系统辅助（需要 fs 注入）                                           */
/* ------------------------------------------------------------------ */

function createFsHelpers({ fs, path }) {
  async function pathExists(targetPath) {
    try {
      await fs.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureDirectory(targetPath) {
    await fs.promises.mkdir(targetPath, { recursive: true });
  }

  async function writeTextFile(filePath, lines) {
    await fs.promises.writeFile(filePath, `${lines.join('\r\n')}\r\n`, 'utf8');
  }

  function normalizeRootPath(rootPath) {
    const trimmed = String(rootPath || '').trim();
    if (!trimmed) {
      return '';
    }
    return path.resolve(trimmed);
  }

  return { pathExists, ensureDirectory, writeTextFile, normalizeRootPath };
}

/* ------------------------------------------------------------------ */
/*  导出                                                                */
/* ------------------------------------------------------------------ */

module.exports = {
  MANAGED_TOP_DIRS,
  MANAGED_TOP_DIRS_LOWER,
  emitLog,
  emitProgress,
  shouldReportProgress,
  isManagedDirectoryName,
  toSafeInteger,
  formatBytesToGB,
  normalizeAdFileAction,
  getAdFileActionLabel,
  normalizeSuffixInput,
  normalizeFilmId,
  normalizeCodeToken,
  extractFilmId,
  sortCodeAlphabetically,
  createFsHelpers
};
