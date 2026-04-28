const cheerio = require('cheerio');
const { SERVICE_TEXT } = require('./text/serviceText.js');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_ITEMS_PER_PAGE = 30;
const REQUEST_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7'
};

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[·・･]/g, '')
    .replace(/[()（）]/g, '')
    .toLowerCase();
}

function toOrigin(input) {
  const fallback = 'https://www.javbus.com';
  try {
    return new URL(String(input || fallback)).origin;
  } catch {
    return fallback;
  }
}

function uniqOrigins(origins = []) {
  return Array.from(
    new Set(
      origins
        .map((value) => {
          try {
            return toOrigin(value);
          } catch {
            return '';
          }
        })
        .filter(Boolean)
    )
  );
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: REQUEST_HEADERS,
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseSearchStarCandidates(html, baseOrigin) {
  const $ = cheerio.load(html);

  return $('a.avatar-box[href*="/star/"]')
    .map((_, element) => {
      const anchor = $(element);
      const href = anchor.attr('href') || '';
      const titleName = anchor.find('img').first().attr('title') || '';
      const rawText = anchor.find('.mleft').first().text() || anchor.text() || '';
      const actressName = String(titleName || rawText)
        .replace(/\s+/g, ' ')
        .replace(/(有碼|无码|無碼)\s*$/u, '')
        .trim();

      if (!href || !actressName) {
        return null;
      }

      return {
        actressName,
        href: new URL(href, baseOrigin).toString()
      };
    })
    .get()
    .filter(Boolean);
}

function selectBestCandidate(candidates, actressName) {
  const rawTarget = String(actressName || '').trim();
  const normalizedTarget = normalizeName(actressName);
  const normalizedCandidates = candidates.map((candidate) => ({
    ...candidate,
    normalizedName: normalizeName(candidate.actressName)
  }));

  const rawExactMatches = normalizedCandidates.filter((candidate) => candidate.actressName.trim() === rawTarget);
  if (rawExactMatches.length === 1) {
    return { candidate: rawExactMatches[0], matchMode: 'exact' };
  }

  if (rawExactMatches.length > 1) {
    return { candidate: rawExactMatches[0], matchMode: 'exact-ambiguous' };
  }

  const exactMatches = normalizedCandidates.filter((candidate) => candidate.normalizedName === normalizedTarget);
  if (exactMatches.length === 1) {
    return { candidate: exactMatches[0], matchMode: 'exact' };
  }

  if (exactMatches.length > 1) {
    return { candidate: exactMatches[0], matchMode: 'exact-ambiguous' };
  }

  const containsMatches = normalizedCandidates.filter(
    (candidate) =>
      candidate.normalizedName.includes(normalizedTarget) || normalizedTarget.includes(candidate.normalizedName)
  );

  if (containsMatches.length === 1) {
    return { candidate: containsMatches[0], matchMode: 'contains' };
  }

  if (candidates.length === 1) {
    return { candidate: normalizedCandidates[0], matchMode: 'single' };
  }

  return {
    candidate: null,
    matchMode: candidates.length > 1 ? 'ambiguous' : 'missing'
  };
}

function parseStarPage(html) {
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const countMatch = bodyText.match(/\u5DF2\u6709\u78C1\u529B\s*(\d+)\s*\u90E8[\s\S]*?\u5168\u90E8\u5F71\u7247\s*(\d+)\s*\u90E8/u);
  const itemsPerPage = $('a.movie-box').length || DEFAULT_ITEMS_PER_PAGE;
  const actressName =
    $('.star-box .star-name').first().text().trim() ||
    $('title').first().text().split('-').map((item) => item.trim()).filter(Boolean)[0] ||
    '';

  return {
    actressName,
    itemsPerPage,
    magnetCount: countMatch ? Number.parseInt(countMatch[1], 10) : 0,
    allCount: countMatch ? Number.parseInt(countMatch[2], 10) : 0
  };
}

function getFillCount(starPage) {
  const magnetCount = Number.isFinite(starPage.magnetCount) ? starPage.magnetCount : 0;
  const allCount = Number.isFinite(starPage.allCount) ? starPage.allCount : 0;

  return magnetCount > 0 ? magnetCount : allCount;
}

async function resolveActressCrawlTarget(options = {}) {
  const actressName = String(options.actressName || '').trim();
  if (!actressName) {
    throw new Error(SERVICE_TEXT.actressLookup.missingName);
  }

  const origins = uniqOrigins([options.preferredBase, ...(options.fallbackBases || [])]);
  const lookupErrors = [];

  for (const origin of origins) {
    const searchStarUrl = `${origin}/searchstar/${encodeURIComponent(actressName)}`;

    try {
      const searchStarHtml = await fetchHtml(searchStarUrl);
      const candidates = parseSearchStarCandidates(searchStarHtml, origin);
      const selection = selectBestCandidate(candidates, actressName);

      if (!selection.candidate) {
        if (selection.matchMode === 'ambiguous') {
          throw new Error(
            SERVICE_TEXT.actressLookup.ambiguousCandidates(
              candidates.slice(0, 4).map((candidate) => candidate.actressName)
            )
          );
        }

        throw new Error(SERVICE_TEXT.actressLookup.noCandidate);
      }

      const starHtml = await fetchHtml(selection.candidate.href);
      const starPage = parseStarPage(starHtml);
      const fillCount = getFillCount(starPage);
      const totalPages =
        fillCount > 0 && starPage.itemsPerPage > 0
          ? Math.ceil(fillCount / starPage.itemsPerPage)
          : 0;

      return {
        actressName,
        resolvedActressName: starPage.actressName || selection.candidate.actressName,
        resolvedBase: selection.candidate.href,
        lookupBaseOrigin: origin,
        matchMode: selection.matchMode,
        candidateCount: candidates.length,
        candidatePreview: candidates.slice(0, 5).map((candidate) => ({
          actressName: candidate.actressName,
          href: candidate.href
        })),
        magnetCount: starPage.magnetCount,
        allCount: starPage.allCount,
        fillCount,
        preferredCount: fillCount,
        itemsPerPage: starPage.itemsPerPage || DEFAULT_ITEMS_PER_PAGE,
        totalPages
      };
    } catch (error) {
      lookupErrors.push(`${origin}：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(SERVICE_TEXT.actressLookup.resolveFailed(lookupErrors));
}

module.exports = {
  resolveActressCrawlTarget
};
