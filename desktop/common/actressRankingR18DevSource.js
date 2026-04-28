const cheerio = require('cheerio');

const {
  R18DEV_URL,
  absoluteUrl,
  createRankingError,
  createRankingPage,
  getCurrentJapanYearMonth,
  gotoWithReadyState,
  launchRankingBrowser
} = require('./actressRankingShared.js');

function buildRankingTitle(periodYear, periodMonth) {
  return `${periodYear}.${String(periodMonth).padStart(2, '0')} r18.dev 人気女優ランキング`;
}

function buildPeriodLabel(periodYear, periodMonth) {
  return `${periodYear}年${String(periodMonth).padStart(2, '0')}月`;
}

/**
 * Parse r18.dev actress ranking HTML.
 * r18.dev (alpha) aggregates DMM/FANZA data and shows top actress lists.
 * The site may present actress names as inline links or in table/card form.
 */
function parseR18DevRankingHtml(html, options = {}) {
  const { sourceUrl = '' } = options;
  const $ = cheerio.load(html);
  const current = getCurrentJapanYearMonth();
  let items = [];

  // ── Strategy 1: explicit ranking table ────────────────────────────────────
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    const rankText = $(cells[0]).text().trim();
    const rank = Number.parseInt(rankText.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(rank) || rank <= 0 || rank > 500) return;

    const actressLink = $(cells[1]).find('a').first();
    const actressName = actressLink.text().trim() || $(cells[1]).text().trim();
    if (!actressName) return;

    const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || R18DEV_URL);
    const imageUrl = absoluteUrl(
      $(cells[1]).find('img').first().attr('src') || '',
      sourceUrl || R18DEV_URL
    );

    items.push({ rank, actressName, profileUrl, imageUrl });
  });

  // ── Strategy 2: card / grid layout ────────────────────────────────────────
  if (items.length === 0) {
    let autoRank = 1;
    $('[class*="actress"], [class*="idol"], [class*="star"], [class*="item"], [class*="card"]').each((_, el) => {
      const rankEl = $(el).find('[class*="rank"], [class*="num"]').first();
      const rank = rankEl.length
        ? Number.parseInt(rankEl.text().trim().replace(/[^\d]/g, ''), 10)
        : autoRank;

      if (!Number.isFinite(rank) || rank <= 0 || rank > 500) return;

      const actressLink = $(el).find('a').first();
      const actressName = actressLink.text().trim() || $(el).find('[class*="name"]').first().text().trim();
      if (!actressName) return;

      const profileUrl = absoluteUrl(actressLink.attr('href') || '', sourceUrl || R18DEV_URL);
      const imageUrl = absoluteUrl($(el).find('img').first().attr('src') || '', sourceUrl || R18DEV_URL);

      items.push({ rank, actressName, profileUrl, imageUrl });
      autoRank++;
    });
  }

  // ── Strategy 3: plain list of actress links (homepage style) ──────────────
  if (items.length === 0) {
    let autoRank = 1;
    // Find sections labeled "actress" or "top" containing links
    $('section, article, div[class*="top"], div[class*="actress"]').each((_, section) => {
      const headingText = $(section).find('h1, h2, h3, h4').first().text().toLowerCase();
      if (!headingText.includes('actress') && !headingText.includes('idol') && !headingText.includes('top') && autoRank > 1) return;

      $(section).find('a').each((_, link) => {
        const actressName = $(link).text().trim();
        if (!actressName || actressName.length < 2 || actressName.length > 30) return;
        if (/^[\u0000-\u007F]+$/.test(actressName) && actressName.includes(' ') && actressName.split(' ').length > 4) return;

        const profileUrl = absoluteUrl($(link).attr('href') || '', sourceUrl || R18DEV_URL);
        const imageUrl = absoluteUrl($(link).find('img').first().attr('src') || '', sourceUrl || R18DEV_URL);

        items.push({ rank: autoRank, actressName, profileUrl, imageUrl });
        autoRank++;
      });

      if (items.length > 0) return false; // stop after first matching section
    });
  }

  // ── Deduplicate by name (r18.dev might list same actress multiple times) ───
  const nameMap = {};
  items.forEach((item) => {
    if (!nameMap[item.actressName]) nameMap[item.actressName] = item;
  });
  items = Object.values(nameMap)
    .sort((a, b) => a.rank - b.rank)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));

  if (items.length === 0) {
    throw createRankingError('未从 r18.dev 页面解析到有效女优列表，页面结构可能已变更。', 'r18dev_parse_empty');
  }

  return {
    mode: 'monthly',
    sourceName: 'r18.dev 在线',
    sourceUrl: sourceUrl || R18DEV_URL,
    title: buildRankingTitle(current.year, current.month),
    periodLabel: buildPeriodLabel(current.year, current.month),
    periodYear: current.year,
    periodMonth: current.month,
    total: items.length,
    availableYears: [current.year],
    availableMonths: [current.month],
    fetchedAt: new Date().toISOString(),
    items
  };
}

async function fetchR18DevHtml(url, options = {}) {
  const browser = await launchRankingBrowser({ proxy: options.proxy });
  try {
    const page = await createRankingPage(browser, {
      acceptLanguage: 'en-US,en;q=0.9,ja;q=0.8,zh-CN;q=0.7'
    });

    await gotoWithReadyState(page, url, {
      primaryWaitUntil: 'networkidle2',
      fallbackWaitUntil: 'load',
      timeoutMs: 60000,
      settleMs: 2000
    });

    await page
      .waitForFunction(() => document.body && document.body.innerText.trim().length > 100, { timeout: 15000 })
      .catch(() => {});

    return await page.content();
  } finally {
    await browser.close();
  }
}

async function fetchR18DevRanking(options = {}) {
  const html = await fetchR18DevHtml(R18DEV_URL, options);
  return parseR18DevRankingHtml(html, { sourceUrl: R18DEV_URL });
}

module.exports = {
  parseR18DevRankingHtml,
  fetchR18DevRanking
};
