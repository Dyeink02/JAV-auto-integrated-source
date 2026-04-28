/**
 * requestHandlerCookieManager.ts
 * Cloudflare 会话生命周期管理：Cookie 获取/刷新、绕过器初始化/重置、
 * Cloudflare AJAX 执行管道、Worker 槽位管理。
 * 封装为独立类，由 RequestHandler 组合持有。
 */

import type { CloudflareAjaxWorkerSlot } from './requestHandlerTypes';
import type { CloudflareRecoveryRuntime } from './requestHandlerRecoveryUtils';
import {
  COOKIE_REFRESH_INTERVAL_MS,
  COOKIE_GET_MAX_ATTEMPTS,
  CF_AJAX_MAX_ATTEMPTS
} from './crawlerConstants';
import { fmtErr, fmtErrType, fmtErrStack } from './logFormatUtils';

/* ------------------------------------------------------------------ */
/*  依赖接口                                                            */
/* ------------------------------------------------------------------ */

export interface CookieManagerDeps {
  config: any;
  requestConfig: any;
  demoProfile: any;
  puppeteerPool: any;
  logger: {
    debug(msg: string, ...args: any[]): void;
    info(msg: string, ...args: any[]): void;
    warn(msg: string, ...args: any[]): void;
    error(msg: string, ...args: any[]): void;
  };
  /** Cloudflare 恢复运行时（由 RequestHandler 持有，引用共享） */
  getRecoveryRuntime(): CloudflareRecoveryRuntime;
  /** 恢复链路函数 */
  isCloudflareRecoveryCoolingDown(label: string): boolean;
  resetCloudflareRecoveryRuntime(clearCooldown: boolean): void;
  markCloudflareRecoveryFailure(message: string): void;
  getCloudflareRecoveryDelayMs(attempt: number): number;
  /** 代理记录 */
  recordProxySuccess(latencyMs: number): void;
  recordProxyFailure(error: any, context: string): Promise<void>;
  /** Page 工具 */
  isValidCookieString(cookieString: string): boolean;
  isRecoverableAjaxError(error: any): boolean;
  /** Cloudflare 并发 */
  getCloudflareAjaxConcurrencyLimit(): number;
  acquireCloudflareAjaxSlot(limit: number): Promise<void>;
  releaseCloudflareAjaxSlot(): void;
  ensureCloudflareAjaxWorkerClients(): CloudflareAjaxWorkerSlot[];
  closeCloudflareWorkerSlots(slots: CloudflareAjaxWorkerSlot[]): Promise<void>;
  /** 普通 AJAX 回退 */
  getXMLHttpRequest(url: string, opts?: any): Promise<{ statusCode: number; body: string } | null>;
  /** 用于检测请求是否已关闭 */
  ensureRequestAvailable(): void;
}

/* ------------------------------------------------------------------ */
/*  类                                                                  */
/* ------------------------------------------------------------------ */

export class RequestHandlerCookieManager {
  cloudflareBypass: any = null;
  cloudflareCookies: string | null = null;
  lastCookieRefresh = 0;
  cookieRefreshInterval = COOKIE_REFRESH_INTERVAL_MS;
  cloudflareCookieRefreshPromise: Promise<string | null> | null = null;
  cloudflarePrewarmPromise: Promise<void> | null = null;
  cloudflareWorkerDisabled = false;
  cloudflareWorkerDisableReason = '';
  cloudflareAjaxWorkerClients: CloudflareAjaxWorkerSlot[] = [];

  private CloudflareBypassClass: any;

  constructor(private deps: CookieManagerDeps, CloudflareBypassClass: any) {
    this.CloudflareBypassClass = CloudflareBypassClass;
  }

  /* ---------- Cookie 获取 ---------- */

  async getCloudflareCookies(): Promise<string | null> {
    const { config, logger } = this.deps;
    if (!config.useCloudflareBypass) {
      logger.debug('Cloudflare 绕过未启用，跳过获取会话 Cookie');
      return null;
    }
    const currentTime = Date.now();
    if (this.cloudflareCookies && (currentTime - this.lastCookieRefresh) < this.cookieRefreshInterval) {
      logger.debug(`使用缓存的 Cloudflare Cookies（剩余有效时间：${Math.floor((this.cookieRefreshInterval - (currentTime - this.lastCookieRefresh)) / 1000 / 60)} 分钟）`);
      return this.cloudflareCookies;
    }
    if (this.deps.isCloudflareRecoveryCoolingDown('Cloudflare 会话恢复')) {
      return null;
    }
    const baseUrl = config.base || config.BASE_URL;
    const maxAttempts = COOKIE_GET_MAX_ATTEMPTS;
    let lastFailureMessage = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptStartTime = Date.now();
      if (!this.cloudflareBypass) {
        logger.debug('Cloudflare 绕过器未初始化，准备创建新会话...');
        await this.initCloudflareBypass();
      }
      if (!this.cloudflareBypass) {
        logger.warn('Cloudflare 绕过器初始化失败，无法获取会话 Cookie');
        return null;
      }
      try {
        logger.info(
          attempt === 1
            ? '正在通过 Cloudflare 绕过获取会话 Cookie...'
            : `正在重新获取 Cloudflare 会话 Cookie（第 ${attempt}/${maxAttempts} 次）...`
        );
        logger.debug(`目标URL: ${baseUrl}`);
        await this.cloudflareBypass.bypassCloudflare(baseUrl);
        logger.debug('正在从页面提取 Cloudflare Cookies...');
        const cookies = await this.cloudflareBypass.getCookies();
        if (!cookies || cookies.trim().length === 0) {
          logger.warn(`第 ${attempt} 次未获取到有效的 Cloudflare Cookies`);
        } else if (!this.deps.isValidCookieString(cookies)) {
          logger.warn(`第 ${attempt} 次获取到的 Cloudflare Cookies 校验失败`);
        } else {
          this.cloudflareCookies = cookies;
          this.lastCookieRefresh = Date.now();
          this.deps.resetCloudflareRecoveryRuntime(true);
          this.deps.recordProxySuccess(Date.now() - attemptStartTime);
          logger.info(`Cloudflare 会话恢复成功，共获取 ${cookies.split(';').length} 个 Cookie，可复用 ${this.cookieRefreshInterval / 1000 / 60} 分钟`);
          logger.debug(`获取到的 Cookies: ${cookies}`);
          return cookies;
        }
      } catch (error: any) {
        const message = fmtErr(error);
        lastFailureMessage = message;
        await this.deps.recordProxyFailure(error, 'Cloudflare 会话恢复');
        logger.warn(`获取 Cloudflare 会话失败（第 ${attempt}/${maxAttempts} 次）：${message}`);
        logger.debug(`Cloudflare 会话恢复错误堆栈: ${fmtErrStack(error)}`);
        if (!this.deps.isRecoverableAjaxError(error) && !message.toLowerCase().includes('cloudflare')) {
          return null;
        }
      }
      if (attempt < maxAttempts) {
        await this.resetCloudflareBypass(`Cloudflare 会话恢复失败，第 ${attempt} 次准备重建绕过器`);
        const recoveryDelay = this.deps.getCloudflareRecoveryDelayMs(attempt);
        logger.info(`等待 ${Math.ceil(recoveryDelay / 1000)} 秒后继续重试 Cloudflare 会话恢复。`);
        await new Promise((resolve) => setTimeout(resolve, recoveryDelay));
      }
    }
    this.deps.markCloudflareRecoveryFailure(lastFailureMessage || 'Cloudflare 会话恢复多次失败');
    if (this.deps.isCloudflareRecoveryCoolingDown('Cloudflare 会话恢复')) {
      logger.error(`Cloudflare 会话恢复多次失败，已进入冷却期，后续请求将优先回退到普通请求链路。最近错误：${this.deps.getRecoveryRuntime().lastError || '未知错误'}`);
    } else {
      logger.error('Cloudflare 会话恢复多次失败，后续请求将尝试回退到普通请求链路。');
    }
    return null;
  }

  async getCloudflareCookiesWithLane(): Promise<string | null> {
    if (!this.deps.demoProfile.enableDedicatedCloudflareLane) {
      return this.getCloudflareCookies();
    }
    if (this.cloudflareCookieRefreshPromise) {
      return this.cloudflareCookieRefreshPromise;
    }
    this.cloudflareCookieRefreshPromise = this.getCloudflareCookies().finally(() => {
      this.cloudflareCookieRefreshPromise = null;
    });
    return this.cloudflareCookieRefreshPromise;
  }

  /* ---------- 绕过器生命周期 ---------- */

  async initCloudflareBypass(): Promise<void> {
    const { config, requestConfig, logger } = this.deps;
    try {
      logger.info('正在初始化Cloudflare绕过器...');
      this.cloudflareBypass = new this.CloudflareBypassClass({
        headless: true,
        timeout: requestConfig.timeout,
        proxy: requestConfig.proxy,
        puppeteerPool: this.deps.puppeteerPool
      });
      await this.cloudflareBypass.init();
      logger.info('Cloudflare绕过器初始化成功');
      logger.info('正在设置年龄认证相关Cookie...');
      await this.cloudflareBypass.setAgeVerificationCookies();
      logger.info('年龄认证Cookie设置完成');
    } catch (error: any) {
      logger.error('Cloudflare绕过器初始化失败:', error);
      this.cloudflareBypass = null;
      throw error;
    }
  }

  async prewarmCloudflareSession(): Promise<void> {
    const { config, demoProfile, logger } = this.deps;
    if (!config.useCloudflareBypass || !demoProfile.enableCloudflarePrewarm) {
      return;
    }
    if (this.cloudflarePrewarmPromise) {
      return this.cloudflarePrewarmPromise;
    }
    this.cloudflarePrewarmPromise = (async () => {
      logger.info('RequestHandler: 开始预热 Cloudflare 快速通道...');
      const cookies = await this.getCloudflareCookiesWithLane();
      if (cookies) {
        logger.info(`RequestHandler: Cloudflare 会话预热成功，Cookie 数量 ${cookies.split(';').length}`);
      } else {
        logger.warn('RequestHandler: Cloudflare 会话预热未拿到可复用 Cookie');
      }
      if (demoProfile.enableCloudflareWorker) {
        try {
          const workerSlots = this.deps.ensureCloudflareAjaxWorkerClients();
          const workerResults = await Promise.allSettled(
            workerSlots.map((slot: CloudflareAjaxWorkerSlot) => slot.client.prewarm())
          );
          const successCount = workerResults.filter((r) => r.status === 'fulfilled').length;
          const firstCookies = (workerResults.find((r) => r.status === 'fulfilled') as any)?.value;
          if (successCount === 0) {
            const firstError = (workerResults.find((r) => r.status === 'rejected') as any)?.reason;
            throw firstError instanceof Error ? firstError : new Error('Cloudflare Worker 预热全部失败');
          }
          if (firstCookies) {
            logger.info(`RequestHandler: Cloudflare Worker 预热成功，Cookie 数量 ${firstCookies.split(';').length}`);
          }
          if (successCount > 1) {
            logger.info(`RequestHandler: Cloudflare Worker 池已预热 ${successCount} 个并发槽位`);
          }
        } catch (error: any) {
          this.disableCloudflareWorker(error);
          logger.warn(`RequestHandler: Cloudflare Worker 预热失败，将自动回退进程内通道：${fmtErr(error)}`);
        }
      }
    })().finally(() => {
      this.cloudflarePrewarmPromise = null;
    });
    return this.cloudflarePrewarmPromise;
  }

  async resetCloudflareBypass(reason: string): Promise<void> {
    this.deps.logger.warn(`准备重置 Cloudflare 绕过器：${reason}`);
    if (this.cloudflareBypass) {
      try {
        await this.cloudflareBypass.close();
      } catch (error: any) {
        this.deps.logger.warn(`关闭 Cloudflare 绕过器时出错：${fmtErr(error)}`);
      }
    }
    this.cloudflareBypass = null;
    this.cloudflareCookies = null;
    this.lastCookieRefresh = 0;
  }

  async resetTransportForProxySwitch(reason: string): Promise<void> {
    this.cloudflareCookies = null;
    this.lastCookieRefresh = 0;
    this.cloudflarePrewarmPromise = null;
    this.cloudflareCookieRefreshPromise = null;
    this.deps.resetCloudflareRecoveryRuntime(true);
    await this.deps.closeCloudflareWorkerSlots(this.cloudflareAjaxWorkerClients);
    await this.resetCloudflareBypass(reason);
  }

  /* ---------- Cloudflare AJAX 执行管道 ---------- */

  async executeAjaxWithCloudflare(url: string): Promise<string | null> {
    const runWithSelectedChannel = async (): Promise<string | null> => {
      if (this.deps.demoProfile.enableCloudflareWorker && !this.cloudflareWorkerDisabled) {
        try {
          return await this.executeAjaxWithCloudflareUsingWorker(url);
        } catch (error: any) {
          this.disableCloudflareWorker(error);
          this.deps.logger.warn(`Cloudflare Worker 通道失败，将回退到进程内通道：${fmtErr(error)}`);
        }
      }
      return this.executeAjaxWithCloudflareInProcess(url);
    };
    if (this.deps.demoProfile.enableDedicatedCloudflareLane) {
      const limit = this.deps.getCloudflareAjaxConcurrencyLimit();
      if (limit <= 1) {
        this.deps.ensureRequestAvailable();
        return runWithSelectedChannel();
      }
      await this.deps.acquireCloudflareAjaxSlot(limit);
      try {
        this.deps.ensureRequestAvailable();
        return await runWithSelectedChannel();
      } finally {
        this.deps.releaseCloudflareAjaxSlot();
      }
    }
    return runWithSelectedChannel();
  }

  private async executeAjaxWithCloudflareUsingWorker(url: string): Promise<string | null> {
    const slots = this.deps.ensureCloudflareAjaxWorkerClients();
    let leastBusy = slots[0];
    for (const slot of slots) {
      if (slot.inFlight < leastBusy.inFlight) {
        leastBusy = slot;
      }
    }
    leastBusy.inFlight += 1;
    const startedAt = Date.now();
    try {
      const result = await leastBusy.client.executeAjax(url);
      if (result) {
        this.deps.recordProxySuccess(Date.now() - startedAt);
      }
      return result;
    } catch (error: any) {
      await this.deps.recordProxyFailure(error, 'Cloudflare Worker AJAX');
      throw error;
    } finally {
      leastBusy.inFlight = Math.max(0, leastBusy.inFlight - 1);
    }
  }

  private async executeAjaxWithCloudflareInProcess(url: string): Promise<string | null> {
    const { logger } = this.deps;
    if (this.deps.isCloudflareRecoveryCoolingDown('Cloudflare AJAX 恢复')) {
      logger.warn('Cloudflare AJAX 恢复当前处于冷却期，本次直接回退到普通 AJAX 链路。');
      return this.fallbackToRegularAjax(url);
    }
    const maxAttempts = CF_AJAX_MAX_ATTEMPTS;
    let lastFailureMessage = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const cfStartTime = Date.now();
      if (!this.cloudflareBypass) {
        await this.initCloudflareBypass();
      }
      if (!this.cloudflareBypass) {
        logger.warn('Cloudflare 绕过器未初始化，无法执行 AJAX 请求');
        break;
      }
      try {
        logger.info(`正在通过 Cloudflare 会话执行 AJAX 请求（第 ${attempt}/${maxAttempts} 次）...`);
        logger.debug(`Cloudflare AJAX 请求 URL: ${url}`);
        const executeStart = Date.now();
        const result = await this.cloudflareBypass.executeAjax(url);
        const executeTime = Date.now() - executeStart;
        const totalTime = Date.now() - cfStartTime;
        if (result) {
          this.deps.resetCloudflareRecoveryRuntime(true);
          this.deps.recordProxySuccess(totalTime);
          logger.info(`Cloudflare AJAX 请求成功（耗时：${Math.round(totalTime / 1000)} 秒）`);
          logger.debug(`Cloudflare AJAX 响应长度: ${result.length}`);
          logger.debug(`Cloudflare AJAX 执行耗时: ${Math.round(executeTime / 1000)} 秒，总耗时: ${Math.round(totalTime / 1000)} 秒`);
          return result;
        }
        logger.warn(`第 ${attempt} 次 Cloudflare AJAX 返回空响应`);
      } catch (error: any) {
        const totalTime = Date.now() - cfStartTime;
        lastFailureMessage = fmtErr(error);
        await this.deps.recordProxyFailure(error, 'Cloudflare AJAX');
        logger.warn(`Cloudflare AJAX 请求失败（第 ${attempt}/${maxAttempts} 次，耗时：${Math.round(totalTime / 1000)} 秒）：${fmtErr(error)}`);
        logger.debug(`Cloudflare AJAX 错误类型: ${fmtErrType(error)}`);
        logger.debug(`Cloudflare AJAX 错误堆栈: ${fmtErrStack(error)}`);
        if (!this.deps.isRecoverableAjaxError(error) || attempt >= maxAttempts) {
          break;
        }
      }
      await this.resetCloudflareBypass(`Cloudflare AJAX 第 ${attempt} 次失败，准备重建绕过器`);
      if (attempt < maxAttempts) {
        const recoveryDelay = this.deps.getCloudflareRecoveryDelayMs(attempt);
        logger.info(`等待 ${Math.ceil(recoveryDelay / 1000)} 秒后继续重试 Cloudflare AJAX。`);
        await new Promise((resolve) => setTimeout(resolve, recoveryDelay));
      }
    }
    this.deps.markCloudflareRecoveryFailure(lastFailureMessage || 'Cloudflare AJAX 多次失败');
    if (this.deps.isCloudflareRecoveryCoolingDown('Cloudflare AJAX 恢复')) {
      this.deps.logger.warn('Cloudflare AJAX 已进入冷却期，将直接使用普通 AJAX 回退链路。');
    }
    return this.fallbackToRegularAjax(url);
  }

  private async fallbackToRegularAjax(url: string): Promise<string | null> {
    if (this.deps.demoProfile.enableFastAjaxFallback) {
      this.deps.logger.warn('Cloudflare AJAX 多次失败，快速方案不再回退到普通 AJAX 重试。');
      return null;
    }
    try {
      this.deps.logger.warn('Cloudflare AJAX 多次失败，已回退到普通 AJAX 请求。');
      const fallbackResponse = await this.deps.getXMLHttpRequest(url, { skipCloudflareCookies: true });
      return fallbackResponse?.body || null;
    } catch (fallbackError: any) {
      this.deps.logger.error(`普通 AJAX 回退请求也失败：${fmtErr(fallbackError)}`);
      return null;
    }
  }

  /* ---------- Worker 管理 ---------- */

  disableCloudflareWorker(error: any): void {
    if (this.cloudflareWorkerDisabled) {
      return;
    }
    this.cloudflareWorkerDisabled = true;
    this.cloudflareWorkerDisableReason = fmtErr(error);
    void this.deps.closeCloudflareWorkerSlots(this.cloudflareAjaxWorkerClients).catch(() => undefined);
  }

  async closeCloudflareWorkerClients(): Promise<void> {
    await this.deps.closeCloudflareWorkerSlots(this.cloudflareAjaxWorkerClients);
  }
}
