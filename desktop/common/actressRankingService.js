const {
  MONTHLY_CACHE_MAX_AGE_MS,
  YEARLY_CACHE_MAX_AGE_MS,
  SOURCE_CHANNELS,
  buildCachePayload,
  createRankingError,
  getCacheSkeleton,
  getChannelLabel,
  getCurrentJapanYearMonth,
  getMonthKey,
  isFresh,
  normalizeCache,
  normalizeMonthList,
  normalizeProxy,
  normalizeRankingChannel,
  normalizeYearList,
  readJsonFile,
  writeJsonFile
} = require('./actressRankingShared.js');
const {
  fetchLatestAvfanMonthlyRanking,
  fetchAvfanAnnualRanking
} = require('./actressRankingAvfanSource.js');
const {
  fetchOfficialMonthlyActressRanking
} = require('./actressRankingOfficialSource.js');
const {
  mergeHistoryDirectoriesIntoCache
} = require('./actressRankingLocalHistory.js');
const {
  fetchMinnanoMonthlyRanking,
  fetchMinnanoHistoricalMonthlyRanking
} = require('./actressRankingMinnanoSource.js');
const {
  fetchR18DevRanking
} = require('./actressRankingR18DevSource.js');

const MESSAGES = {
  localCacheMissing: '\u672c\u5730\u5386\u53f2\u6682\u65e0\u53ef\u7528\u699c\u5355\u7f13\u5b58\uff0c\u8bf7\u5148\u6210\u529f\u6293\u53d6\u4e00\u6b21\u5728\u7ebf\u699c\u5355\u3002',
  localMonthlyMissing: (key) => `\u672c\u5730\u5386\u53f2\u6682\u65e0 ${key} \u7684\u6708\u699c\u7f13\u5b58\u3002`,
  localAnnualMissing: (year) => `\u672c\u5730\u5386\u53f2\u6682\u65e0 ${year}\u5e74 \u7684\u5e74\u699c\u7f13\u5b58\u3002`,
  officialMonthlyOnly: '\u5f53\u524d DMM/FANZA \u5b98\u65b9\u6e20\u9053\u4ec5\u63d0\u4f9b\u5f53\u524d\u6708\u5ea6\u5973\u4f18\u699c\u5355\u3002',
  fallbackTo: (targetName) => `\u5df2\u81ea\u52a8\u5207\u6362\u81f3 ${targetName}\u3002`,
  officialFallbackTo: (targetName) => `\u5b98\u65b9\u6e20\u9053\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u81f3 ${targetName}\u3002`,
  officialAnnualFallbackTo: (targetName) => `\u5b98\u65b9\u6e20\u9053\u6682\u4ec5\u652f\u6301\u6708\u699c\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u81f3 ${targetName}\u3002`,
  requestedMonthFallbackToCache: '\u6240\u9009\u6708\u4efd\u6682\u65f6\u65e0\u7a33\u5b9a\u5728\u7ebf\u6e90\uff0c\u5df2\u56de\u9000\u5230\u672c\u5730\u7f13\u5b58\u3002',
  smartOfficialNotice: '\u667a\u80fd\u6a21\u5f0f\u5c06\u4f18\u5148\u4f7f\u7528\u5b98\u65b9\u5f53\u524d\u6708\u699c\uff0c\u4e0d\u53ef\u7528\u65f6\u81ea\u52a8\u56de\u9000\u3002',
  avfanDirectRetryNotice:
    '\u68c0\u6d4b\u5230\u5f53\u524d\u4ee3\u7406\u65e0\u6cd5\u8bbf\u95ee AVfan\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u4e3a\u76f4\u8fde\u6a21\u5f0f\u7ee7\u7eed\u83b7\u53d6\u699c\u5355\u3002',
  historicalMonthNoData: (key) => `${key} \u5386\u53f2\u6708\u4efd\u6682\u65e0\u5728\u7ebf\u6570\u636e\u3002\u6b64\u6708\u4efd\u9700\u5728\u8be5\u6708\u671f\u95f4\u901a\u8fc7\u5237\u65b0\u7f13\u5b58\u540e\u624d\u53ef\u67e5\u770b\uff1b\u5f53\u7136\u5982\u679c\u4e4b\u524d\u5df2\u5237\u65b0\u8fc7\uff0c\u8bf7\u5207\u6362\u300c\u672c\u5730\u5386\u53f2\u300d\u6e20\u9053\u67e5\u770b\u3002`
};

const MONTHLY_HISTORY_BASE_YEAR = 2020;

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isProxyConnectionError(error) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('err_proxy_connection_failed') ||
    message.includes('proxy connection failed') ||
    message.includes('proxy') ||
    message.includes('tunnel connection failed') ||
    message.includes('socks') ||
    message.includes('econnrefused')
  );
}

function mergeNotice(...parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(' ');
}

function getSourceBucket(cache, bucketId) {
  return cache.sources[bucketId] || getCacheSkeleton().sources[bucketId];
}

function listMonthlyPeriods(cache, bucketIds) {
  const periods = [];

  bucketIds.forEach((bucketId) => {
    const bucket = getSourceBucket(cache, bucketId);
    Object.entries(bucket.monthlyByPeriod || {}).forEach(([key, entry]) => {
      const match = key.match(/^(\d{4})-(\d{2})$/);
      if (!match || !entry || !entry.data) {
        return;
      }

      periods.push({
        bucketId,
        key,
        year: Number.parseInt(match[1], 10),
        month: Number.parseInt(match[2], 10),
        cachedAt: entry.cachedAt || '',
        entry
      });
    });
  });

  return periods;
}

function listAnnualEntries(cache, bucketIds) {
  const entries = [];

  bucketIds.forEach((bucketId) => {
    const bucket = getSourceBucket(cache, bucketId);
    Object.entries(bucket.annualByYear || {}).forEach(([yearKey, entry]) => {
      const year = Number.parseInt(String(yearKey || '').replace(/[^\d]/g, ''), 10);
      if (!Number.isFinite(year) || !entry || !entry.data) {
        return;
      }

      entries.push({
        bucketId,
        year,
        cachedAt: entry.cachedAt || '',
        entry
      });
    });
  });

  return entries;
}

function getMonthlyAvailability(cache, bucketIds, selectedYear) {
  const periods = listMonthlyPeriods(cache, bucketIds);
  const cachedYears = periods.map((item) => item.year);

  // Always include current Japan year and a base range from MONTHLY_HISTORY_BASE_YEAR
  const currentJapan = getCurrentJapanYearMonth();
  const baseYears = Array.from(
    { length: Math.max(0, currentJapan.year - MONTHLY_HISTORY_BASE_YEAR + 1) },
    (_, i) => MONTHLY_HISTORY_BASE_YEAR + i
  );
  const availableYears = normalizeYearList([...cachedYears, currentJapan.year, ...baseYears]);

  const numericYear = Number.parseInt(String(selectedYear || ''), 10);
  const effectiveYear = Number.isFinite(numericYear) ? numericYear : availableYears[0];
  const cachedMonths = normalizeMonthList(
    periods.filter((item) => item.year === effectiveYear).map((item) => item.month)
  );

  // Supplement: for current year show Jan→currentMonth; for past years show all 12
  let syntheticMonths;
  if (effectiveYear === currentJapan.year) {
    syntheticMonths = Array.from({ length: currentJapan.month }, (_, i) => i + 1);
  } else if (effectiveYear < currentJapan.year) {
    syntheticMonths = Array.from({ length: 12 }, (_, i) => i + 1);
  } else {
    syntheticMonths = [];
  }
  const availableMonths = normalizeMonthList([...cachedMonths, ...syntheticMonths]);

  return { availableYears, availableMonths };
}

function getAnnualAvailability(cache, bucketIds) {
  const cachedYears = listAnnualEntries(cache, bucketIds).map((item) => item.year);
  const declaredYears = bucketIds.flatMap((bucketId) => getSourceBucket(cache, bucketId).availableYears || []);
  return normalizeYearList([...cachedYears, ...declaredYears]);
}

function resolveCachedMonthlyEntry(cache, bucketIds, year, month, options = {}) {
  const requestedKey = getMonthKey(year, month);
  const exactMatch = requestedKey
    ? listMonthlyPeriods(cache, bucketIds).find((item) => item.key === requestedKey)
    : null;
  if (exactMatch) {
    return exactMatch;
  }

  if (options.exactOnly && requestedKey) {
    return null;
  }

  const latest = listMonthlyPeriods(cache, bucketIds)
    .sort((left, right) => new Date(right.cachedAt).getTime() - new Date(left.cachedAt).getTime())[0];
  return latest || null;
}

function resolveCachedAnnualEntry(cache, bucketIds, year, options = {}) {
  const requestedYear = Number.parseInt(String(year || ''), 10);
  const annualEntries = listAnnualEntries(cache, bucketIds);

  if (Number.isFinite(requestedYear)) {
    const exact = annualEntries.find((item) => item.year === requestedYear);
    if (exact) {
      return exact;
    }

    if (options.exactOnly) {
      return null;
    }
  }

  return annualEntries.sort((left, right) => right.year - left.year)[0] || null;
}

function persistMonthly(cache, bucketId, data) {
  const bucket = getSourceBucket(cache, bucketId);
  const key = getMonthKey(data.periodYear, data.periodMonth);
  if (!key) {
    return;
  }

  bucket.monthlyLatestKey = key;
  bucket.monthlyByPeriod[key] = buildCachePayload(data);
}

function persistAnnual(cache, bucketId, data) {
  const bucket = getSourceBucket(cache, bucketId);
  const year = Number.parseInt(String(data.periodYear || ''), 10);
  if (!Number.isFinite(year)) {
    return;
  }

  bucket.annualByYear[String(year)] = buildCachePayload(data);
  bucket.availableYears = normalizeYearList([...(bucket.availableYears || []), ...(data.availableYears || []), year]);
}

function decorateMonthlyResult(params) {
  const {
    cache,
    bucketIds,
    data,
    requestedChannel,
    resolvedChannel,
    fromCache,
    stale,
    notice,
    errorMessage,
    fallbackUsed
  } = params;
  const availability = getMonthlyAvailability(cache, bucketIds, data.periodYear);

  return {
    ...data,
    sourceName:
      resolvedChannel === 'local'
        ? `${getChannelLabel('local')} · ${data.sourceName || getChannelLabel('local')}`
        : data.sourceName,
    originSourceName: data.sourceName,
    mode: 'monthly',
    requestedSource: requestedChannel,
    requestedSourceLabel: getChannelLabel(requestedChannel),
    resolvedSource: resolvedChannel,
    resolvedSourceLabel: getChannelLabel(resolvedChannel),
    availableYears: availability.availableYears,
    availableMonths: availability.availableMonths,
    fromCache: Boolean(fromCache),
    stale: Boolean(stale),
    notice: notice || undefined,
    errorMessage: errorMessage || undefined,
    fallbackUsed: Boolean(fallbackUsed)
  };
}

function decorateAnnualResult(params) {
  const {
    cache,
    bucketIds,
    data,
    requestedChannel,
    resolvedChannel,
    fromCache,
    stale,
    notice,
    errorMessage,
    fallbackUsed
  } = params;

  return {
    ...data,
    sourceName:
      resolvedChannel === 'local'
        ? `${getChannelLabel('local')} · ${data.sourceName || getChannelLabel('local')}`
        : data.sourceName,
    originSourceName: data.sourceName,
    mode: 'annual',
    requestedSource: requestedChannel,
    requestedSourceLabel: getChannelLabel(requestedChannel),
    resolvedSource: resolvedChannel,
    resolvedSourceLabel: getChannelLabel(resolvedChannel),
    availableYears: getAnnualAvailability(cache, bucketIds),
    availableMonths: [],
    fromCache: Boolean(fromCache),
    stale: Boolean(stale),
    notice: notice || undefined,
    errorMessage: errorMessage || undefined,
    fallbackUsed: Boolean(fallbackUsed)
  };
}

async function fetchAvfanWithDirectFallback(fetcher, options = {}) {
  try {
    const data = await fetcher(options);
    return {
      data,
      notice: ''
    };
  } catch (error) {
    const normalizedProxy = normalizeProxy(options.proxy);
    if (!normalizedProxy || !isProxyConnectionError(error)) {
      throw error;
    }

    const data = await fetcher({
      ...options,
      proxy: ''
    });

    return {
      data,
      notice: MESSAGES.avfanDirectRetryNotice
    };
  }
}

async function getAvfanResult(context) {
  const { mode, year, month, forceRefresh, proxy, cache, cacheFilePath, requestedChannel } = context;
  const bucketId = 'avfan';
  const bucket = getSourceBucket(cache, bucketId);
  const requestedMonthKey = getMonthKey(year, month);
  const requestedAnnualYear = Number.parseInt(String(year || ''), 10);

  if (mode === 'monthly') {
    const cached = resolveCachedMonthlyEntry(cache, [bucketId], year, month, {
      exactOnly: Boolean(requestedMonthKey)
    });
    if (!forceRefresh && cached && isFresh(cached.entry, MONTHLY_CACHE_MAX_AGE_MS)) {
      return decorateMonthlyResult({
        cache,
        bucketIds: [bucketId],
        data: cached.entry.data,
        requestedChannel,
        resolvedChannel: 'avfan',
        fromCache: true,
        stale: false
      });
    }

    try {
      const fetchResult = await fetchAvfanWithDirectFallback(fetchLatestAvfanMonthlyRanking, { proxy });
      const data = fetchResult.data;
      persistMonthly(cache, bucketId, data);
      writeJsonFile(cacheFilePath, cache);

      const requestedKey = getMonthKey(year, month);
      const latestKey = getMonthKey(data.periodYear, data.periodMonth);
      if (requestedKey && requestedKey !== latestKey) {
        const requestedCached = bucket.monthlyByPeriod?.[requestedKey];
        if (requestedCached?.data) {
          return decorateMonthlyResult({
            cache,
            bucketIds: [bucketId],
            data: requestedCached.data,
            requestedChannel,
            resolvedChannel: 'avfan',
            fromCache: true,
            stale: true,
            notice: mergeNotice(MESSAGES.requestedMonthFallbackToCache, fetchResult.notice),
            errorMessage: MESSAGES.requestedMonthFallbackToCache
          });
        }

        throw createRankingError(`AVfan \u6682\u672a\u63d0\u4f9b ${requestedKey} \u7684\u7a33\u5b9a\u5386\u53f2\u6708\u699c\u3002`, 'avfan_month_history_missing');
      }

      return decorateMonthlyResult({
        cache,
        bucketIds: [bucketId],
        data,
        requestedChannel,
        resolvedChannel: 'avfan',
        fromCache: false,
        stale: false,
        notice: fetchResult.notice
      });
    } catch (error) {
      if (cached?.entry?.data) {
        return decorateMonthlyResult({
          cache,
          bucketIds: [bucketId],
          data: cached.entry.data,
          requestedChannel,
          resolvedChannel: 'avfan',
          fromCache: true,
          stale: true,
          notice: isProxyConnectionError(error) ? MESSAGES.avfanDirectRetryNotice : undefined,
          errorMessage: getErrorMessage(error)
        });
      }

      throw error;
    }
  }

  const annualCached = resolveCachedAnnualEntry(cache, [bucketId], year, {
    exactOnly: Number.isFinite(requestedAnnualYear)
  });
  if (!forceRefresh && annualCached && isFresh(annualCached.entry, YEARLY_CACHE_MAX_AGE_MS)) {
    return decorateAnnualResult({
      cache,
      bucketIds: [bucketId],
      data: annualCached.entry.data,
      requestedChannel,
      resolvedChannel: 'avfan',
      fromCache: true,
      stale: false
    });
  }

  try {
    const fetchResult = await fetchAvfanWithDirectFallback(fetchAvfanAnnualRanking, { year, proxy });
    const data = fetchResult.data;
    persistAnnual(cache, bucketId, data);
    writeJsonFile(cacheFilePath, cache);
    return decorateAnnualResult({
      cache,
      bucketIds: [bucketId],
      data,
      requestedChannel,
      resolvedChannel: 'avfan',
      fromCache: false,
      stale: false,
      notice: fetchResult.notice
    });
  } catch (error) {
    if (annualCached?.entry?.data) {
      return decorateAnnualResult({
        cache,
        bucketIds: [bucketId],
        data: annualCached.entry.data,
        requestedChannel,
        resolvedChannel: 'avfan',
        fromCache: true,
        stale: true,
        notice: isProxyConnectionError(error) ? MESSAGES.avfanDirectRetryNotice : undefined,
        errorMessage: getErrorMessage(error)
      });
    }

    throw error;
  }
}

async function getOfficialResult(context) {
  const { mode, year, month, forceRefresh, proxy, cache, cacheFilePath, requestedChannel } = context;
  const bucketId = 'official';
  const effectiveRequestedChannel = requestedChannel === 'smart' ? 'fanza' : requestedChannel;
  const cached = resolveCachedMonthlyEntry(cache, [bucketId], year, month, {
    exactOnly: Boolean(getMonthKey(year, month))
  });

  if (mode !== 'monthly') {
    throw createRankingError(MESSAGES.officialMonthlyOnly, 'official_annual_unsupported');
  }

  if (!forceRefresh && cached && isFresh(cached.entry, MONTHLY_CACHE_MAX_AGE_MS)) {
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data: cached.entry.data,
      requestedChannel,
      resolvedChannel: effectiveRequestedChannel,
      fromCache: true,
      stale: false
    });
  }

  try {
    const data = await fetchOfficialMonthlyActressRanking({
      proxy,
      requestedChannel: effectiveRequestedChannel
    });
    persistMonthly(cache, bucketId, data);
    writeJsonFile(cacheFilePath, cache);
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data,
      requestedChannel,
      resolvedChannel: effectiveRequestedChannel,
      fromCache: false,
      stale: false
    });
  } catch (error) {
    if (cached?.entry?.data) {
      return decorateMonthlyResult({
        cache,
        bucketIds: [bucketId],
        data: cached.entry.data,
        requestedChannel,
        resolvedChannel: effectiveRequestedChannel,
        fromCache: true,
        stale: true,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }

    throw error;
  }
}

function getLocalResult(context) {
  const { mode, year, month, cache, requestedChannel } = context;
  const monthlyBuckets = ['localHistory', 'official', 'avfan', 'minnano', 'r18dev'];
  const annualBuckets = ['localHistory', 'avfan'];

  if (mode === 'monthly') {
    const requestedKey = getMonthKey(year, month);
    const cached =
      resolveCachedMonthlyEntry(cache, monthlyBuckets, year, month, {
        exactOnly: Boolean(requestedKey)
      }) || (requestedKey ? null : resolveCachedMonthlyEntry(cache, monthlyBuckets, year, month));

    if (!cached?.entry?.data) {
      if (requestedKey) {
        throw createRankingError(MESSAGES.localMonthlyMissing(requestedKey), 'local_month_missing');
      }
      throw createRankingError(MESSAGES.localCacheMissing, 'local_cache_missing');
    }

    return decorateMonthlyResult({
      cache,
      bucketIds: monthlyBuckets,
      data: cached.entry.data,
      requestedChannel,
      resolvedChannel: 'local',
      fromCache: true,
      stale: true,
      notice:
        cached.bucketId === 'localHistory'
          ? '本地历史当前优先展示你手动写入或导入的榜单。'
          : cached.bucketId === 'official'
            ? '本地历史当前优先展示最近一次官方月榜缓存。'
            : '本地历史当前优先展示最近一次 AVfan 缓存。'
    });
  }

  const requestedYear = Number.parseInt(String(year || ''), 10);
  const cached =
    resolveCachedAnnualEntry(cache, annualBuckets, year, {
      exactOnly: Number.isFinite(requestedYear)
    }) || (Number.isFinite(requestedYear) ? null : resolveCachedAnnualEntry(cache, annualBuckets, year));

  if (!cached?.entry?.data) {
    if (Number.isFinite(requestedYear)) {
      throw createRankingError(MESSAGES.localAnnualMissing(requestedYear), 'local_annual_missing');
    }
    throw createRankingError(MESSAGES.localCacheMissing, 'local_cache_missing');
  }

  return decorateAnnualResult({
    cache,
    bucketIds: annualBuckets,
    data: cached.entry.data,
    requestedChannel,
    resolvedChannel: 'local',
    fromCache: true,
    stale: true,
    notice:
      cached.bucketId === 'localHistory'
        ? '本次优先展示你手动写入或导入的本地历史榜单。'
        : '\u672c\u6b21\u4ec5\u4f7f\u7528\u672c\u5730\u5386\u53f2\u699c\u5355\u7f13\u5b58\u3002'
  });
}

async function getMinnanoResult(context) {
  const { mode, year, month, forceRefresh, proxy, cache, cacheFilePath, requestedChannel } = context;
  const bucketId = 'minnano';

  if (mode !== 'monthly') {
    throw createRankingError('みんなのAV 渠道仅支持月度榜单。', 'minnano_annual_unsupported');
  }

  const currentJapan = getCurrentJapanYearMonth();
  const numericYear = Number.parseInt(String(year || ''), 10);
  const numericMonth = Number.parseInt(String(month || ''), 10);
  const isHistorical =
    Number.isFinite(numericYear) &&
    Number.isFinite(numericMonth) &&
    (numericYear < currentJapan.year ||
      (numericYear === currentJapan.year && numericMonth < currentJapan.month));

  const cached = resolveCachedMonthlyEntry(cache, [bucketId], year, month, {
    exactOnly: Boolean(getMonthKey(year, month))
  });

  if (!forceRefresh && cached && isFresh(cached.entry, MONTHLY_CACHE_MAX_AGE_MS)) {
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data: cached.entry.data,
      requestedChannel,
      resolvedChannel: 'minnano',
      fromCache: true,
      stale: false
    });
  }

  try {
    const data = isHistorical
      ? await fetchMinnanoHistoricalMonthlyRanking(numericYear, numericMonth, { proxy })
      : await fetchMinnanoMonthlyRanking({ proxy });
    persistMonthly(cache, bucketId, data);
    writeJsonFile(cacheFilePath, cache);
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data,
      requestedChannel,
      resolvedChannel: 'minnano',
      fromCache: false,
      stale: false
    });
  } catch (error) {
    if (cached?.entry?.data) {
      return decorateMonthlyResult({
        cache,
        bucketIds: [bucketId],
        data: cached.entry.data,
        requestedChannel,
        resolvedChannel: 'minnano',
        fromCache: true,
        stale: true,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

async function getR18DevResult(context) {
  const { mode, year, month, forceRefresh, proxy, cache, cacheFilePath, requestedChannel } = context;
  const bucketId = 'r18dev';

  if (mode !== 'monthly') {
    throw createRankingError('r18.dev 渠道仅支持月度榜单。', 'r18dev_annual_unsupported');
  }

  const cached = resolveCachedMonthlyEntry(cache, [bucketId], year, month, {
    exactOnly: Boolean(getMonthKey(year, month))
  });

  if (!forceRefresh && cached && isFresh(cached.entry, MONTHLY_CACHE_MAX_AGE_MS)) {
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data: cached.entry.data,
      requestedChannel,
      resolvedChannel: 'r18dev',
      fromCache: true,
      stale: false
    });
  }

  try {
    const data = await fetchR18DevRanking({ proxy });
    persistMonthly(cache, bucketId, data);
    writeJsonFile(cacheFilePath, cache);
    return decorateMonthlyResult({
      cache,
      bucketIds: [bucketId],
      data,
      requestedChannel,
      resolvedChannel: 'r18dev',
      fromCache: false,
      stale: false
    });
  } catch (error) {
    if (cached?.entry?.data) {
      return decorateMonthlyResult({
        cache,
        bucketIds: [bucketId],
        data: cached.entry.data,
        requestedChannel,
        resolvedChannel: 'r18dev',
        fromCache: true,
        stale: true,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}


function buildSourcePlan(requestedChannel, mode) {
  if (requestedChannel === 'local') {
    return ['local'];
  }

  if (requestedChannel === 'minnano') {
    return ['minnano', 'local'];
  }

  if (requestedChannel === 'r18dev') {
    return ['r18dev', 'local'];
  }

  if (requestedChannel === 'avfan') {
    return ['avfan', 'local'];
  }

  if (requestedChannel === 'fanza' || requestedChannel === 'dmm') {
    if (mode === 'annual') {
      return ['avfan', 'local'];
    }
    return ['official', 'avfan', 'minnano', 'local'];
  }

  // smart: official → avfan → minnano → r18dev → local
  return mode === 'monthly'
    ? ['official', 'avfan', 'minnano', 'r18dev', 'local']
    : ['avfan', 'local'];
}

function enrichFallbackNotice(requestedChannel, attemptedSource, result) {
  if (requestedChannel === 'smart' && attemptedSource === 'official') {
    return mergeNotice(MESSAGES.officialFallbackTo(result.resolvedSourceLabel || result.sourceName), result.notice);
  }

  if ((requestedChannel === 'fanza' || requestedChannel === 'dmm') && attemptedSource === 'official') {
    return mergeNotice(MESSAGES.officialFallbackTo(result.resolvedSourceLabel || result.sourceName), result.notice);
  }

  if ((requestedChannel === 'fanza' || requestedChannel === 'dmm') && result.mode === 'annual') {
    return mergeNotice(MESSAGES.officialAnnualFallbackTo(result.resolvedSourceLabel || result.sourceName), result.notice);
  }

  return mergeNotice(MESSAGES.fallbackTo(result.resolvedSourceLabel || result.sourceName), result.notice);
}

async function trySource(sourceId, context) {
  if (sourceId === 'official') {
    return getOfficialResult(context);
  }

  if (sourceId === 'avfan') {
    return getAvfanResult(context);
  }

  if (sourceId === 'minnano') {
    return getMinnanoResult(context);
  }

  if (sourceId === 'r18dev') {
    return getR18DevResult(context);
  }

  return getLocalResult(context);
}

async function getActressRankings(options = {}) {
  const requestedChannel = normalizeRankingChannel(options.source);
  const mode = options.mode === 'annual' ? 'annual' : 'monthly';
  const year = options.year;
  const month = options.month;
  const forceRefresh = Boolean(options.forceRefresh);
  const proxy = normalizeProxy(options.proxy);
  const cacheFilePath = options.cacheFilePath;
  const cache = normalizeCache(readJsonFile(cacheFilePath));
  mergeHistoryDirectoriesIntoCache(cache, options.historyDirectories || []);

  const context = {
    requestedChannel,
    mode,
    year,
    month,
    forceRefresh,
    proxy,
    cache,
    cacheFilePath
  };

  const sourcePlan = buildSourcePlan(requestedChannel, mode);
  const failures = [];

  for (const sourceId of sourcePlan) {
    try {
      const result = await trySource(sourceId, context);
      if (failures.length > 0) {
        result.notice = enrichFallbackNotice(requestedChannel, failures[0].sourceId, result);
        result.fallbackUsed = true;
      } else if ((requestedChannel === 'fanza' || requestedChannel === 'dmm') && mode === 'annual') {
        result.notice = mergeNotice(
          MESSAGES.officialAnnualFallbackTo(result.resolvedSourceLabel || result.sourceName),
          result.notice
        );
        result.fallbackUsed = true;
      } else if (requestedChannel === 'smart' && sourceId === 'official' && !result.notice) {
        result.notice = MESSAGES.smartOfficialNotice;
      }
      return result;
    } catch (error) {
      failures.push({
        sourceId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const detail = failures.map((item) => `${SOURCE_CHANNELS[item.sourceId]?.label || item.sourceId}: ${item.message}`);

  // For historical month requests: return graceful empty instead of hard error
  if (mode === 'monthly') {
    const currentJapan = getCurrentJapanYearMonth();
    const numericYear = Number.parseInt(String(year || ''), 10);
    const numericMonth = Number.parseInt(String(month || ''), 10);
    const isHistoricalMonthRequest =
      Number.isFinite(numericYear) &&
      Number.isFinite(numericMonth) &&
      (numericYear < currentJapan.year ||
        (numericYear === currentJapan.year && numericMonth < currentJapan.month));

    if (isHistoricalMonthRequest) {
      const freshCache = normalizeCache(readJsonFile(cacheFilePath));
      const allBuckets = ['official', 'avfan', 'minnano', 'r18dev', 'localHistory'];
      const availability = getMonthlyAvailability(freshCache, allBuckets, numericYear);
      const requestedKey = getMonthKey(numericYear, numericMonth);
      const periodLabel = `${numericYear}\u5e74${String(numericMonth).padStart(2, '0')}\u6708`;
      return {
        mode: 'monthly',
        sourceName: '\u672c\u5730\u5386\u53f2',
        sourceUrl: '',
        title: `${requestedKey} \u5386\u53f2\u6708\u699c\uff08\u6682\u65e0\u6570\u636e\uff09`,
        periodLabel,
        periodYear: numericYear,
        periodMonth: numericMonth,
        total: 0,
        availableYears: availability.availableYears,
        availableMonths: availability.availableMonths,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
        stale: false,
        requestedSource: requestedChannel,
        requestedSourceLabel: getChannelLabel(requestedChannel),
        resolvedSource: 'local',
        resolvedSourceLabel: getChannelLabel('local'),
        notice: MESSAGES.historicalMonthNoData(requestedKey),
        items: []
      };
    }
  }

  throw createRankingError(detail.join(' | '), 'ranking_all_sources_failed');
}

module.exports = {
  getActressRankings,
  __private__: {
    buildSourcePlan,
    normalizeCache,
    resolveCachedMonthlyEntry,
    resolveCachedAnnualEntry,
    decorateMonthlyResult,
    decorateAnnualResult
  }
};

