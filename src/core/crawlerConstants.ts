/**
 * crawlerConstants.ts
 * 爬虫核心层硬编码常量集中管理。
 * requestHandler / recoveryUtils / cookieManager / baseOriginUtils 共用。
 */

/* ------------------------------------------------------------------ */
/*  Cloudflare 恢复链路                                                  */
/* ------------------------------------------------------------------ */

/** 恢复链路连续失败多少次后进入冷却 */
export const CF_RECOVERY_FAILURE_THRESHOLD = 2;
/** 恢复链路冷却期 (5 min) */
export const CF_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
/** 恢复延迟最小基础值 (ms) */
export const CF_RECOVERY_MIN_BASE_DELAY_MS = 3000;
/** 恢复延迟上限 (ms) */
export const CF_RECOVERY_MAX_DELAY_MS = 15000;
/** 恢复延迟每次尝试增量 (ms) */
export const CF_RECOVERY_DELAY_INCREMENT_MS = 2500;

/* ------------------------------------------------------------------ */
/*  AJAX 基础源健康评分                                                   */
/* ------------------------------------------------------------------ */

/** 源冷却时间 (10 min) */
export const AJAX_BASE_ORIGIN_COOLDOWN_MS = 10 * 60 * 1000;
/** 基础源候选数量限制 */
export const BASE_ORIGIN_CANDIDATE_LIMIT = 4;
/** 优先源初始分数 */
export const ORIGIN_SCORE_PREFERRED_BASE = 112;
/** 非优先源初始分数 */
export const ORIGIN_SCORE_BASE = 100;
/** 单次成功加分 */
export const ORIGIN_SCORE_SUCCESS_BONUS = 8;
/** 单次失败扣分 */
export const ORIGIN_SCORE_FAILURE_PENALTY = 4;
/** 连续失败额外扣分 */
export const ORIGIN_SCORE_CONSECUTIVE_PENALTY = 18;
/** 延迟评分 cap (ms) */
export const ORIGIN_LATENCY_SCORE_CAP_MS = 12000;
/** 延迟评分除数 */
export const ORIGIN_LATENCY_DIVISOR = 500;
/** 优先源额外加分 */
export const ORIGIN_PREFERRED_BONUS = 14;
/** 冷却期扣分 */
export const ORIGIN_COOLDOWN_PENALTY = 240;
/** 成功新鲜度满分 */
export const ORIGIN_SUCCESS_FRESHNESS_MAX = 12;
/** 延迟评分满分 = ceil(LATENCY_CAP / DIVISOR) */
export const ORIGIN_LATENCY_SCORE_MAX = 24;

/* ------------------------------------------------------------------ */
/*  代理管理                                                             */
/* ------------------------------------------------------------------ */

/** 代理连续失败阈值 */
export const PROXY_FAILURE_THRESHOLD = 2;
/** 代理冷却时间 (30s) */
export const PROXY_COOLDOWN_MS = 30 * 1000;

/* ------------------------------------------------------------------ */
/*  磁力验证                                                             */
/* ------------------------------------------------------------------ */

/** 磁力验证冷却时间 (2 min) */
export const MAGNET_VALIDATION_COOLDOWN_MS = 2 * 60 * 1000;
/** 单次任务最多检查磁力数 */
export const MAGNET_VALIDATION_INSPECT_LIMIT = 2;
/** 磁力验证预算 (ms) */
export const MAGNET_VALIDATION_BUDGET_MS = 9000;

/* ------------------------------------------------------------------ */
/*  快速 HTTP 磁力熔断器                                                  */
/* ------------------------------------------------------------------ */

/** 严重失败连续次数阈值 */
export const FAST_HTTP_MAGNET_SEVERE_THRESHOLD = 4;
/** 通道最少尝试次数（零成功即熔断） */
export const FAST_HTTP_MAGNET_MIN_ATTEMPTS = 6;
/** 通用连续失败阈值 */
export const FAST_HTTP_MAGNET_CONSECUTIVE_THRESHOLD = 6;
/** 低成功率最少样本数 */
export const FAST_HTTP_MAGNET_RATE_SAMPLE_MIN = 20;
/** 低成功率阈值 */
export const FAST_HTTP_MAGNET_MIN_SUCCESS_RATE = 0.12;

/* ------------------------------------------------------------------ */
/*  Cookie / 会话                                                       */
/* ------------------------------------------------------------------ */

/** Cookie 刷新间隔 (30 min) */
export const COOKIE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
/** Cookie 获取最大尝试次数 */
export const COOKIE_GET_MAX_ATTEMPTS = 3;
/** Cloudflare AJAX 执行最大尝试次数 */
export const CF_AJAX_MAX_ATTEMPTS = 3;

/* ------------------------------------------------------------------ */
/*  请求 & 重试                                                          */
/* ------------------------------------------------------------------ */

/** 默认请求超时 (ms) */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
/** 默认重试次数 */
export const DEFAULT_RETRY_COUNT = 3;
/** 最小基础重试延迟 (ms) */
export const RETRY_MIN_BASE_DELAY_MS = 3000;
/** 重试指数增长上限 (ms) */
export const RETRY_MAX_EXPONENTIAL_MS = 30000;
/** 重试随机延迟上限 (ms) */
export const RETRY_RANDOM_DELAY_MAX_MS = 2000;
/** 重试指数增长因子 */
export const RETRY_EXPONENTIAL_FACTOR = 1.5;
/** 快速回退 AJAX 超时上限 (ms) */
export const FAST_FALLBACK_AJAX_TIMEOUT_MS = 12000;
/** AJAX 指数增长因子 */
export const AJAX_RETRY_EXPONENTIAL_FACTOR = 1.8;
/** AJAX 重试最大延迟 (ms) */
export const AJAX_RETRY_MAX_DELAY_MS = 25000;
/** AJAX 重试随机延迟上限 (ms) */
export const AJAX_RETRY_RANDOM_DELAY_MAX_MS = 3000;
/** AJAX 快速回退最小延迟 (ms) */
export const AJAX_FAST_FALLBACK_MIN_DELAY_MS = 1500;
/** AJAX 正常最小延迟 (ms) */
export const AJAX_NORMAL_MIN_DELAY_MS = 4000;
/** 磁力随机参数乘数 */
export const AJAX_RANDOM_FLOOR_MULTIPLIER = 1e3;
