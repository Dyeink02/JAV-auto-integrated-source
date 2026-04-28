/**
 * cloudflareChallengeSolver.ts
 * Cloudflare 5秒盾 / JS Challenge 等待与诊断。
 * 从 cloudflareBypass.ts 提取，接收 page 引用，不依赖 this。
 */

import logger from '../core/logger';

/**
 * 等待 Cloudflare 挑战页面自动完成（最长 60 秒）。
 * 挑战完成后额外等待 3 秒确保页面稳定。
 */
export async function waitForCloudflareChallenge(page: any): Promise<void> {
  if (!page) return;

  const challengeStartTime = Date.now();
  logger.debug('[CHALLENGE] 开始等待 Cloudflare 挑战完成...');

  try {
    logger.debug('[CHALLENGE] 等待挑战页面消失（最长 60 秒）...');
    await page.waitForFunction(
      () => {
        const hasBrowserVerification = document.body.innerHTML.includes('cf-browser-verification');
        const hasUnderAttack = document.body.innerHTML.includes('cf-im-under-attack');
        const hasJustAMoment = document.title.includes('Just a moment');
        const hasDdosProtection = document.title.includes('DDoS protection');

        return !hasBrowserVerification && !hasUnderAttack && !hasJustAMoment && !hasDdosProtection;
      },
      { timeout: 60000 }
    );

    const challengeTime = Date.now() - challengeStartTime;
    logger.debug(`[CHALLENGE] 挑战完成，耗时: ${challengeTime}ms`);

    logger.debug('[CHALLENGE] 额外等待 3 秒，确保页面稳定加载...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    logger.debug('[CHALLENGE] 挑战后稳定等待完成');
  } catch (error) {
    const challengeTime = Date.now() - challengeStartTime;
    logger.warn(
      `[CHALLENGE] 等待 Cloudflare 挑战超时（耗时: ${challengeTime}ms）：${
        error instanceof Error ? error.message : String(error)
      }`
    );
    logger.debug(`waitForCloudflareChallenge: 错误类型: ${error instanceof Error ? error.constructor.name : 'Unknown'}`);
    logger.debug(`waitForCloudflareChallenge: 错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);

    const diagnosis = await diagnoseChallengePage(page);
    throw new Error(`Cloudflare challenge timeout: ${diagnosis}`);
  }
}

/* ------------------------------------------------------------------ */
/*  诊断辅助                                                             */
/* ------------------------------------------------------------------ */

async function diagnoseChallengePage(page: any): Promise<string> {
  let pageTitle = '';
  let hasChallenge = false;
  let hasAgeVerification = false;
  let hasError = false;

  try {
    if (!page) return '页面实例不可用';

    const pageUrl = page.url();
    pageTitle = await page.title();
    const pageContent = await page.content();

    logger.debug(`[CHALLENGE-TIMEOUT] 当前页面 URL: ${pageUrl}`);
    logger.debug(`[CHALLENGE-TIMEOUT] 当前页面标题: ${pageTitle}`);
    logger.debug(`[CHALLENGE-TIMEOUT] 页面内容长度: ${pageContent.length}`);

    if (pageContent.length > 0) {
      logger.debug(`[CHALLENGE-TIMEOUT] 页面内容前 1500 字符:\n${pageContent.substring(0, 1500)}`);
    }

    hasChallenge =
      pageContent.includes('cf-browser-verification') ||
      pageContent.includes('cf-im-under-attack') ||
      pageContent.includes('Just a moment') ||
      pageContent.includes('DDoS protection');

    if (hasChallenge) {
      logger.debug('[CHALLENGE-TIMEOUT] 页面仍停留在 Cloudflare 挑战页');
      if (pageContent.includes('cf-browser-verification')) {
        logger.debug(`[CHALLENGE-TIMEOUT] 检测到: cf-browser-verification`);
      }
      if (pageContent.includes('cf-im-under-attack')) {
        logger.debug(`[CHALLENGE-TIMEOUT] 检测到: cf-im-under-attack`);
      }
      if (pageTitle.includes('Just a moment')) {
        logger.debug('[CHALLENGE-TIMEOUT] 检测到: Just a moment（标题）');
      }
      if (pageTitle.includes('DDoS protection')) {
        logger.debug('[CHALLENGE-TIMEOUT] 检测到: DDoS protection（标题）');
      }
    }

    hasAgeVerification =
      pageContent.includes('Age Verification') ||
      pageContent.includes('年龄认证') ||
      pageContent.includes('age verification');

    if (hasAgeVerification) {
      logger.debug(`[CHALLENGE-TIMEOUT] 检测到年龄认证页面`);
    }

    hasError =
      pageContent.includes('cf-error-details') ||
      pageContent.includes('Cloudflare Ray ID') ||
      pageContent.includes('error code:');

    if (hasError) {
      logger.debug('[CHALLENGE-TIMEOUT] 检测到 Cloudflare 错误页面');
    }

    try {
      const pageState = await page.evaluate(() => {
        return {
          readyState: document.readyState,
          title: document.title,
          url: window.location.href,
          bodyLength: document.body ? document.body.innerHTML.length : 0,
          hasJQuery: typeof (window as any).jQuery !== 'undefined',
          scriptsCount: document.scripts.length,
          imagesCount: document.images.length,
          linksCount: document.links.length
        };
      });
      logger.debug(`[CHALLENGE-TIMEOUT] 页面状态: ${JSON.stringify(pageState, null, 2)}`);
    } catch (stateError) {
      logger.debug(`[CHALLENGE-TIMEOUT] 获取页面状态失败: ${stateError instanceof Error ? stateError.message : String(stateError)}`);
    }
  } catch (pageInfoError) {
    logger.debug(`waitForCloudflareChallenge: 获取页面信息失败: ${pageInfoError instanceof Error ? pageInfoError.message : String(pageInfoError)}`);
  }

  if (hasAgeVerification) return '页面停留在年龄验证页';
  if (hasError) return '页面停留在 Cloudflare 错误页';
  if (hasChallenge) return '页面仍停留在 Cloudflare 挑战页';
  if (pageTitle) return `页面标题仍为"${pageTitle}"`;
  return '页面仍未完成验证';
}
