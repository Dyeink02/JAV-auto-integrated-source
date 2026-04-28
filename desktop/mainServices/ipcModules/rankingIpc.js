'use strict';

const { RANKING } = require('../../common/ipcChannels');

/**
 * Actress ranking IPC handlers.
 *
 * Channels registered:
 *   app:get-actress-rankings, app:resolve-actress-crawl-target
 *
 * @param {object} deps – all deps forwarded from createIpcHandlerRegistrar
 */
function registerRankingHandlers(deps) {
  const {
    ipcMain,
    settingsStore,
    getActressRankings,
    resolveActressCrawlTarget,
    urlSuggestions,
    desktopTestMode
  } = deps;

  // ── test-mode stubs ───────────────────────────────────────────────────────

  function getMockRankingResult(options = {}) {
    const mode = options.mode === 'annual' ? 'annual' : 'monthly';
    const source = String(options.source || 'smart').trim().toLowerCase() || 'smart';
    const sourceName =
      source === 'local'
        ? '\u672c\u5730\u5386\u53f2 \u00b7 AVfan \u5728\u7ebf'
        : source === 'fanza'
          ? 'FANZA \u5b98\u65b9'
          : source === 'dmm'
            ? 'DMM \u5b98\u65b9'
            : 'AVfan \u5728\u7ebf';

    return {
      mode,
      requestedSource: source,
      resolvedSource: source === 'local' ? 'local' : source === 'smart' ? 'avfan' : source,
      sourceName,
      sourceUrl:
        mode === 'annual'
          ? 'https://av-fan.tokyo/ranking/fanza-rental-dvd-actress-top100.php?year=2024'
          : 'https://av-fan.tokyo/ranking/fanza-dvd-actress-monthly.php',
      title:
        mode === 'annual'
          ? '\u30102024\u5e74\u3011 \u3010FANZA\u3011\u5e74\u9593AV\u5973\u512a\u30e9\u30f3\u30ad\u30f3\u30b0'
          : '2026.03 \u3010FANZA\u3011\u6708\u9593DVD\u30fbAV\u5973\u512a\u30e9\u30f3\u30ad\u30f3\u30b0',
      periodLabel: mode === 'annual' ? '2024\u5e74' : '2026\u5e7403\u6708',
      periodYear: mode === 'annual' ? 2024 : 2026,
      periodMonth: mode === 'annual' ? null : 3,
      total: mode === 'annual' ? 90 : 100,
      availableYears: mode === 'annual' ? [2024, 2023, 2022, 2021, 2020] : [2026],
      availableMonths: mode === 'annual' ? [] : [3],
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      stale: false,
      notice:
        source === 'fanza' || source === 'dmm'
          ? '\u5b98\u65b9\u6e90\u6d4b\u8bd5\u6a21\u5f0f\u4e0b\u8fd4\u56de\u793a\u4f8b\u6570\u636e\u3002'
          : source === 'local'
            ? '\u5f53\u524d\u4e3a\u672c\u5730\u5386\u53f2\u6d4b\u8bd5\u6570\u636e\u3002'
            : '',
      items:
        mode === 'annual'
          ? [
              { rank: 1, actressName: '\u68ee\u6ca2\u304b\u306a', profileUrl: 'https://av-fan.tokyo/actress/sample-1.html', imageUrl: '' },
              { rank: 2, actressName: '\u685c\u7a7a\u3082\u3082', profileUrl: 'https://av-fan.tokyo/actress/sample-2.html', imageUrl: '' },
              { rank: 3, actressName: '\u6cb3\u5317\u5f69\u4f73', profileUrl: 'https://av-fan.tokyo/actress/sample-3.html', imageUrl: '' }
            ]
          : [
              { rank: 1, actressName: '\u77f3\u5ddd\u6fa9', profileUrl: 'https://av-fan.tokyo/actress/sample-4.html', imageUrl: '' },
              { rank: 2, actressName: '\u9022\u6ca2\u307f\u3086', profileUrl: 'https://av-fan.tokyo/actress/sample-5.html', imageUrl: '' },
              { rank: 3, actressName: '\u5929\u4f7f\u3082\u3048', profileUrl: 'https://av-fan.tokyo/actress/sample-6.html', imageUrl: '' }
            ]
    };
  }

  function getMockActressTarget(options = {}) {
    const baseOrigin = options.preferredBase || 'https://www.busjav.cyou';
    return {
      actressName: options.actressName || '\u77f3\u5ddd\u6fa9',
      resolvedActressName: options.actressName || '\u77f3\u5ddd\u6fa9',
      resolvedBase: `${String(baseOrigin).replace(/\/$/, '')}/star/xvn`,
      lookupBaseOrigin: String(baseOrigin).replace(/\/$/, ''),
      matchMode: 'exact',
      candidateCount: 1,
      candidatePreview: [
        {
          actressName: options.actressName || '\u77f3\u5ddd\u6fa9',
          href: `${String(baseOrigin).replace(/\/$/, '')}/star/xvn`
        }
      ],
      magnetCount: 97,
      allCount: 157,
      fillCount: 97,
      preferredCount: 97,
      itemsPerPage: 30,
      totalPages: 4
    };
  }

  // ── channel registrations ─────────────────────────────────────────────────

  ipcMain.handle(RANKING.GET_RANKINGS, async (_, options = {}) => {
    if (desktopTestMode) return getMockRankingResult(options);

    return getActressRankings({
      mode: options.mode,
      year: options.year,
      month: options.month,
      source: options.source,
      proxy: options.proxy,
      forceRefresh: Boolean(options.forceRefresh),
      cacheFilePath: settingsStore.getRankingCachePath(),
      historyDirectories: settingsStore.getRankingHistoryDirectories()
    });
  });

  ipcMain.handle(RANKING.RESOLVE_TARGET, async (_, options = {}) => {
    if (desktopTestMode) return getMockActressTarget(options);

    return resolveActressCrawlTarget({
      actressName: options.actressName,
      preferredBase: options.preferredBase,
      fallbackBases: urlSuggestions,
      magnetOnly: Boolean(options.magnetOnly)
    });
  });
}

module.exports = { registerRankingHandlers };
