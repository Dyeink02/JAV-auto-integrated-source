const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const AVFAN_MONTHLY_URL = 'https://av-fan.tokyo/ranking/fanza-dvd-actress-monthly.php';
const AVFAN_YEARLY_URL = 'https://av-fan.tokyo/ranking/fanza-rental-dvd-actress-top100.php';
const OFFICIAL_MONTHLY_URL = 'https://www.dmm.co.jp/mono/dvd/-/ranking/=/mode=actress/term=monthly/';
const MINNANO_MONTHLY_URL = 'https://www.minnano-av.com/ranking_actress.php?monthly';
const R18DEV_URL = 'https://r18.dev/';

const MONTHLY_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const YEARLY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 45000;
const CACHE_VERSION = 2;

const BROWSER_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Users\\%USERNAME%\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe'
];

const SOURCE_CHANNELS = Object.freeze({
  smart: {
    id: 'smart',
    label: '\u667a\u80fd\u63a8\u8350',
    cacheBucket: 'smart'
  },
  fanza: {
    id: 'fanza',
    label: 'FANZA \u5b98\u65b9',
    cacheBucket: 'official'
  },
  dmm: {
    id: 'dmm',
    label: 'DMM \u5b98\u65b9',
    cacheBucket: 'official'
  },
  avfan: {
    id: 'avfan',
    label: 'AVfan \u5728\u7ebf',
    cacheBucket: 'avfan'
  },
  minnano: {
    id: 'minnano',
    label: '\u307f\u3093\u306a\u306e\u30a2\u30d6',
    cacheBucket: 'minnano'
  },
  r18dev: {
    id: 'r18dev',
    label: 'r18.dev',
    cacheBucket: 'r18dev'
  },
  local: {
    id: 'local',
    label: '\u672c\u5730\u5386\u53f2',
    cacheBucket: 'local'
  }
});

function expandWindowsPath(filePath) {
  return String(filePath || '').replace('%USERNAME%', process.env.USERNAME || '');
}

function getBrowserExecutablePath() {
  for (const candidate of BROWSER_PATHS) {
    const resolvedPath = expandWindowsPath(candidate);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  throw new Error('\u672a\u627e\u5230\u53ef\u7528\u7684 Chrome / Edge \u6d4f\u89c8\u5668\u3002');
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, payload) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function normalizeYearList(years) {
  return Array.from(
    new Set(
      (Array.isArray(years) ? years : [])
        .map((value) => Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10))
        .filter((value) => Number.isFinite(value) && value >= 2000)
    )
  ).sort((left, right) => right - left);
}

function normalizeMonthList(months) {
  return Array.from(
    new Set(
      (Array.isArray(months) ? months : [])
        .map((value) => Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 12)
    )
  ).sort((left, right) => right - left);
}

function getMonthKey(year, month) {
  const normalizedYear = Number.parseInt(String(year || ''), 10);
  const normalizedMonth = Number.parseInt(String(month || ''), 10);
  if (!Number.isFinite(normalizedYear) || !Number.isFinite(normalizedMonth)) {
    return '';
  }

  return `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}`;
}

function getCurrentJapanYearMonth() {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value || '', 10);
  const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value || '', 10);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : new Date().getMonth() + 1
  };
}

function absoluteUrl(href, baseUrl) {
  const normalizedHref = String(href || '').trim();
  if (!normalizedHref) {
    return '';
  }

  try {
    return new URL(normalizedHref, baseUrl).toString();
  } catch {
    return normalizedHref;
  }
}

function normalizeRankingChannel(channel) {
  const normalized = String(channel || '').trim().toLowerCase();
  if (normalized && SOURCE_CHANNELS[normalized]) {
    return normalized;
  }

  return 'smart';
}

function getChannelLabel(channel) {
  return SOURCE_CHANNELS[normalizeRankingChannel(channel)].label;
}

function normalizeProxy(proxy) {
  const normalized = String(proxy || '').trim();
  return normalized || '';
}

function buildSourceCache() {
  return {
    monthlyLatestKey: '',
    monthlyByPeriod: {},
    annualByYear: {},
    availableYears: []
  };
}

function getCacheSkeleton() {
  return {
    version: CACHE_VERSION,
    sources: {
      avfan: buildSourceCache(),
      official: buildSourceCache(),
      minnano: buildSourceCache(),
      r18dev: buildSourceCache(),
      localHistory: buildSourceCache()
    }
  };
}

function normalizeSourceCache(cachePart) {
  return {
    ...buildSourceCache(),
    ...(cachePart || {}),
    monthlyByPeriod: { ...((cachePart && cachePart.monthlyByPeriod) || {}) },
    annualByYear: { ...((cachePart && cachePart.annualByYear) || {}) },
    availableYears: normalizeYearList((cachePart && cachePart.availableYears) || [])
  };
}

function normalizeCache(rawCache) {
  const skeleton = getCacheSkeleton();
  if (!rawCache || typeof rawCache !== 'object') {
    return skeleton;
  }

  if (rawCache.sources && typeof rawCache.sources === 'object') {
    return {
      version: Number.parseInt(String(rawCache.version || CACHE_VERSION), 10) || CACHE_VERSION,
      sources: {
        avfan: normalizeSourceCache(rawCache.sources.avfan),
        official: normalizeSourceCache(rawCache.sources.official),
        minnano: normalizeSourceCache(rawCache.sources.minnano),
        r18dev: normalizeSourceCache(rawCache.sources.r18dev),
        localHistory: normalizeSourceCache(rawCache.sources.localHistory)
      }
    };
  }

  const legacyAvfanCache = normalizeSourceCache({
    monthlyLatestKey: rawCache.monthlyLatestKey,
    monthlyByPeriod: rawCache.monthlyByPeriod,
    annualByYear: rawCache.annualByYear,
    availableYears: rawCache.availableYears
  });

  return {
    version: CACHE_VERSION,
    sources: {
      avfan: legacyAvfanCache,
      official: buildSourceCache(),
      localHistory: buildSourceCache()
    }
  };
}

function buildCachePayload(data) {
  return {
    cachedAt: new Date().toISOString(),
    data
  };
}

function isFresh(cacheEntry, maxAgeMs) {
  if (!cacheEntry || !cacheEntry.cachedAt) {
    return false;
  }

  const cachedAt = new Date(cacheEntry.cachedAt).getTime();
  if (!Number.isFinite(cachedAt)) {
    return false;
  }

  return Date.now() - cachedAt <= maxAgeMs;
}

function createLaunchArgs(proxy) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled'
  ];

  const normalizedProxy = normalizeProxy(proxy);
  if (normalizedProxy) {
    if (/^https?:\/\//i.test(normalizedProxy)) {
      args.push(`--proxy-server=${normalizedProxy}`);
    } else {
      args.push(`--proxy-server=http://${normalizedProxy}`);
    }
  }

  return args;
}

async function launchRankingBrowser(options = {}) {
  return puppeteer.launch({
    executablePath: getBrowserExecutablePath(),
    headless: 'new',
    args: createLaunchArgs(options.proxy)
  });
}

async function createRankingPage(browser, options = {}) {
  const page = await browser.newPage();
  const acceptLanguage =
    options.acceptLanguage || 'ja-JP,ja;q=0.9,zh-CN;q=0.8,en;q=0.7';
  const userAgent =
    options.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

  await page.setUserAgent(userAgent);
  await page.setExtraHTTPHeaders({
    'accept-language': acceptLanguage,
    'cache-control': 'no-cache',
    pragma: 'no-cache'
  });
  await page.setViewport({ width: 1440, height: 960 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const requestUrl = request.url();
    const resourceType = request.resourceType();
    const shouldBlock =
      ['image', 'font', 'media'].includes(resourceType) ||
      requestUrl.includes('googletagmanager') ||
      requestUrl.includes('google-analytics') ||
      requestUrl.includes('doubleclick') ||
      requestUrl.includes('analytics.tiktok') ||
      requestUrl.includes('px.ladsp.com') ||
      requestUrl.includes('adservice');

    if (shouldBlock) {
      request.abort();
      return;
    }

    request.continue();
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ja-JP', 'ja', 'zh-CN'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    window.chrome = window.chrome || { runtime: {} };
  });

  return page;
}

async function gotoWithReadyState(page, url, options = {}) {
  const primaryWaitUntil = options.primaryWaitUntil || 'domcontentloaded';
  const fallbackWaitUntil = options.fallbackWaitUntil || 'load';
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const settleMs = Number.isFinite(options.settleMs) ? options.settleMs : 1200;

  try {
    await page.goto(url, {
      waitUntil: primaryWaitUntil,
      timeout: timeoutMs
    });
  } catch (error) {
    await page.goto(url, {
      waitUntil: fallbackWaitUntil,
      timeout: timeoutMs
    });
  }

  if (settleMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
}

function createRankingError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  AVFAN_MONTHLY_URL,
  AVFAN_YEARLY_URL,
  OFFICIAL_MONTHLY_URL,
  MINNANO_MONTHLY_URL,
  R18DEV_URL,
  MONTHLY_CACHE_MAX_AGE_MS,
  YEARLY_CACHE_MAX_AGE_MS,
  DEFAULT_TIMEOUT_MS,
  SOURCE_CHANNELS,
  absoluteUrl,
  buildCachePayload,
  createRankingError,
  createRankingPage,
  getCacheSkeleton,
  getChannelLabel,
  getCurrentJapanYearMonth,
  getMonthKey,
  isFresh,
  launchRankingBrowser,
  normalizeCache,
  normalizeMonthList,
  normalizeProxy,
  normalizeRankingChannel,
  normalizeYearList,
  readJsonFile,
  writeJsonFile,
  gotoWithReadyState
};
