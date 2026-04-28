/**
 * Cloudflare Bypass Handler
 * 使用 Puppeteer 绕过 Cloudflare 保护
 */

import puppeteer from 'puppeteer-core';
import logger from '../core/logger';
import { fmtErr, logErrorBlock } from '../core/logFormatUtils';
import fs from 'fs';
import path from 'path';
import { PuppeteerPool, PuppeteerInstance } from '../core/puppeteerPool';
import { getPuppeteerExecutablePath } from '../core/puppeteerExecutablePath';
import { waitForCloudflareChallenge } from './cloudflareChallengeSolver';
import { handleAgeVerification as handleAgeVerificationImpl, setAgeVerificationCookies as setAgeVerificationCookiesImpl } from './cloudflareAgeVerificationHandler';
import { executeAjax as executeAjaxImpl } from './cloudflareAjaxExecutor';

// 移除 stealth 插件使用，统一使用 puppeteer-core

interface CloudflareConfig {
  headless?: boolean;
  timeout?: number;
  viewport?: { width: number; height: number };
  userAgent?: string;
  proxy?: string;
  puppeteerPool?: PuppeteerPool;
}

class CloudflareBypass {
  private browser: any = null;
  private page: any = null;
  private config: CloudflareConfig;
  private puppeteerPool: PuppeteerPool | null = null;
  private currentInstance: PuppeteerInstance | null = null;

  constructor(config: CloudflareConfig = {}) {
    this.config = {
      headless: config.headless !== false, // 默认无头模式
      timeout: config.timeout || 45000, // 增加到45秒，给Cloudflare挑战更多时间
      viewport: config.viewport || { width: 1920, height: 1080 },
      userAgent: config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      proxy: config.proxy
    };
    this.puppeteerPool = config.puppeteerPool || null;
  }

  /**

   * 初始化浏览器

   */

  public async init(): Promise<void> {
    try {
      logger.info('正在初始化 Cloudflare 绕过器...');

      // 如果有共享池，使用共享池
      if (this.puppeteerPool) {
        logger.info('使用共享 Puppeteer 池');
        await this.puppeteerPool.initialize();
        return;
      }

      // 否则创建独立实例（向后兼容）
      logger.info('创建独立的 Puppeteer 实例');
      const launchOptions: any = {
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-default-apps',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-webgl',
          '--disable-3d-apis',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu'
        ]
      };

      // 在打包环境中使用系统Chrome/Chromium
      const systemChromePath = getPuppeteerExecutablePath();
      if (systemChromePath) {
        launchOptions.executablePath = systemChromePath;
        logger.info(`使用系统Chrome/Chromium: ${systemChromePath}`);
      }



      // 配置代理

      if (this.config.proxy) {

        try {

          const proxyUrl = new URL(this.config.proxy);

          launchOptions.args.push(

            `--proxy-server=${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`

          );

          logger.info(`使用代理: ${this.config.proxy}`);

          logger.debug(`代理配置详情: protocol=${proxyUrl.protocol}, hostname=${proxyUrl.hostname}, port=${proxyUrl.port}`);

        } catch (error) {

          // 尝试手动解析代理URL格式

          if (typeof this.config.proxy === 'string') {

            // 支持如 "http://127.0.0.1:10809" 或 "127.0.0.1:10809" 的格式

            let proxyMatch = this.config.proxy.match(/^https?:\/\/(.+)$/i);

            if (proxyMatch) {

              launchOptions.args.push(`--proxy-server=${proxyMatch[1]}`);

              logger.info(`使用代理 (手动解析): ${this.config.proxy}`);

              logger.debug(`代理配置详情 (手动解析): ${proxyMatch[1]}`);

            } else {

              launchOptions.args.push(`--proxy-server=${this.config.proxy}`);

              logger.info(`使用代理 (直接使用): ${this.config.proxy}`);

              logger.debug(`代理配置详情 (直接使用): ${this.config.proxy}`);

            }

          } else {

            logger.warn(`代理配置无效: ${this.config.proxy}`);

          }

        }

      }



      logger.debug(`Puppeteer 启动参数: ${JSON.stringify(launchOptions, null, 2)}`);

      this.browser = await puppeteer.launch(launchOptions);

      logger.debug(`Puppeteer 浏览器已启动，进程ID: ${(this.browser as any).process().pid}`);

      this.page = await this.browser.newPage();

      logger.debug(`Puppeteer 页面已创建`);



      // 设置视口
      await this.page.setViewport(this.config.viewport!);
      logger.debug(`页面视口已设置: ${JSON.stringify(this.config.viewport)}`);

      // 设置User-Agent
      await this.page.setUserAgent(this.config.userAgent!);
      logger.debug(`User-Agent 已设置: ${this.config.userAgent}`);

      // 设置超时
      this.page.setDefaultTimeout(this.config.timeout!);
      logger.debug(`页面超时已设置: ${this.config.timeout}ms`);

      // 设置年龄认证相关的Cookie
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      });
      logger.debug('额外HTTP头已设置');

      // 设置年龄认证相关的Cookie（在访问页面之前）
      const cookiesToSet = [
        {
          name: 'age_verified',
          value: 'true',
          domain: '.javbus.com',
          path: '/',
          expires: Date.now() + 31536000000 // 1年后过期
        },
        {
          name: 'adult_verified',
          value: 'true',
          domain: '.javbus.com',
          path: '/',
          expires: Date.now() + 31536000000
        },
        {
          name: 'age_verification',
          value: '1',
          domain: '.javbus.com',
          path: '/',
          expires: Date.now() + 31536000000
        },
        {
          name: 'is_adult',
          value: 'true',
          domain: '.javbus.com',
          path: '/',
          expires: Date.now() + 31536000000
        },
        {
          name: 'javbus_age',
          value: '1',
          domain: '.javbus.com',
          path: '/',
          expires: Date.now() + 31536000000
        }
      ];

      try {
        await this.page.setCookie(...cookiesToSet);
        logger.debug('年龄认证相关的Cookie已设置');
      } catch (error) {
        logger.warn(`设置Cookie失败: ${fmtErr(error)}`);
        // 设置Cookie失败不应该阻止程序继续运行
      }

      logger.info('Puppeteer 浏览器启动成功');

    } catch (error) {
      logger.error(`启动 Puppeteer 失败: ${fmtErr(error)}`);
      logger.error(`错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);
      
      // 记录完整的错误信息
      logger.debug(`init: 完整错误对象: ${JSON.stringify(error, null, 2)}`);
      
      // 记录系统环境信息
      try {
        logger.debug(`init: 系统平台: ${process.platform}`);
        logger.debug(`init: Node.js版本: ${process.version}`);
        logger.debug(`init: 当前工作目录: ${process.cwd()}`);
        logger.debug(`init: 内存使用: ${JSON.stringify(process.memoryUsage(), null, 2)}`);
        
        // 记录Puppeteer配置信息
        logger.debug(`init: Puppeteer配置: ${JSON.stringify(this.config, null, 2)}`);
        
        // 检查是否有其他浏览器进程
        const { execSync } = require('child_process');
        try {
          if (process.platform === 'win32') {
            const processes = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV', { encoding: 'utf8' });
            logger.debug(`init: Chrome进程列表: ${processes}`);
          } else if (process.platform === 'linux') {
            const processes = execSync('ps aux | grep chrome', { encoding: 'utf8' });
            logger.debug(`init: Chrome进程列表: ${processes}`);
          }
        } catch (processError) {
          logger.debug(`init: 获取Chrome进程列表失败: ${fmtErr(processError)}`);
        }
      } catch (envError) {
        logger.debug(`init: 获取环境信息失败: ${fmtErr(envError)}`);
      }
      
      // 清理可能已创建的资源
      try {
        if (this.page) {
          await this.page.close();
          this.page = null;
          logger.debug('init: 已清理页面资源');
        }
      } catch (pageCloseError) {
        logger.debug(`init: 清理页面资源失败: ${fmtErr(pageCloseError)}`);
      }
      
      try {
        if (this.browser) {
          await this.browser.close();
          this.browser = null;
          logger.debug('init: 已清理浏览器资源');
        }
      } catch (browserCloseError) {
        logger.debug(`init: 清理浏览器资源失败: ${fmtErr(browserCloseError)}`);
      }
      
      throw error;
    }

  }

  /**
   * 访问页面并绕过 Cloudflare
   */
  public async bypassCloudflare(url: string): Promise<string> {
    try {
      // 如果有共享池，从池中获取实例
      if (this.puppeteerPool) {
        logger.debug(`从共享池获取 Puppeteer 实例: ${url}`);
        // 简化实例获取，只传递优先级
        this.currentInstance = await this.puppeteerPool.getInstance(undefined, 1); // 高优先级
        this.page = this.currentInstance.page;

        // 验证页面是否正确获取
        if (!this.page || !this.currentInstance) {
          throw new Error('从共享池获取的页面实例为 null');
        }

        logger.debug(`成功获取 Puppeteer 实例: ${this.currentInstance.id}`);
      } else if (!this.page) {
        throw new Error('请先调用 init() 方法初始化浏览器');
      }
    } catch (error) {
      logger.error('获取 Puppeteer 实例失败:', error);
      logger.error(`错误详情: ${fmtErr(error)}`);
      throw error;
    }

    try {
      logger.info(`正在访问页面: ${url}`);
      logger.debug(`页面访问参数: waitUntil=domcontentloaded, timeout=${this.config.timeout}`);

      // 记录开始时间，用于计算实际耗时
      const pageAccessStartTime = Date.now();

      // 访问页面 - 使用 load 等待策略确保 DOM 完全加载
      logger.debug(`[TIMING] 开始导航到页面: ${new Date().toISOString()}`);
      const response = await this.page.goto(url, {
        waitUntil: 'load',
        timeout: this.config.timeout
      });
      const loadTime = Date.now() - pageAccessStartTime;
      logger.debug(`[TIMING] load 完成，耗时: ${loadTime}ms`);
      if (!response) {
        throw new Error('页面响应为空');
      }

      const status = response.status();
      const headers = response.headers();
      const totalAccessTime = Date.now() - pageAccessStartTime;
      logger.info(`页面状态码: ${status} (总耗时: ${totalAccessTime}ms)`);
      logger.debug(`页面响应头: ${JSON.stringify(headers, null, 2)}`);

      // 检查是否有 Cloudflare 挑战页面
      const hasCloudflareChallenge = await this.page.evaluate(() => {
        // 检查常见的 Cloudflare 挑战标识
        const challenges = [
          'cf-browser-verification',
          'cf-im-under-attack',
          'cf-challenge-running',
          'cloudflare-turnstile',
          'jschl_vc',
          'pass',
          'captcha-bypass'
        ];

        return challenges.some(challenge =>
          document.body.innerHTML.includes(challenge) ||
          document.title.includes('Just a moment') ||
          document.title.includes('DDoS protection') ||
          window.location.href.includes('challenge')
        );
      });

      // 检查是否有年龄认证页面
      const hasAgeVerification = await this.page.evaluate(() => {
        // 检查常见的年龄认证标识
        const ageVerificationIndicators = [
          'Age Verification',
          '年龄认证',
          'age verification',
          '18+',
          'adult content',
          'adult only'
        ];

        return ageVerificationIndicators.some(indicator =>
          document.title.includes(indicator) ||
          document.body.innerText.toLowerCase().includes(indicator.toLowerCase())
        );
      });

      logger.debug(`Cloudflare 挑战检测结果: ${hasCloudflareChallenge}`);
      logger.debug(`年龄认证检测结果: ${hasAgeVerification}`);

      if (hasCloudflareChallenge) {
        logger.info('检测到 Cloudflare 挑战，正在等待解决...');
        // 等待 Cloudflare 挑战完成
        await this.waitForCloudflareChallenge();
        logger.info('Cloudflare 挑战已解决');
      } else if (hasAgeVerification) {
        logger.info('检测到年龄认证页面，正在尝试处理...');
        // 尝试处理年龄认证
        await this.handleAgeVerification();
        logger.info('年龄认证处理完成');
      } else {
        logger.debug('未检测到 Cloudflare 挑战或年龄认证');
      }

      // 获取最终的页面内容
      const content = await this.page.content();
      logger.debug(`页面内容长度: ${content.length}`);

      // 获取当前页面的 Cookies
      const cookies = await this.page.cookies();
      const cookieString = cookies
        .map((cookie: any) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      logger.info(`获取到 ${cookies.length} 个 Cookies`);
      logger.debug(`Cookies 详情: ${JSON.stringify(cookies, null, 2)}`);

      // 如果使用共享池，释放实例回池
      if (this.puppeteerPool && this.currentInstance) {
        logger.debug(`释放 Puppeteer 实例回共享池: ${this.currentInstance.id}`);
        this.puppeteerPool.releaseInstance(this.currentInstance);
        this.currentInstance = null;
        this.page = null;
      }

      return content;
    } catch (error) {
      logger.error(`绕过 Cloudflare 失败: ${fmtErr(error)}`);
      logger.error(`错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);

      // 记录完整的错误信息
      logger.debug(`bypassCloudflare: 完整错误对象: ${JSON.stringify(error, null, 2)}`);

      // 尝试获取当前页面信息
      try {
        if (this.page) {
          const pageUrl = this.page.url();
          const pageTitle = await this.page.title();
          const pageContent = await this.page.content();

          logger.debug(`bypassCloudflare: 当前页面URL: ${pageUrl}`);
          logger.debug(`bypassCloudflare: 当前页面标题: ${pageTitle}`);
          logger.debug(`bypassCloudflare: 页面内容长度: ${pageContent.length}`);

          // 记录页面内容的前2000个字符（增加内容长度）
          if (pageContent.length > 0) {
            logger.debug(`bypassCloudflare: 页面内容前2000字符:\n${pageContent.substring(0, 2000)}`);
          }

          // 如果内容较短，记录更多内容
          if (pageContent.length < 5000 && pageContent.length > 0) {
            logger.debug(`bypassCloudflare: 完整页面内容:\n${pageContent}`);
          }

          // 检查是否有特定的错误页面
          const hasCloudflareError = pageContent.includes('cf-error-details') ||
                                     pageContent.includes('Cloudflare Ray ID') ||
                                     pageContent.includes('error code:');

          if (hasCloudflareError) {
            logger.debug(`bypassCloudflare: 检测到Cloudflare错误页面`);
          }

          // 检查是否有年龄认证页面
          const hasAgeVerification = pageContent.includes('Age Verification') ||
                                     pageContent.includes('年龄认证') ||
                                     pageContent.includes('age verification');

          if (hasAgeVerification) {
            logger.debug(`bypassCloudflare: 检测到年龄认证页面`);
          }

          // 额外检查：是否有特定的 Cloudflare 提示
          const hasJustAMoment = pageContent.includes('Just a moment') ||
                                 pageContent.includes('Please enable cookies') ||
                                 pageContent.includes('Checking your browser');
          if (hasJustAMoment) {
            logger.debug(`bypassCloudflare: 检测到Cloudflare检查提示页面`);
          }

          // 记录页面关键元素
          try {
            const pageInfo = await this.page.evaluate(() => {
              return {
                title: document.title,
                url: window.location.href,
                readyState: document.readyState,
                bodyLength: document.body ? document.body.innerHTML.length : 0,
                hasJQuery: typeof (window as any).jQuery !== 'undefined',
                scriptsCount: document.scripts.length,
                imagesCount: document.images.length,
                linksCount: document.links.length
              };
            });
            logger.debug(`bypassCloudflare: 页面详细状态: ${JSON.stringify(pageInfo, null, 2)}`);
          } catch (evalError) {
            logger.debug(`bypassCloudflare: 获取页面详细状态失败: ${fmtErr(evalError)}`);
          }
        }
      } catch (pageInfoError) {
        logger.debug(`bypassCloudflare: 获取页面信息失败: ${fmtErr(pageInfoError)}`);
      }

      // 确保在错误情况下也释放实例回池
      if (this.puppeteerPool && this.currentInstance) {
        logger.debug(`错误情况下释放 Puppeteer 实例回共享池: ${this.currentInstance.id}`);
        this.puppeteerPool.releaseInstance(this.currentInstance);
        this.currentInstance = null;
        this.page = null;
      }

      throw error;
    }
  }

  /**
   * 获取当前页面的 Cookies
   * 如果 page 为空，会自动重新获取页面实例
   */
  public async getCookies(): Promise<string> {
    if (!this.page) {
      logger.warn('getCookies: page 为空，可能需要重新获取页面实例');

      // 如果有共享池，尝试重新获取一个实例
      if (this.puppeteerPool) {
        try {
          logger.debug('getCookies: 正在从共享池重新获取页面实例...');
          this.currentInstance = await this.puppeteerPool.getInstance(undefined, 1); // 高优先级
          this.page = this.currentInstance.page;

          if (!this.page || !this.currentInstance) {
            throw new Error('从共享池重新获取页面实例失败');
          }

          logger.debug(`getCookies: 成功重新获取页面实例: ${this.currentInstance.id}`);
        } catch (poolError) {
          logger.error(`重新从共享池获取页面实例失败：${fmtErr(poolError)}`);
          throw new Error('无法获取页面实例来获取 Cookies，请确保 Puppeteer 池可用');
        }
      } else {
        throw new Error('请先调用 bypassCloudflare() 方法获取页面实例');
      }
    }

    try {
      const cookies = await this.page.cookies();

      // 记录所有获取到的cookies，用于调试
      logger.debug(`getCookies: 获取到的所有cookies:`);
      cookies.forEach((cookie: any) => {
        logger.debug(`  ${cookie.name}=${cookie.value} (domain: ${cookie.domain}, path: ${cookie.path})`);
      });

      // 确保包含年龄验证相关的cookies
      const ageVerificationCookies = ['age_verified', 'adult_verified', 'age_verification_passed', 'is_adult', 'verified_adult'];
      const hasAgeVerificationCookies = ageVerificationCookies.some(name =>
        cookies.some((cookie: any) => cookie.name === name)
      );

      if (!hasAgeVerificationCookies) {
        logger.warn('getCookies: 未找到年龄验证相关的cookies，可能影响图片下载');
        // 尝试重新设置年龄验证cookies
        await this.setAgeVerificationCookies();

        // 重新获取cookies
        const updatedCookies = await this.page.cookies();
        logger.debug(`getCookies: 重新设置后获取到的cookies数量: ${updatedCookies.length}`);

        const cookieString = updatedCookies
          .map((cookie: any) => `${cookie.name}=${cookie.value}`)
          .join('; ');

        logger.info(`获取到 ${updatedCookies.length} 个 Cookies (包含年龄验证)`);
        return cookieString;
      }

      const cookieString = cookies
        .map((cookie: any) => `${cookie.name}=${cookie.value}`)
        .join('; ');

      logger.info(`获取到 ${cookies.length} 个 Cookies`);
      return cookieString;
    } catch (error) {
      logger.error(`获取 Cookies 失败: ${fmtErr(error)}`);
      throw error;
    }
  }

  /**
   * 使用页面执行 AJAX 请求
   */
  public async executeAjax(url: string): Promise<any> {
    return executeAjaxImpl(url, this.puppeteerPool, this.config);
  }

  /**
   * 等待 Cloudflare 挑战完成
   */
  private async waitForCloudflareChallenge(): Promise<void> {
    return waitForCloudflareChallenge(this.page);
  }

  /**
   * 处理年龄认证页面
   */
  private async handleAgeVerification(): Promise<void> {
    return handleAgeVerificationImpl(this.page, this.config);
  }

  /**
   * 保存 Cookies 到文件
   */
  public async saveCookies(filename: string = 'cloudflare_cookies.json'): Promise<void> {
    if (!this.page) {
      throw new Error('请先调用 init() 方法初始化浏览器');
    }

    try {
      const cookies = await this.page.cookies();
      const cookiesFile = path.join(process.cwd(), filename);

      fs.writeFileSync(cookiesFile, JSON.stringify(cookies, null, 2));
      logger.info(`Cookies 已保存到: ${cookiesFile}`);
    } catch (error) {
      logger.error(`保存 Cookies 失败: ${fmtErr(error)}`);
      logger.error(`错误类型: ${error instanceof Error ? error.constructor.name : 'Unknown'}`);
      logger.error(`错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);
      
      // 记录完整的错误信息
      logger.debug(`saveCookies: 完整错误对象: ${JSON.stringify(error, null, 2)}`);
      
      // 记录文件路径信息
      try {
        const cookiesFile = path.join(process.cwd(), filename);
        logger.debug(`saveCookies: 尝试保存到文件路径: ${cookiesFile}`);
        logger.debug(`saveCookies: 当前工作目录: ${process.cwd()}`);
        logger.debug(`saveCookies: 文件名: ${filename}`);
        
        // 检查目录是否存在
        const dirExists = fs.existsSync(path.dirname(cookiesFile));
        logger.debug(`saveCookies: 目录是否存在: ${dirExists}`);
        
        // 尝试获取Cookie信息
        if (this.page) {
          const cookies = await this.page.cookies();
          logger.debug(`saveCookies: Cookie数量: ${cookies.length}`);
          logger.debug(`saveCookies: Cookie内容: ${JSON.stringify(cookies, null, 2)}`);
        }
      } catch (debugError) {
        logger.debug(`saveCookies: 获取调试信息失败: ${debugError instanceof Error ? debugError.message : String(debugError)}`);
      }
      
      throw error;
    }
  }

    /**
     * 设置年龄认证相关Cookie
     */
    async setAgeVerificationCookies(): Promise<void> {
        return setAgeVerificationCookiesImpl(this.page);
    }

    /**
     * 关闭浏览器
     */
    async close(): Promise<void> {
        try {
            if (this.browser) {
                logger.debug(`close: 准备关闭浏览器，当前状态: isConnected=${this.browser.isConnected()}`);
                
                // 尝试获取浏览器进程信息
                try {
                    if (this.browser.process()) {
                        logger.debug(`close: 浏览器进程PID: ${this.browser.process().pid}`);
                    }
                } catch (processError) {
                    logger.debug(`close: 获取浏览器进程信息失败: ${processError instanceof Error ? processError.message : String(processError)}`);
                }
                
                await this.browser.close();
                this.browser = null;
                this.page = null;
                logger.info('浏览器已关闭');
            } else {
                logger.debug('close: 浏览器未初始化，无需关闭');
            }
        } catch (error) {
            logger.error(`关闭浏览器失败: ${error instanceof Error ? error.message : String(error)}`);
            logger.error(`错误类型: ${error instanceof Error ? error.constructor.name : 'Unknown'}`);
            logger.error(`错误堆栈: ${error instanceof Error ? error.stack : '无堆栈信息'}`);
            
            // 记录完整的错误信息
            logger.debug(`close: 完整错误对象: ${JSON.stringify(error, null, 2)}`);
            
            // 强制清理引用
            this.browser = null;
            this.page = null;
            
            throw error;
        }
    }
}

export default CloudflareBypass;
