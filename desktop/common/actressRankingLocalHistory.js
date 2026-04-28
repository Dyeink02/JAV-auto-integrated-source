const fs = require('fs');
const path = require('path');

const {
  buildCachePayload,
  getMonthKey,
  normalizeYearList
} = require('./actressRankingShared.js');

function listJsonFiles(directoryPath) {
  const normalizedPath = String(directoryPath || '').trim();
  if (!normalizedPath || !fs.existsSync(normalizedPath)) {
    return [];
  }

  const queue = [normalizedPath];
  const files = [];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    entries.forEach((entry) => {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        return;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        files.push(entryPath);
      }
    });
  }

  return files;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeRankingItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => {
      const actressName = String(item && item.actressName ? item.actressName : '').trim();
      if (!actressName) {
        return null;
      }

      const parsedRank = Number.parseInt(String(item.rank || ''), 10);
      return {
        rank: Number.isFinite(parsedRank) && parsedRank > 0 ? parsedRank : index + 1,
        actressName,
        profileUrl: String(item.profileUrl || '').trim(),
        imageUrl: String(item.imageUrl || '').trim()
      };
    })
    .filter(Boolean);
}

function buildPeriodLabel(mode, year, month) {
  if (mode === 'annual') {
    return `${year}年`;
  }

  return `${year}年${String(month).padStart(2, '0')}月`;
}

function normalizeHistoryRecord(record, filePath) {
  const mode = record && record.mode === 'annual' ? 'annual' : 'monthly';
  const periodYear = Number.parseInt(String(record && record.periodYear ? record.periodYear : ''), 10);
  const rawMonth = Number.parseInt(String(record && record.periodMonth ? record.periodMonth : ''), 10);
  const periodMonth = mode === 'monthly' && Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : null;
  const items = normalizeRankingItems(record && record.items);

  if (!Number.isFinite(periodYear) || (mode === 'monthly' && !Number.isFinite(periodMonth)) || items.length === 0) {
    return null;
  }

  const fetchedAtSource =
    String(record && record.fetchedAt ? record.fetchedAt : '').trim() ||
    fs.statSync(filePath).mtime.toISOString();

  return {
    mode,
    sourceName: String(record && record.sourceName ? record.sourceName : '本地历史导入').trim() || '本地历史导入',
    sourceUrl: String(record && record.sourceUrl ? record.sourceUrl : '').trim(),
    title:
      String(record && record.title ? record.title : '').trim() ||
      `本地历史榜单 ${buildPeriodLabel(mode, periodYear, periodMonth)}`,
    periodLabel:
      String(record && record.periodLabel ? record.periodLabel : '').trim() ||
      buildPeriodLabel(mode, periodYear, periodMonth),
    periodYear,
    periodMonth,
    total: Number.isFinite(Number(record && record.total)) ? Number(record.total) : items.length,
    availableYears: normalizeYearList([...(record && record.availableYears ? record.availableYears : []), periodYear]),
    availableMonths: mode === 'monthly' ? [periodMonth] : [],
    fetchedAt: fetchedAtSource,
    items
  };
}

function toHistoryRecords(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.records)) {
    return payload.records;
  }

  return payload ? [payload] : [];
}

function mergeHistoryDirectoriesIntoCache(cache, directories = []) {
  const localHistoryBucket = cache.sources.localHistory || {
    monthlyLatestKey: '',
    monthlyByPeriod: {},
    annualByYear: {},
    availableYears: []
  };

  const files = Array.from(
    new Set(
      (Array.isArray(directories) ? directories : [])
        .flatMap((directoryPath) => listJsonFiles(directoryPath))
        .filter(Boolean)
    )
  );

  files.forEach((filePath) => {
    const payload = safeReadJson(filePath);
    const records = toHistoryRecords(payload)
      .map((record) => normalizeHistoryRecord(record, filePath))
      .filter(Boolean);

    records.forEach((record) => {
      if (record.mode === 'annual') {
        localHistoryBucket.annualByYear[String(record.periodYear)] = buildCachePayload(record);
        localHistoryBucket.availableYears = normalizeYearList([
          ...(localHistoryBucket.availableYears || []),
          ...(record.availableYears || []),
          record.periodYear
        ]);
        return;
      }

      const monthKey = getMonthKey(record.periodYear, record.periodMonth);
      if (!monthKey) {
        return;
      }

      localHistoryBucket.monthlyByPeriod[monthKey] = buildCachePayload(record);
      if (!localHistoryBucket.monthlyLatestKey || monthKey > localHistoryBucket.monthlyLatestKey) {
        localHistoryBucket.monthlyLatestKey = monthKey;
      }
      localHistoryBucket.availableYears = normalizeYearList([
        ...(localHistoryBucket.availableYears || []),
        ...(record.availableYears || []),
        record.periodYear
      ]);
    });
  });

  cache.sources.localHistory = localHistoryBucket;
  return cache;
}

module.exports = {
  mergeHistoryDirectoriesIntoCache
};
