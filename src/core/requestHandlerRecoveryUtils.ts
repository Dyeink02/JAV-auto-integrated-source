/**
 * requestHandlerRecoveryUtils.ts
 * Cloudflare 恢复链路运行时管理 + 快速 HTTP 磁力熔断器 + 磁力校验冷却
 * 所有函数均为纯函数，接收状态对象作为参数，不依赖 this。
 */

import type { FastHttpMagnetCircuitState } from './requestHandlerTypes';
import {
  CF_RECOVERY_MIN_BASE_DELAY_MS,
  CF_RECOVERY_MAX_DELAY_MS,
  CF_RECOVERY_DELAY_INCREMENT_MS,
  FAST_HTTP_MAGNET_SEVERE_THRESHOLD,
  FAST_HTTP_MAGNET_MIN_ATTEMPTS,
  FAST_HTTP_MAGNET_CONSECUTIVE_THRESHOLD,
  FAST_HTTP_MAGNET_RATE_SAMPLE_MIN,
  FAST_HTTP_MAGNET_MIN_SUCCESS_RATE
} from './crawlerConstants';

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface CloudflareRecoveryRuntime {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastError: string;
  noticeShown: boolean;
}

export interface MagnetValidationRuntime {
  inspectedCandidates: number;
  unverifiedCandidates: number;
  timeoutCandidates: number;
  disabled: boolean;
  disabledAt: number | null;
  cooldownUntil: number;
  disableReason: string;
  disableNoticeShown: boolean;
}

export interface MagnetValidationStats {
  validationApplied: boolean;
  inspectedCount: number;
  unverifiedCount: number;
  timeoutCount: number;
  validationSkippedReason?: string;
}

/* ------------------------------------------------------------------ */
/*  工厂                                                                */
/* ------------------------------------------------------------------ */

export function createCloudflareRecoveryRuntime(): CloudflareRecoveryRuntime {
  return { consecutiveFailures: 0, cooldownUntil: 0, lastError: '', noticeShown: false };
}

export function createMagnetValidationRuntime(): MagnetValidationRuntime {
  return {
    inspectedCandidates: 0,
    unverifiedCandidates: 0,
    timeoutCandidates: 0,
    disabled: false,
    disabledAt: null,
    cooldownUntil: 0,
    disableReason: '',
    disableNoticeShown: false
  };
}

/* ------------------------------------------------------------------ */
/*  Cloudflare 恢复链路运行时                                            */
/* ------------------------------------------------------------------ */

export function getCloudflareRecoveryDelayMs(retryDelay: number, attempt: number): number {
  const baseDelay = Math.max(retryDelay, CF_RECOVERY_MIN_BASE_DELAY_MS);
  return Math.min(CF_RECOVERY_MAX_DELAY_MS, baseDelay + attempt * CF_RECOVERY_DELAY_INCREMENT_MS);
}

export function resetCloudflareRecoveryRuntime(
  runtime: CloudflareRecoveryRuntime,
  clearCooldown = false
): void {
  runtime.consecutiveFailures = 0;
  runtime.lastError = '';
  runtime.noticeShown = false;
  if (clearCooldown) {
    runtime.cooldownUntil = 0;
  }
}

export function markCloudflareRecoveryFailure(
  runtime: CloudflareRecoveryRuntime,
  message: string,
  threshold: number,
  cooldownMs: number,
  logger?: { warn(msg: string): void }
): void {
  runtime.consecutiveFailures += 1;
  runtime.lastError = message;
  runtime.noticeShown = false;
  if (runtime.consecutiveFailures < threshold) {
    return;
  }
  runtime.cooldownUntil = Date.now() + cooldownMs;
  if (logger) {
    logger.warn(
      `Cloudflare 恢复链路连续失败 ${runtime.consecutiveFailures} 次，已进入 ${Math.ceil(cooldownMs / 1000)} 秒冷却期。原因：${message}`
    );
  }
}

export function isCloudflareRecoveryCoolingDown(
  runtime: CloudflareRecoveryRuntime,
  contextLabel: string,
  logger?: { info(msg: string): void }
): boolean {
  const remainingMs = runtime.cooldownUntil - Date.now();
  if (remainingMs <= 0) {
    if (runtime.cooldownUntil > 0) {
      runtime.cooldownUntil = 0;
      runtime.noticeShown = false;
    }
    return false;
  }
  if (!runtime.noticeShown && logger) {
    logger.info(
      `${contextLabel} 当前处于冷却期，剩余 ${Math.ceil(remainingMs / 1000)} 秒，暂时跳过 Cloudflare 恢复。`
    );
    runtime.noticeShown = true;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  快速 HTTP 磁力熔断器                                                */
/* ------------------------------------------------------------------ */

export function recordFastHttpMagnetResult(
  circuit: FastHttpMagnetCircuitState,
  success: boolean,
  reason: string,
  useCloudflareBypass: boolean,
  logger?: { warn(msg: string): void }
): void {
  if (!useCloudflareBypass) {
    return;
  }
  circuit.attempts += 1;
  if (success) {
    circuit.successes += 1;
    circuit.consecutiveFailures = 0;
    return;
  }
  circuit.failures += 1;
  circuit.consecutiveFailures += 1;
  if (circuit.disabled) {
    return;
  }
  const { attempts, successes, consecutiveFailures } = circuit;
  const successRate = attempts > 0 ? successes / attempts : 0;
  const severeFailure = isSevereFastHttpMagnetFailure(reason);
  const shouldDisable =
    (severeFailure && consecutiveFailures >= FAST_HTTP_MAGNET_SEVERE_THRESHOLD) ||
    (attempts >= FAST_HTTP_MAGNET_MIN_ATTEMPTS && successes === 0) ||
    consecutiveFailures >= FAST_HTTP_MAGNET_CONSECUTIVE_THRESHOLD ||
    (attempts >= FAST_HTTP_MAGNET_RATE_SAMPLE_MIN && successRate < FAST_HTTP_MAGNET_MIN_SUCCESS_RATE);
  if (!shouldDisable) {
    return;
  }
  circuit.disabled = true;
  circuit.disabledAt = Date.now();
  circuit.disableReason = reason;
  if (logger) {
    logger.warn(
      `快速 HTTP 磁力通道命中率过低（成功 ${successes}/${attempts}，连续失败 ${consecutiveFailures} 次），本轮已自动切换为 Cloudflare 直连模式。最后失败原因：${reason}`
    );
  }
}

export function isSevereFastHttpMagnetFailure(reason: string): boolean {
  const normalized = String(reason || '').toLowerCase();
  return (
    normalized.includes('403') ||
    normalized.includes('forbidden') ||
    normalized.includes('bad request') ||
    normalized.includes('err_bad_request')
  );
}

export function shouldBypassFastHttpMagnet(
  mode: string,
  useCloudflareBypass: boolean,
  circuitDisabled: boolean
): boolean {
  if (mode === 'cloudflare-only') {
    return true;
  }
  if (!useCloudflareBypass) {
    return false;
  }
  return circuitDisabled;
}

export function shouldRouteMagnetTaskToRecoveryQueue(
  useCloudflareBypass: boolean,
  circuitDisabled: boolean
): boolean {
  return Boolean(useCloudflareBypass && circuitDisabled);
}

/* ------------------------------------------------------------------ */
/*  磁力内容校验冷却                                                    */
/* ------------------------------------------------------------------ */

export function isMagnetValidationEnabled(runtime: MagnetValidationRuntime): boolean {
  if (!runtime.disabled) {
    return true;
  }
  if (runtime.cooldownUntil > Date.now()) {
    return false;
  }
  resetMagnetValidationCooldown(runtime);
  return true;
}

export function resetMagnetValidationCooldown(runtime: MagnetValidationRuntime): void {
  runtime.inspectedCandidates = 0;
  runtime.unverifiedCandidates = 0;
  runtime.timeoutCandidates = 0;
  runtime.disabled = false;
  runtime.disabledAt = null;
  runtime.cooldownUntil = 0;
  runtime.disableReason = '';
  runtime.disableNoticeShown = false;
}

export function logMagnetValidationDisabledNotice(
  runtime: MagnetValidationRuntime,
  logger?: { info(msg: string): void }
): void {
  if (runtime.disableNoticeShown) {
    return;
  }
  runtime.disableNoticeShown = true;
  const remainingMs = Math.max(0, runtime.cooldownUntil - Date.now());
  const remainingSeconds = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  const cooldownText = remainingSeconds > 0 ? `，约 ${remainingSeconds} 秒后自动恢复` : '';
  if (logger) {
    logger.info(
      `fetchMagnet: 磁力内容校验当前处于冷却期，暂时直接保留快速候选${cooldownText}。原因：${runtime.disableReason || '超时率过高'}`
    );
  }
}

export function recordMagnetValidationStats(
  runtime: MagnetValidationRuntime,
  title: string,
  stats: MagnetValidationStats,
  cooldownMs: number,
  logger?: { warn(msg: string): void }
): void {
  if (!stats.validationApplied || stats.inspectedCount <= 0) {
    return;
  }
  runtime.inspectedCandidates += stats.inspectedCount;
  runtime.unverifiedCandidates += stats.unverifiedCount;
  runtime.timeoutCandidates += stats.timeoutCount;
  if (runtime.disabled) {
    return;
  }
  const { inspectedCandidates, unverifiedCandidates, timeoutCandidates } = runtime;
  const timeoutRatio = inspectedCandidates > 0 ? timeoutCandidates / inspectedCandidates : 0;
  const unverifiedRatio = inspectedCandidates > 0 ? unverifiedCandidates / inspectedCandidates : 0;
  const shouldDisable = inspectedCandidates >= 8 && (timeoutRatio >= 0.6 || unverifiedRatio >= 0.75);
  if (!shouldDisable) {
    return;
  }
  const disableReason =
    stats.validationSkippedReason === 'budget-exhausted'
      ? '单片校验预算耗尽'
      : `超时/未验证比例过高（超时 ${timeoutCandidates}/${inspectedCandidates}，未验证 ${unverifiedCandidates}/${inspectedCandidates}）`;
  runtime.disabled = true;
  runtime.disabledAt = Date.now();
  runtime.cooldownUntil = Date.now() + cooldownMs;
  runtime.disableReason = disableReason;
  runtime.disableNoticeShown = false;
  if (logger) {
    logger.warn(
      `fetchMagnet: 磁力内容校验命中临时冷却，后续将先直通快速候选，${Math.ceil(cooldownMs / 1000)} 秒后自动恢复探测。当前影片：${title}；原因：${disableReason}`
    );
  }
}
