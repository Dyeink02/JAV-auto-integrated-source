/**
 * cloudflareAjaxExecutor.ts
 * 通过 Puppeteer 页面上下文执行 AJAX 请求。
 * 从 cloudflareBypass.ts 提取，接收 puppeteerPool / config，不依赖 this。
 */

import logger from '../core/logger';
import { fmtErr, fmtMs, logErrorBlock } from '../core/logFormatUtils';
import { PuppeteerPool, PuppeteerInstance } from '../core/puppeteerPool';

/**
 * 从 Puppeteer 池获取页面实例，在页面上下文中执行 AJAX GET 请求，
 * 自动处理域名不匹配的预导航，完成后释放实例回池。
 *
 * @returns 响应文本
 */
export async function executeAjax(
  url: string,
  puppeteerPool: PuppeteerPool | null,
  config: { timeout?: number }
): Promise<string> {
  const ajaxStartTime = Date.now();
  logger.debug(`executeAjax: 开始执行 AJAX 请求: ${url}`);

  let instance: PuppeteerInstance | null = null;
  let page: any = null;

  try {
    if (!puppeteerPool) {
      throw new Error('executeAjax: Puppeteer 池未初始化');
    }

    logger.debug(`executeAjax: 从池中获取页面实例用于 AJAX 请求`);
    instance = await puppeteerPool.getInstance();
    page = instance.page;
    logger.debug(`executeAjax: 成功获取页面实例 ${instance.id}`);

    logger.info(`正在执行页面内 AJAX 请求：${url}`);
    logger.debug(`executeAjax: AJAX 请求详情: withCredentials=true`);

    // 检查当前页面 URL 是否与 AJAX 请求域名匹配
    const currentUrl = page.url();
    const ajaxUrlObj = new URL(url);
    const isBrowserErrorPage =
      currentUrl.startsWith('chrome-error://') || currentUrl.startsWith('chromewebdata:');

    let currentUrlObj: URL | null = null;
    try {
      if (!isBrowserErrorPage && /^https?:/i.test(currentUrl)) {
        currentUrlObj = new URL(currentUrl);
      }
    } catch (error) {
      logger.warn(
        `executeAjax: 解析当前页面 URL 失败: ${fmtErr(error)}`
      );
    }

    const currentHostname = currentUrlObj?.hostname || 'chromewebdata';

    logger.debug(`executeAjax: 当前页面 URL: ${currentUrl}`);
    logger.debug(`executeAjax: AJAX 请求 URL: ${url}`);
    logger.debug(`executeAjax: 域名检查: 当前=${currentHostname}, AJAX=${ajaxUrlObj.hostname}`);

    if (isBrowserErrorPage || !currentUrlObj || ajaxUrlObj.hostname !== currentHostname) {
      logger.warn(`AJAX 域名不匹配，当前页面：${currentHostname}，请求域名：${ajaxUrlObj.hostname}`);
      const navigationStart = Date.now();
      logger.debug(`executeAjax: 正在导航到: ${ajaxUrlObj.protocol}//${ajaxUrlObj.hostname}/`);
      const ajaxTimeout = config.timeout || 45000;
      try {
        if (isBrowserErrorPage) {
          await page.goto('about:blank', {
            waitUntil: 'domcontentloaded',
            timeout: 5000
          }).catch(() => undefined);
        }

        await page.goto(`${ajaxUrlObj.protocol}//${ajaxUrlObj.hostname}/`, {
          waitUntil: 'domcontentloaded',
          timeout: Math.max(ajaxTimeout, 15000)
        });
      } catch (navError) {
        logger.warn(`AJAX 预导航的 domcontentloaded 阶段失败，改用 load：${fmtErr(navError)}`);
        await page.goto(`${ajaxUrlObj.protocol}//${ajaxUrlObj.hostname}/`, {
          waitUntil: 'load',
          timeout: Math.max(ajaxTimeout, 15000)
        });
      }
      const navigationTime = Date.now() - navigationStart;
      logger.debug(`executeAjax: 页面导航完成 (耗时: ${fmtMs(navigationTime)})`);

      logger.debug(`executeAjax: 等待2秒确保页面完全加载`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      logger.debug(`executeAjax: 页面稳定等待完成`);
    }

    // 在页面上下文中执行 AJAX 请求
    logger.debug(`executeAjax: 在页面上下文中执行AJAX请求`);
    const evaluateStart = Date.now();

    const result = await page.evaluate((ajaxUrl: string) => {
      return new Promise(function(resolve: any, reject: any) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', ajaxUrl, true);
        xhr.withCredentials = true;

        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.setRequestHeader('Accept', '*/*');
        xhr.setRequestHeader('Cache-Control', 'no-cache');
        xhr.setRequestHeader('Pragma', 'no-cache');

        xhr.onload = function() {
          if (xhr.status === 200) {
            resolve({
              status: xhr.status,
              statusText: xhr.statusText,
              responseText: xhr.responseText,
              headers: xhr.getAllResponseHeaders()
            });
          } else {
            reject(new Error('AJAX 请求失败: ' + xhr.status + ' ' + xhr.statusText));
          }
        };

        xhr.onerror = function() {
          reject(new Error('AJAX 网络错误'));
        };

        xhr.send();
      });
    }, url);

    const evaluateTime = Date.now() - evaluateStart;
    const ajaxResult = result as { status: number; statusText: string; responseText: string; headers: string };
    const totalTime = Date.now() - ajaxStartTime;

    logger.info(`页面内 AJAX 请求成功，状态码：${ajaxResult.status}`);
    logger.debug(`executeAjax: AJAX 响应详情: status=${ajaxResult.status}, statusText=${ajaxResult.statusText}, responseLength=${ajaxResult.responseText.length}`);
    logger.debug(`executeAjax: 执行耗时: ${fmtMs(evaluateTime)}, 总耗时: ${fmtMs(totalTime)}`);
    logger.debug(`executeAjax: AJAX 响应头: ${ajaxResult.headers}`);

    if (ajaxResult.responseText.length < 1000) {
      logger.debug(`executeAjax: AJAX 响应内容: ${ajaxResult.responseText}`);
    } else {
      logger.debug(`executeAjax: AJAX 响应内容 (前500字符): ${ajaxResult.responseText.substring(0, 500)}`);
    }

    return ajaxResult.responseText;
  } catch (error) {
    const totalTime = Date.now() - ajaxStartTime;
    logger.error(`页面内 AJAX 请求失败（耗时：${fmtMs(totalTime)}）`);
    logErrorBlock(logger, error, 'executeAjax');

    // 检查浏览器进程状态
    try {
      if (page && instance) {
        const browser = instance.browser;
        if (browser && browser.process()) {
          logger.debug(`executeAjax: 浏览器进程状态: PID=${browser.process().pid}, 是否连接=${browser.isConnected()}`);
        } else {
          logger.warn('executeAjax: 浏览器进程不可用');
        }
      } else {
        logger.warn('executeAjax: 页面实例不可用，无法检查浏览器进程状态');
      }
    } catch (processError) {
      logger.warn(`检查浏览器进程状态失败：${fmtErr(processError)}`);
    }

    // 获取页面错误信息
    if (page) {
      try {
        const pageErrors = await page.evaluate(() => {
          const errorElements = Array.from(document.querySelectorAll('body *')).filter(el =>
            el.textContent && (el.textContent.includes('error') || el.textContent.includes('Error') || el.textContent.includes('403') || el.textContent.includes('Forbidden'))
          );
          return errorElements.map(el => el.textContent).slice(0, 5);
        });
        if (pageErrors && pageErrors.length > 0) {
          logger.debug(`executeAjax: 页面错误信息: ${JSON.stringify(pageErrors, null, 2)}`);
        }
      } catch (pageError) {
        logger.debug(`executeAjax: 获取页面错误信息失败: ${fmtErr(pageError)}`);
      }

      try {
        const pageUrl = page.url();
        const pageTitle = await page.title();
        const pageContent = await page.content();

        logger.debug(`executeAjax: 当前页面URL: ${pageUrl}`);
        logger.debug(`executeAjax: 当前页面标题: ${pageTitle}`);
        logger.debug(`executeAjax: 页面内容长度: ${pageContent.length}`);

        if (pageContent.length > 0) {
          logger.debug(`executeAjax: 页面内容前1000字符: ${pageContent.substring(0, 1000)}`);
        }
      } catch (pageInfoError) {
        logger.debug(`executeAjax: 获取页面信息失败: ${fmtErr(pageInfoError)}`);
      }
    }

    throw error;
  } finally {
    if (instance && puppeteerPool) {
      logger.debug(`executeAjax: 释放页面实例 ${instance.id} 回池`);
      puppeteerPool.releaseInstance(instance);
    }
  }
}
