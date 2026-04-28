const cheerio = require('cheerio');

const {
  DEFAULT_TIMEOUT_MS,
  OFFICIAL_MONTHLY_URL,
  absoluteUrl,
  createRankingError,
  createRankingPage,
  getCurrentJapanYearMonth,
  gotoWithReadyState,
  launchRankingBrowser
} = require('./actressRankingShared.js');

function getOfficialSourceName(requestedChannel) {
  if (requestedChannel === 'dmm') {
    return 'DMM \u5b98\u65b9';
  }

  if (requestedChannel === 'fanza') {
    return 'FANZA \u5b98\u65b9';
  }

  return 'DMM/FANZA \u5b98\u65b9';
}

function buildAgePassUrl(targetUrl) {
  return `https://www.dmm.co.jp/age_check/=/declared=yes/?rurl=${encodeURIComponent(targetUrl)}`;
}

function isAgeCheckPage(pageUrl, html, title) {
  return (
    String(pageUrl || '').includes('/age_check/') ||
    String(title || '').includes('\u5e74\u9f62\u8a8d\u8a3c') ||
    String(html || '').includes('/age_check/')
  );
}

async function clickAgeConfirmationIfVisible(page) {
  const selector = 'a[href*="/age_check/=/declared=yes/"]';
  const button = await page.$(selector);
  if (!button) {
    return false;
  }

  await Promise.allSettled([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
    button.click()
  ]);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return true;
}

function parseOfficialMonthlyRankingHtml(html, options = {}) {
  const { requestedChannel = 'fanza' } = options;
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim() || '\u5b98\u65b9\u5973\u4f18\u6708\u699c';
  const current = getCurrentJapanYearMonth();

  const items = $('.area-rank table .bd-b')
    .map((_, element) => {
      const cell = $(element);
      const rank = Number.parseInt(cell.find('.rank').first().text().trim(), 10);
      const actressLink = cell.find('.data p a').first();
      const latestWorkLink = cell.find('.data a[href*="/detail/"]').first();
      const actressName = actressLink.text().trim() || cell.find('img').first().attr('alt') || '';
      const profileUrl = absoluteUrl(actressLink.attr('href') || '', OFFICIAL_MONTHLY_URL);
      const imageUrl = absoluteUrl(cell.find('img').first().attr('src') || '', OFFICIAL_MONTHLY_URL);
      const latestTitle = latestWorkLink.text().trim();
      const latestUrl = absoluteUrl(latestWorkLink.attr('href') || '', OFFICIAL_MONTHLY_URL);
      const worksCountMatch = cell.text().match(/\u5546\u54c1\u6570\s*[:\uff1a]\s*(\d+)/);
      const worksCount = worksCountMatch ? Number.parseInt(worksCountMatch[1], 10) : null;

      if (!Number.isFinite(rank) || !actressName) {
        return null;
      }

      return {
        rank,
        actressName,
        profileUrl,
        imageUrl,
        latestTitle,
        latestUrl,
        worksCount
      };
    })
    .get()
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);

  if (items.length === 0) {
    throw createRankingError(
      '\u672a\u4ece DMM/FANZA \u5b98\u65b9\u6708\u699c\u89e3\u6790\u5230\u5973\u4f18\u5217\u8868\u3002',
      'official_parse_empty'
    );
  }

  return {
    mode: 'monthly',
    sourceName: getOfficialSourceName(requestedChannel),
    sourceUrl: OFFICIAL_MONTHLY_URL,
    title,
    periodLabel: `${current.year}\u5e74${String(current.month).padStart(2, '0')}\u6708\uff08\u5b98\u65b9\u5f53\u524d\u6708\u699c\u5355\uff09`,
    periodYear: current.year,
    periodMonth: current.month,
    total: items.length,
    availableYears: [current.year],
    availableMonths: [current.month],
    fetchedAt: new Date().toISOString(),
    items
  };
}

async function fetchOfficialMonthlyActressRanking(options = {}) {
  const browser = await launchRankingBrowser({ proxy: options.proxy });

  try {
    const page = await createRankingPage(browser, {
      acceptLanguage: 'ja-JP,ja;q=0.9,zh-CN;q=0.8,en;q=0.7'
    });
    const targetUrl = OFFICIAL_MONTHLY_URL;
    const agePassUrl = buildAgePassUrl(targetUrl);

    await gotoWithReadyState(page, agePassUrl, {
      primaryWaitUntil: 'domcontentloaded',
      fallbackWaitUntil: 'domcontentloaded',
      timeoutMs: DEFAULT_TIMEOUT_MS,
      settleMs: 1500
    });

    if (String(page.url()).includes('/age_check/')) {
      await clickAgeConfirmationIfVisible(page);
    }

    if (page.url() !== targetUrl) {
      await gotoWithReadyState(page, targetUrl, {
        primaryWaitUntil: 'domcontentloaded',
        fallbackWaitUntil: 'domcontentloaded',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        settleMs: 1500
      });
    }

    await page.waitForSelector('.area-rank .rank', { timeout: 15000 }).catch(() => undefined);
    const html = await page.content();
    const pageUrl = page.url();
    const pageTitle = await page.title();

    if (String(pageUrl).includes('not-available-in-your-region')) {
      throw createRankingError(
        '\u5f53\u524d\u7ebf\u8def\u88ab DMM/FANZA \u9650\u5236\uff0c\u8bf7\u786e\u8ba4\u5df2\u5f00\u542f\u65e5\u672c\u5730\u533a\u4ee3\u7406\u6216 VPN\u3002',
        'official_region_blocked'
      );
    }

    if (isAgeCheckPage(pageUrl, html, pageTitle)) {
      throw createRankingError(
        '\u5f53\u524d\u7ebf\u8def\u672a\u901a\u8fc7 DMM/FANZA \u5e74\u9f84\u9a8c\u8bc1\uff0c\u8bf7\u786e\u8ba4\u5df2\u5f00\u542f\u65e5\u672c\u5730\u533a\u4ee3\u7406\u6216 VPN\u3002',
        'official_age_check_required'
      );
    }

    return parseOfficialMonthlyRankingHtml(html, {
      requestedChannel: options.requestedChannel
    });
  } catch (error) {
    if (error && error.code) {
      throw error;
    }

    throw createRankingError(
      '\u5b98\u65b9\u699c\u5355\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u8bf7\u786e\u8ba4\u65e5\u672c\u5730\u533a\u4ee3\u7406 / VPN \u548c\u7f51\u7edc\u8fde\u63a5\u72b6\u6001\u3002',
      'official_unavailable'
    );
  } finally {
    await browser.close();
  }
}

module.exports = {
  fetchOfficialMonthlyActressRanking,
  parseOfficialMonthlyRankingHtml
};
