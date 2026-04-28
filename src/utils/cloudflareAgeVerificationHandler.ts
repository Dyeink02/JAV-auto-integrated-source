/**
 * cloudflareAgeVerificationHandler.ts
 * 年龄认证页面处理与年龄验证 Cookie 设置。
 * 从 cloudflareBypass.ts 提取，接收 page / config 引用，不依赖 this。
 */

import logger from '../core/logger';
import { fmtErr, logErrorBlock } from '../core/logFormatUtils';

/**
 * 处理年龄认证页面：尝试点击认证按钮，若失败则设置 Cookie 并刷新。
 */
export async function handleAgeVerification(
  page: any,
  config: { timeout?: number }
): Promise<void> {
  if (!page) return;

  try {
    logger.info('开始处理年龄认证页面');

    // 尝试查找并点击年龄认证按钮
    const ageButtonClicked = await page.evaluate(() => {
      const possibleSelectors = [
        'button[type="submit"]',
        'button:contains("Enter")',
        'button:contains("进入")',
        'button:contains("I am over 18")',
        'button:contains("我已满18岁")',
        'button:contains("Yes")',
        'button:contains("是")',
        'input[type="submit"]',
        'a:contains("Enter")',
        'a:contains("进入")',
        'a:contains("I am over 18")',
        'a:contains("我已满18岁")',
        'a:contains("Yes")',
        'a:contains("是")',
        '.btn-primary',
        '.btn-success',
        '.age-verify-btn',
        '.enter-btn',
        '.verification-btn',
        '#enter',
        '#age-verify',
        '#confirm-age',
        '#age-verification'
      ];

      // 尝试通过文本内容查找按钮
      const allButtons = Array.from(document.querySelectorAll('button, input[type="submit"], a'));
      for (const button of allButtons) {
        const text = button.textContent?.toLowerCase() || '';
        if (text.includes('enter') || text.includes('进入') || 
            text.includes('18') || text.includes('yes') || text.includes('是') ||
            text.includes('confirm') || text.includes('确认')) {
          (button as HTMLElement).click();
          return true;
        }
      }

      // 尝试通过选择器查找按钮
      for (const selector of possibleSelectors) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            (element as HTMLElement).click();
            return true;
          }
        } catch (e) {
          // 忽略无效选择器
        }
      }

      return false;
    });

    if (ageButtonClicked) {
      logger.info('已点击年龄认证按钮');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const stillOnAgeVerification = await checkAgeVerificationPage(page);

      if (stillOnAgeVerification) {
        logger.warn('点击按钮后仍在年龄认证页面，尝试其他方法');
        await setAgeCookiesViaEvaluate(page);
        await reloadWithFallback(page, config);
        logger.info('已设置年龄认证Cookie并刷新页面');
      }
    } else {
      logger.warn('未找到年龄认证按钮，尝试设置Cookie');
      await setAgeCookiesViaEvaluate(page);
      await reloadWithFallback(page, config);
      logger.info('已设置年龄认证Cookie并刷新页面');
    }

    // 再次检查是否还在年龄认证页面
    const stillOnAgeVerification = await checkAgeVerificationPage(page);

    if (stillOnAgeVerification) {
      logger.error('年龄认证处理失败，仍在认证页面');
      throw new Error('无法绕过年龄认证');
    } else {
      logger.info('年龄认证处理成功');
    }
  } catch (error) {
    logger.error(`处理年龄认证失败: ${fmtErr(error)}`);
    logErrorBlock(logger, error, 'handleAgeVerification');
    
    try {
      if (page) {
        const pageUrl = page.url();
        const pageTitle = await page.title();
        const pageContent = await page.content();
        
        logger.debug(`handleAgeVerification: 当前页面URL: ${pageUrl}`);
        logger.debug(`handleAgeVerification: 当前页面标题: ${pageTitle}`);
        logger.debug(`handleAgeVerification: 页面内容长度: ${pageContent.length}`);
        
        if (pageContent.length > 0) {
          logger.debug(`handleAgeVerification: 页面内容前1000字符: ${pageContent.substring(0, 1000)}`);
        }
        
        const currentCookies = await page.cookies();
        logger.debug(`handleAgeVerification: 当前Cookie数量: ${currentCookies.length}`);
        logger.debug(`handleAgeVerification: 当前Cookie列表: ${JSON.stringify(currentCookies, null, 2)}`);
      }
    } catch (pageInfoError) {
      logger.debug(`handleAgeVerification: 获取页面信息失败: ${fmtErr(pageInfoError)}`);
    }
    
    throw error;
  }
}

/**
 * 通过 Puppeteer setCookie API 设置年龄认证相关 Cookie。
 */
export async function setAgeVerificationCookies(page: any): Promise<void> {
  try {
    const cookies = [
      {
        name: 'age_verified',
        value: '1',
        domain: '.javbus.com',
        path: '/',
        expires: (new Date().getTime() / 1000) + (365 * 24 * 60 * 60)
      },
      {
        name: 'adult_verified',
        value: '1',
        domain: '.javbus.com',
        path: '/',
        expires: (new Date().getTime() / 1000) + (365 * 24 * 60 * 60)
      },
      {
        name: 'age_verification_passed',
        value: 'true',
        domain: '.javbus.com',
        path: '/',
        expires: (new Date().getTime() / 1000) + (365 * 24 * 60 * 60)
      },
      {
        name: 'is_adult',
        value: '1',
        domain: '.javbus.com',
        path: '/',
        expires: (new Date().getTime() / 1000) + (365 * 24 * 60 * 60)
      },
      {
        name: 'verified_adult',
        value: 'true',
        domain: '.javbus.com',
        path: '/',
        expires: (new Date().getTime() / 1000) + (365 * 24 * 60 * 60)
      }
    ];

    if (!page) {
      logger.warn('setAgeVerificationCookies: page 为 null，跳过 Cookie 设置');
      return;
    }

    for (const cookie of cookies) {
      await page.setCookie(cookie);
    }

    logger.info('已设置年龄认证相关Cookie');
  } catch (error) {
    logger.error(`设置年龄认证Cookie失败: ${fmtErr(error)}`);
    logErrorBlock(logger, error, 'setAgeVerificationCookies');
    
    try {
      if (page) {
        const pageUrl = page.url();
        const pageTitle = await page.title();
        
        logger.debug(`setAgeVerificationCookies: 当前页面URL: ${pageUrl}`);
        logger.debug(`setAgeVerificationCookies: 当前页面标题: ${pageTitle}`);
        
        const currentCookies = await page.cookies();
        logger.debug(`setAgeVerificationCookies: 当前Cookie数量: ${currentCookies.length}`);
        logger.debug(`setAgeVerificationCookies: 当前Cookie列表: ${JSON.stringify(currentCookies, null, 2)}`);
      }
    } catch (pageInfoError) {
      logger.debug(`setAgeVerificationCookies: 获取页面信息失败: ${fmtErr(pageInfoError)}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  内部辅助                                                             */
/* ------------------------------------------------------------------ */

async function checkAgeVerificationPage(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const indicators = [
      'Age Verification',
      '年龄认证',
      'age verification',
      '18+',
      'adult content',
      'adult only'
    ];
    return indicators.some(indicator =>
      document.title.includes(indicator) ||
      document.body.innerText.toLowerCase().includes(indicator.toLowerCase())
    );
  });
}

async function setAgeCookiesViaEvaluate(page: any): Promise<void> {
  await page.evaluate(() => {
    document.cookie = 'age_verified=true; path=/; max-age=31536000';
    document.cookie = 'adult_verified=true; path=/; max-age=31536000';
    document.cookie = 'age_verification=1; path=/; max-age=31536000';
    document.cookie = 'is_adult=true; path=/; max-age=31536000';
    document.cookie = 'javbus_age=1; path=/; max-age=31536000';
  });
}

async function reloadWithFallback(
  page: any,
  config: { timeout?: number }
): Promise<void> {
  const timeout = config.timeout || 45000;
  try {
    await page.reload({
      waitUntil: 'load',
      timeout: Math.max(timeout, 20000)
    });
  } catch (reloadError) {
    logger.warn(`年龄认证页面 reload 失败，尝试 domcontentloaded: ${reloadError instanceof Error ? reloadError.message : String(reloadError)}`);
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: Math.max(timeout, 20000)
    });
  }
}
