const cheerio = require('cheerio');

const {
  AVFAN_MONTHLY_URL,
  AVFAN_YEARLY_URL,
  absoluteUrl,
  createRankingError,
  createRankingPage,
  getCurrentJapanYearMonth,
  gotoWithReadyState,
  launchRankingBrowser,
  normalizeYearList
} = require('./actressRankingShared.js');

function stripControlChars(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

function decodeActressNameFromProfileUrl(profileUrl) {
  try {
    const url = new URL(profileUrl || '', AVFAN_MONTHLY_URL);
    const slug = (url.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
    return stripControlChars(decodeURIComponent(slug));
  } catch {
    return '';
  }
}

function buildRankingTitle(mode, periodYear, periodMonth) {
  if (mode === 'annual') {
    return `${periodYear} AVfan FANZA DVD Actress Annual Ranking`;
  }

  return `${periodYear}.${String(periodMonth).padStart(2, '0')} AVfan FANZA DVD Actress Monthly Ranking`;
}

function buildPeriodLabel(mode, periodYear, periodMonth) {
  if (mode === 'annual') {
    return `${periodYear}\u5e74`;
  }

  return `${periodYear}\u5e74${String(periodMonth).padStart(2, '0')}\u6708`;
}

function sanitizeRankingPayload(payload) {
  return {
    ...payload,
    title: buildRankingTitle(payload.mode, payload.periodYear, payload.periodMonth),
    periodLabel: buildPeriodLabel(payload.mode, payload.periodYear, payload.periodMonth),
    items: (payload.items || []).map((item) => {
      const decodedName = decodeActressNameFromProfileUrl(item.profileUrl);
      return {
        ...item,
        actressName: decodedName || stripControlChars(item.actressName)
      };
    })
  };
}

function parsePeriodParts(mode, title, fallbackYear) {
  const monthlyMatch = String(title || '').match(/(\d{4})\.(\d{2})/);
  if (monthlyMatch) {
    const year = Number.parseInt(monthlyMatch[1], 10);
    const month = Number.parseInt(monthlyMatch[2], 10);
    return {
      periodYear: year,
      periodMonth: month,
      periodLabel: `${year}\u5e74${String(month).padStart(2, '0')}\u6708`
    };
  }

  const yearlyMatch = String(title || '').match(/(\d{4})/);
  if (mode === 'annual' && yearlyMatch) {
    return {
      periodYear: Number.parseInt(yearlyMatch[1], 10),
      periodMonth: null,
      periodLabel: `${yearlyMatch[1]}\u5e74`
    };
  }

  if (mode === 'annual' && Number.isFinite(Number(fallbackYear))) {
    return {
      periodYear: Number(fallbackYear),
      periodMonth: null,
      periodLabel: `${fallbackYear}\u5e74`
    };
  }

  const current = getCurrentJapanYearMonth();
  return {
    periodYear: current.year,
    periodMonth: mode === 'annual' ? null : current.month,
    periodLabel:
      mode === 'annual'
        ? `${current.year}\u5e74`
        : `${current.year}\u5e74${String(current.month).padStart(2, '0')}\u6708`
  };
}

function parseAvfanRankingHtml(html, options = {}) {
  const { mode = 'monthly', sourceUrl = '', fallbackYear = null } = options;
  const $ = cheerio.load(html);
  const title =
    $('.page-title').first().text().trim() ||
    $('title').first().text().trim() ||
    (mode === 'annual' ? 'AVfan \u5e74\u5ea6\u699c\u5355' : 'AVfan \u6708\u5ea6\u699c\u5355');
  const period = parsePeriodParts(mode, title, fallbackYear);

  const items = $('.ranking-list li')
    .map((_, element) => {
      const item = $(element);
      const rank = Number.parseInt(item.find('.ranking-cnt b').first().text().trim(), 10);
      const actressLink = item.find('a[href*="/actress/"]').last();
      const actressName = actressLink.text().trim() || item.find('img').first().attr('alt') || '';
      const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || AVFAN_MONTHLY_URL);
      const imageUrl = absoluteUrl(item.find('img').first().attr('src') || '', sourceUrl || AVFAN_MONTHLY_URL);

      if (!Number.isFinite(rank) || !actressName) {
        return null;
      }

      return {
        rank,
        actressName,
        profileUrl,
        imageUrl
      };
    })
    .get()
    .filter(Boolean);

  const availableYears = normalizeYearList(
    $('.ranking-year-link a')
      .map((_, element) => $(element).text().trim())
      .get()
  );

  if (items.length === 0) {
    throw createRankingError('\u672a\u4ece AVfan \u699c\u5355\u9875\u89e3\u6790\u5230\u6709\u6548\u5185\u5bb9\u3002', 'avfan_parse_empty');
  }

  return sanitizeRankingPayload({
    mode,
    sourceName: 'AVfan \u5728\u7ebf',
    sourceUrl,
    title,
    periodLabel: period.periodLabel,
    periodYear: period.periodYear,
    periodMonth: period.periodMonth,
    total: items.length,
    availableYears,
    availableMonths: mode === 'monthly' && Number.isFinite(period.periodMonth) ? [period.periodMonth] : [],
    fetchedAt: new Date().toISOString(),
    items
  });
}

async function fetchAvfanHtml(url, options = {}) {
  const browser = await launchRankingBrowser({ proxy: options.proxy });

  try {
    const page = await createRankingPage(browser);
    await gotoWithReadyState(page, url, {
      primaryWaitUntil: 'domcontentloaded',
      fallbackWaitUntil: 'load',
      timeoutMs: 60000,
      settleMs: 1500
    });
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchLatestAvfanMonthlyRanking(options = {}) {
  const html = await fetchAvfanHtml(AVFAN_MONTHLY_URL, options);
  return parseAvfanRankingHtml(html, {
    mode: 'monthly',
    sourceUrl: AVFAN_MONTHLY_URL
  });
}

async function fetchAvfanAnnualRanking(options = {}) {
  const preferredYear = Number.parseInt(String(options.year || ''), 10) || new Date().getFullYear() - 1;
  const landingUrl = `${AVFAN_YEARLY_URL}?year=${preferredYear}`;
  const html = await fetchAvfanHtml(landingUrl, options);
  const probe = cheerio.load(html);
  const availableYears = normalizeYearList(
    probe('.ranking-year-link a')
      .map((_, element) => probe(element).text().trim())
      .get()
  );

  const initial = tryParseAnnual(html, preferredYear, availableYears);
  if (initial) {
    return initial;
  }

  const fallbackYear = availableYears.find((item) => item <= preferredYear) || availableYears[0];
  if (!fallbackYear) {
    throw createRankingError('\u672a\u627e\u5230\u53ef\u7528\u7684 AVfan \u5e74\u699c\u5e74\u4efd\u3002', 'avfan_annual_year_missing');
  }

  const fallbackUrl = `${AVFAN_YEARLY_URL}?year=${fallbackYear}`;
  const fallbackHtml = fallbackYear === preferredYear ? html : await fetchAvfanHtml(fallbackUrl, options);
  const result = parseAvfanRankingHtml(fallbackHtml, {
    mode: 'annual',
    sourceUrl: fallbackUrl,
    fallbackYear
  });
  result.availableYears = normalizeYearList([...(availableYears || []), ...(result.availableYears || [])]);
  return result;
}

function tryParseAnnual(html, preferredYear, availableYears) {
  try {
    const result = parseAvfanRankingHtml(html, {
      mode: 'annual',
      sourceUrl: `${AVFAN_YEARLY_URL}?year=${preferredYear}`,
      fallbackYear: preferredYear
    });
    result.availableYears = normalizeYearList([...(availableYears || []), ...(result.availableYears || [])]);
    return result;
  } catch {
    return null;
  }
}

module.exports = {
  parseAvfanRankingHtml,
  fetchLatestAvfanMonthlyRanking,
  fetchAvfanAnnualRanking
};
