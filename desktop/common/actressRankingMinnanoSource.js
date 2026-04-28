const cheerio = require('cheerio');

const {
  MINNANO_MONTHLY_URL,
  absoluteUrl,
  createRankingError,
  createRankingPage,
  getCurrentJapanYearMonth,
  gotoWithReadyState,
  launchRankingBrowser
} = require('./actressRankingShared.js');

function buildRankingTitle(periodYear, periodMonth) {
  return `${periodYear}.${String(periodMonth).padStart(2, '0')} みんなのAV 女優月間ランキング`;
}

function buildPeriodLabel(periodYear, periodMonth) {
  return `${periodYear}年${String(periodMonth).padStart(2, '0')}月`;
}

/**
 * Build URL for historical monthly ranking (best-effort; falls back if site doesn't support).
 * みんなのAV uses ?monthly for current month; &m=YYYYMM for archives.
 */
function buildMinnanoHistoricalUrl(year, month) {
  const m = `${year}${String(month).padStart(2, '0')}`;
  return `${MINNANO_MONTHLY_URL}&m=${m}`;
}

/**
 * Parse みんなのAV ranking HTML with multiple selector strategies.
 * The site occasionally restructures, so we try several approaches.
 */
function parseMinnanoRankingHtml(html, options = {}) {
  const { sourceUrl = '', periodYear: overrideYear, periodMonth: overrideMonth } = options;
  const $ = cheerio.load(html);
  const current = getCurrentJapanYearMonth();
  const finalYear = Number.isFinite(overrideYear) ? overrideYear : current.year;
  const finalMonth = Number.isFinite(overrideMonth) ? overrideMonth : current.month;
  let items = [];

  // ── Strategy 1: standard table rows (tbl_type1 / ranking tables) ───────────
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    const firstCellText = $(cells[0]).text().trim();
    const rank = Number.parseInt(firstCellText.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(rank) || rank <= 0 || rank > 500) return;

    // Name / link is usually in cell index 1 or 2
    let actressLink = $(cells[1]).find('a[href*="/actress"]').first();
    if (!actressLink.length) actressLink = $(cells[2]).find('a[href*="/actress"]').first();
    if (!actressLink.length) actressLink = $(cells[1]).find('a').first();

    const actressName = actressLink.text().trim() || $(cells[1]).text().trim().replace(/\s+/g, ' ');
    if (!actressName) return;

    const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || MINNANO_MONTHLY_URL);
    const imageUrl = absoluteUrl(
      $(cells[1]).find('img').first().attr('src') || $(cells[0]).find('img').first().attr('src') || '',
      sourceUrl || MINNANO_MONTHLY_URL
    );

    // Works count: look for a numeric cell after the name column
    let worksCount = null;
    cells.each((ci, cell) => {
      if (ci <= 1) return;
      const match = $(cell).text().trim().match(/^(\d+)本?$/);
      if (match) worksCount = Number.parseInt(match[1], 10);
    });

    items.push({ rank, actressName, profileUrl, imageUrl, worksCount });
  });

  // ── Strategy 2: list items with rank elements ──────────────────────────────
  if (items.length === 0) {
    $('li').each((_, li) => {
      const rankEl = $(li).find('[class*="rank"], [class*="num"], .cnt').first();
      const rankText = rankEl.text().trim() || $(li).find('*').first().text().trim();
      const rank = Number.parseInt(rankText.replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(rank) || rank <= 0 || rank > 500) return;

      const actressLink = $(li).find('a[href*="/actress"]').first() || $(li).find('a').first();
      const actressName = actressLink.text().trim();
      if (!actressName) return;

      const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || MINNANO_MONTHLY_URL);
      const imageUrl = absoluteUrl($(li).find('img').first().attr('src') || '', sourceUrl || MINNANO_MONTHLY_URL);

      items.push({ rank, actressName, profileUrl, imageUrl, worksCount: null });
    });
  }

  // ── Strategy 3: any element with rank number + actress link ───────────────
  if (items.length === 0) {
    $('[class*="rank"], [class*="ranking"], [class*="item"]').each((_, el) => {
      const rankText = $(el).find('[class*="num"], [class*="rank"], b, strong').first().text().trim();
      const rank = Number.parseInt(rankText.replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(rank) || rank <= 0 || rank > 500) return;

      const actressLink = $(el).find('a[href*="/actress"]').first();
      if (!actressLink.length) return;

      const actressName = actressLink.text().trim();
      if (!actressName) return;

      const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || MINNANO_MONTHLY_URL);
      const imageUrl = absoluteUrl($(el).find('img').first().attr('src') || '', sourceUrl || MINNANO_MONTHLY_URL);

      items.push({ rank, actressName, profileUrl, imageUrl, worksCount: null });
    });
  }

  // ── Deduplicate & sort ─────────────────────────────────────────────────────
  const rankMap = {};
  items.forEach((item) => {
    if (!rankMap[item.rank]) rankMap[item.rank] = item;
  });
  items = Object.values(rankMap).sort((a, b) => a.rank - b.rank);

  if (items.length === 0) {
    throw createRankingError('未从 みんなのAV 榜单页解析到有效内容，页面结构可能已变更。', 'minnano_parse_empty');
  }

  return {
    mode: 'monthly',
    sourceName: 'みんなのAV 在线',
    sourceUrl: sourceUrl || MINNANO_MONTHLY_URL,
    title: buildRankingTitle(finalYear, finalMonth),
    periodLabel: buildPeriodLabel(finalYear, finalMonth),
    periodYear: finalYear,
    periodMonth: finalMonth,
    total: items.length,
    availableYears: [finalYear],
    availableMonths: [finalMonth],
    fetchedAt: new Date().toISOString(),
    items
  };
}

async function fetchMinnanoHtml(url, options = {}) {
  const browser = await launchRankingBrowser({ proxy: options.proxy });
  try {
    const page = await createRankingPage(browser);

    await gotoWithReadyState(page, url, {
      primaryWaitUntil: 'networkidle2',
      fallbackWaitUntil: 'load',
      timeoutMs: 60000,
      settleMs: 2500
    });

    // Wait for actual ranking content to appear (defeats basic JS challenges)
    await page
      .waitForFunction(() => document.body && document.body.innerText.trim().length > 200, { timeout: 15000 })
      .catch(() => {});

    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchMinnanoMonthlyRanking(options = {}) {
  const html = await fetchMinnanoHtml(MINNANO_MONTHLY_URL, options);
  return parseMinnanoRankingHtml(html, { sourceUrl: MINNANO_MONTHLY_URL });
}

/**
 * Fetch historical monthly ranking by year/month.
 * Tries archive URL pattern first; throws if unavailable (caller should catch gracefully).
 */
async function fetchMinnanoHistoricalMonthlyRanking(year, month, options = {}) {
  const url = buildMinnanoHistoricalUrl(year, month);
  const html = await fetchMinnanoHtml(url, options);
  return parseMinnanoRankingHtml(html, {
    sourceUrl: url,
    periodYear: year,
    periodMonth: month
  });
}

module.exports = {
  parseMinnanoRankingHtml,
  fetchMinnanoMonthlyRanking,
  fetchMinnanoHistoricalMonthlyRanking
};
