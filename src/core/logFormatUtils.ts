/**
 * logFormatUtils.ts
 * 统一日志格式化工具 —— 消除遍布项目的重复错误格式化模式。
 *
 * 典型用法：
 *   import { fmtErr, fmtErrType, fmtErrStack, logErrorBlock, fmtMs } from './logFormatUtils';
 *   logger.warn(`操作失败: ${fmtErr(error)}`);
 *   logErrorBlock(logger, error, 'executeAjax');
 */

/* ------------------------------------------------------------------ */
/*  错误信息提取                                                         */
/* ------------------------------------------------------------------ */

/** 安全提取错误消息 */
export function fmtErr(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 安全提取错误类型名 */
export function fmtErrType(error: unknown): string {
  return error instanceof Error ? error.constructor.name : 'Unknown';
}

/** 安全提取错误堆栈 */
export function fmtErrStack(error: unknown): string {
  return error instanceof Error ? (error.stack || '无堆栈信息') : '无堆栈信息';
}

/* ------------------------------------------------------------------ */
/*  组合日志输出                                                         */
/* ------------------------------------------------------------------ */

interface MinimalLogger {
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

/**
 * 统一的错误详情日志块（错误消息 + 类型 + 堆栈 + JSON）。
 * 替代项目中反复出现的三行 logger.error + logger.debug 模式。
 *
 * @param logger  任意具有 error/debug 方法的日志器
 * @param error   捕获的异常
 * @param context 可选的模块/函数前缀（如 'executeAjax'）
 */
export function logErrorBlock(
  logger: MinimalLogger,
  error: unknown,
  context?: string
): void {
  const prefix = context ? `${context}: ` : '';
  logger.error(`${prefix}错误详情：${fmtErr(error)}`);
  logger.error(`${prefix}错误类型：${fmtErrType(error)}`);
  logger.error(`${prefix}错误堆栈：${fmtErrStack(error)}`);
  logger.debug(`${prefix}完整错误对象: ${JSON.stringify(error, null, 2)}`);
}

/* ------------------------------------------------------------------ */
/*  时间格式化                                                          */
/* ------------------------------------------------------------------ */

/** 毫秒 → 人类可读秒数（如 "3s"、"0.5s"） */
export function fmtMs(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/** 毫秒 → 保留原始毫秒值（如 "1234ms"） */
export function fmtMsRaw(ms: number): string {
  return `${ms}ms`;
}
