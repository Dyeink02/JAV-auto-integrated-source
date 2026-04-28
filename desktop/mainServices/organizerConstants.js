'use strict';

/**
 * organizerConstants.js
 * 视频整理服务硬编码常量集中管理。
 * organizerService.js 及其子模块共用。
 */

/** 进度报告步长（每处理 N 个文件汇报一次） */
const PROGRESS_REPORT_STEP = 25;

/** 冲突文件重命名最大尝试次数 */
const MAX_CONFLICT_RENAME_ATTEMPTS = 9999;

/** 空目录删除最大重试次数 */
const EMPTY_DIR_DELETE_MAX_RETRIES = 3;

/** 目录删除默认最大尝试次数 */
const DIR_DELETE_DEFAULT_MAX_ATTEMPTS = 4;

/** 根目录清理第一次扫描 removeDirectoryWithRetry maxAttempts */
const ROOT_CLEANUP_FIRST_SWEEP_ATTEMPTS = 5;

/** 根目录清理第二次扫描 removeDirectoryWithRetry maxAttempts */
const ROOT_CLEANUP_SECOND_SWEEP_ATTEMPTS = 6;

/** 广告风险高置信分数阈值 */
const AD_RISK_HIGH_CONFIDENCE_SCORE = 80;

/** 广告风险建议复核分数阈值（>=70 且 <80） */
const AD_RISK_REVIEW_SCORE = 70;

module.exports = {
  PROGRESS_REPORT_STEP,
  MAX_CONFLICT_RENAME_ATTEMPTS,
  EMPTY_DIR_DELETE_MAX_RETRIES,
  DIR_DELETE_DEFAULT_MAX_ATTEMPTS,
  ROOT_CLEANUP_FIRST_SWEEP_ATTEMPTS,
  ROOT_CLEANUP_SECOND_SWEEP_ATTEMPTS,
  AD_RISK_HIGH_CONFIDENCE_SCORE,
  AD_RISK_REVIEW_SCORE
};
