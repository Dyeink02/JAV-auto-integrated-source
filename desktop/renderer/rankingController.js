(function initializeRankingController(globalScope) {
  const STORAGE_KEY = 'desktop-ranking-source-channel';

  const DEFAULT_RANKING_TEXT = {
    empty: '\u5f53\u524d\u6ca1\u6709\u53ef\u5c55\u793a\u7684\u699c\u5355\u6570\u636e\u3002',
    loading: '\u6b63\u5728\u52a0\u8f7d\u699c\u5355\u6570\u636e...',
    loadFailedMeta: '\u53c2\u8003\u699c\u5355\u83b7\u53d6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
    monthMode: '\u6708\u5ea6',
    annualMode: '\u5e74\u5ea6',
    modeLabel: '\u699c\u5355\u7c7b\u578b',
    channelLabel: '\u4fe1\u606f\u6e20\u9053',
    channelSmart: '\u667a\u80fd\u63a8\u8350',
    channelFanza: 'FANZA \u5b98\u65b9',
    channelDmm: 'DMM \u5b98\u65b9',
    channelAvfan: 'AVfan \u5728\u7ebf',
    channelMinnano: '\u307f\u3093\u306a\u306e\u30a2\u30d6',
    channelR18dev: 'r18.dev',
    channelLocal: '\u672c\u5730\u5386\u53f2',
    yearLabel: '\u5e74\u4efd',
    monthLabel: '\u6708\u4efd',
    monthHelp: '\u53ef\u6309\u5e74\u4efd\u4e0e\u6708\u4efd\u7b5b\u9009\u6708\u5ea6\u699c\u5355\uff0c\u4f18\u5148\u663e\u793a\u53ef\u7528\u7684\u6700\u65b0\u6570\u636e\u3002',
    annualHelp: '\u53ef\u6309\u5e74\u4efd\u67e5\u770b\u5e74\u5ea6\u699c\u5355\uff0c\u9002\u5408\u7528\u4e8e\u5feb\u901f\u53c2\u8003\u5973\u4f18\u70ed\u5ea6\u8d70\u52bf\u3002',
    currentMonthOnly: '\u6708\u5ea6\u6a21\u5f0f\u4f1a\u4f18\u5148\u5c55\u793a\u5f53\u524d\u6708\u4efd\uff0c\u5982\u5f53\u6708\u6682\u65f6\u4e0d\u53ef\u7528\uff0c\u4f1a\u81ea\u52a8\u56de\u9000\u5230\u6700\u8fd1\u53ef\u7528\u6570\u636e\u3002',
    channelHelpSmart: '\u667a\u80fd\u63a8\u8350\u4f1a\u4f18\u5148\u5c1d\u8bd5\u5b98\u65b9\u6708\u699c\uff0c\u82e5\u4e0d\u53ef\u7528\u4f9d\u6b21\u56de\u9000\u81f3 AVfan\u3001\u307f\u3093\u306a\u306e\u30a2\u30d6\u3001r18.dev \u4e0e\u672c\u5730\u5386\u53f2\u3002',
    channelHelpOfficial: '\u5b98\u65b9\u6e20\u9053\u4f18\u5148\u53c2\u8003 DMM / FANZA \u5f53\u524d\u6708\u699c\uff0c\u9700\u642d\u914d\u65e5\u672c\u5730\u533a\u4ee3\u7406 / VPN \u624d\u80fd\u66f4\u7a33\u5b9a\u8bbf\u95ee\u3002',
    channelHelpAvfan: 'AVfan \u9002\u5408\u67e5\u770b\u5df2\u516c\u5f00\u7684\u6708\u699c\u4e0e\u5e74\u699c\uff0c\u5386\u53f2\u6570\u636e\u8986\u76d6\u66f4\u5168\uff0c\u65e0\u6cd5\u8fde\u63a5\u5b98\u65b9\u65f6\u4f53\u9a8c\u66f4\u7a33\u5b9a\u3002',
    channelHelpMinnano: '\u307f\u3093\u306a\u306e\u30a2\u30d6\u4e3a\u793e\u533a\u9a71\u52a8\u7684\u5973\u4f18\u6708\u5ea6\u699c\u5355\uff0c\u65e0\u9700\u65e5\u672c\u4ee3\u7406\u53ef\u76f4\u8fde\uff0c\u66f4\u65b0\u9891\u7387\u9ad8\u3002',
    channelHelpR18dev: 'r18.dev \u6574\u5408 FANZA/DMM \u5b98\u65b9\u6570\u636e\u5c55\u793a\u4eba\u6c14\u5973\u4f18\u5217\u8868\uff0c\u63d0\u4f9b\u82f1\u6587\u754c\u53c2\u8003\u89c6\u89d2\u3002',
    channelHelpLocal: '\u672c\u5730\u5386\u53f2\u4ec5\u8bfb\u53d6\u5df2\u7f13\u5b58\u5230\u672c\u673a\u7684\u699c\u5355\u8bb0\u5f55\uff0c\u4e0d\u4f1a\u53d1\u8d77\u5728\u7ebf\u8bf7\u6c42\u3002',
    officialProxyTip: '\u82e5\u5e0c\u671b\u7a33\u5b9a\u67e5\u770b\u5b98\u65b9\u699c\u5355\uff0c\u5efa\u8bae\u5f00\u542f\u65e5\u672c\u5730\u533a\u4ee3\u7406 / VPN\uff0c\u4ee5\u83b7\u5f97\u66f4\u597d\u7684\u52a0\u8f7d\u6210\u529f\u7387\u3002',
    officialAnnualTip: '\u5b98\u65b9\u6e20\u9053\u76ee\u524d\u4ee5\u6708\u699c\u4e3a\u4e3b\uff1b\u5f53\u4f60\u5207\u6362\u5230\u5e74\u5ea6\u699c\u5355\u65f6\uff0c\u7cfb\u7edf\u4f1a\u81ea\u52a8\u4f18\u5148\u6539\u7528 AVfan \u6216\u672c\u5730\u5386\u53f2\u3002',
    avfanTip: 'AVfan \u4e0e\u672c\u5730\u5386\u53f2\u6a21\u5f0f\u4e0d\u5f3a\u4f9d\u8d56\u65e5\u672c\u4ee3\u7406\uff0c\u66f4\u9002\u5408\u67e5\u770b\u5386\u53f2\u699c\u5355\u4e0e\u8fdb\u884c\u8865\u5145\u53c2\u8003\u3002',
    localTip: '\u5f53\u524d\u4ec5\u5c55\u793a\u672c\u5730\u5df2\u7f13\u5b58\u7684\u5386\u53f2\u699c\u5355\uff0c\u4e0d\u4f1a\u989d\u5916\u8fde\u63a5\u5916\u90e8\u7f51\u7ad9\u3002',
    sourcePrefix: '\u6765\u6e90\uff1a',
    selectedSourcePrefix: '\u5df2\u9009\u6e20\u9053\uff1a',
    resolvedSourcePrefix: '\u5f53\u524d\u4f7f\u7528\uff1a',
    fetchedAtPrefix: '\u6293\u53d6\u65f6\u95f4\uff1a',
    periodPrefix: '\u7edf\u8ba1\u5468\u671f\uff1a',
    totalPrefix: '\u699c\u5355\u6570\u91cf\uff1a',
    staleSuffix: '\u7f13\u5b58\u6570\u636e',
    openSource: '\u6253\u5f00\u6765\u6e90',
    unknownActress: '\u672a\u77e5\u5973\u4f18',
    autoFillButtonTitleSuffix: ' - \u70b9\u51fb\u540e\u81ea\u52a8\u586b\u5145\u771f\u5b9e\u5973\u4f18\u76ee\u5f55\u4e0e\u6709\u78c1\u529b\u6570\u91cf',
    rankSuffix: '\u540d',
    sourceItemPrefix: '\u76ee\u5f55\u94fe\u63a5\uff1a',
    noYearData: '\u6682\u65e0\u5e74\u5ea6\u6570\u636e',
    yearOptionSuffix: ' \u5e74',
    noMonthData: '\u6682\u65e0\u6708\u4efd\u6570\u636e',
    noticePrefix: '\u63d0\u793a\uff1a',
    warningPrefix: '\u8bf4\u660e\uff1a',
    openProfileLogPrefix: '\u5df2\u5728\u9ed8\u8ba4\u6d4f\u89c8\u5668\u6253\u5f00\u76ee\u5f55\u94fe\u63a5\uff1a'
  };

  function clearChildren(container) {
    while (container && container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function createOption(value, text) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = text;
    return option;
  }

  function toDisplayMonth(month) {
    const numericMonth = Number.parseInt(String(month || ''), 10);
    if (!Number.isFinite(numericMonth) || numericMonth < 1 || numericMonth > 12) {
      return String(month || '');
    }

    return `${String(numericMonth).padStart(2, '0')} \u6708`;
  }

  function toSourceLabel(url) {
    if (!url) {
      return '';
    }

    try {
      const parsed = new URL(url);
      const decodedPath = decodeURIComponent(parsed.pathname);
      return `${parsed.hostname}${decodedPath}`;
    } catch {
      return String(url);
    }
  }

  function toFriendlyIssueText(message) {
    const rawText = String(message || '').trim();
    if (!rawText) {
      return '';
    }

    if (rawText.includes('ERR_PROXY_CONNECTION_FAILED')) {
      return '\u5f53\u524d\u4ee3\u7406\u7ebf\u8def\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u66f4\u6362\u53ef\u7528\u7684\u65e5\u672c\u8282\u70b9\u540e\u91cd\u8bd5\u3002';
    }

    if (rawText.includes('not-available-in-your-region') || rawText.includes('region')) {
      return '\u5f53\u524d\u7ebf\u8def\u65e0\u6cd5\u7a33\u5b9a\u8bbf\u95ee\u5b98\u65b9\u699c\u5355\uff0c\u8bf7\u786e\u8ba4\u65e5\u672c\u5730\u533a\u4ee3\u7406 / VPN \u662f\u5426\u53ef\u7528\u3002';
    }

    if (rawText.includes('age') && rawText.includes('check')) {
      return '\u5b98\u65b9\u699c\u5355\u8bbf\u95ee\u672a\u901a\u8fc7\u5e74\u9f84\u9a8c\u8bc1\uff0c\u8bf7\u66f4\u6362\u53ef\u7528\u7684\u65e5\u672c\u8282\u70b9\u540e\u91cd\u8bd5\u3002';
    }

    return rawText;
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function safeLocalStorageGet(key, fallbackValue) {
    try {
      const value = globalScope.localStorage.getItem(key);
      return value == null ? fallbackValue : value;
    } catch {
      return fallbackValue;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      globalScope.localStorage.setItem(key, value);
    } catch {
      // ignore storage failures in the renderer sandbox
    }
  }

  function createRankingController(options) {
    const { elements, desktopApi, logController, uiText, formController } = options;
    const { UI_TEXT } = uiText;
    const rankingText = Object.assign({}, DEFAULT_RANKING_TEXT, UI_TEXT.ranking || {});
    let currentSourceUrl = '';
    let latestLoadToken = 0;

    function isAnnualMode() {
      return elements.rankingMode.value === 'annual';
    }

    function getSelectedChannel() {
      return String(elements.rankingSourceChannel.value || 'smart').trim() || 'smart';
    }

    function getChannelHelpText(channel) {
      if (channel === 'fanza' || channel === 'dmm') {
        return rankingText.channelHelpOfficial;
      }

      if (channel === 'avfan') {
        return rankingText.channelHelpAvfan;
      }

      if (channel === 'minnano') {
        return rankingText.channelHelpMinnano || rankingText.channelHelpAvfan;
      }

      if (channel === 'r18dev') {
        return rankingText.channelHelpR18dev || rankingText.channelHelpAvfan;
      }

      if (channel === 'local') {
        return rankingText.channelHelpLocal;
      }

      return rankingText.channelHelpSmart;
    }

    function getChannelTipText(channel) {
      if (isAnnualMode() && (channel === 'fanza' || channel === 'dmm' || channel === 'smart')) {
        return rankingText.officialAnnualTip;
      }

      if (channel === 'minnano') {
        return rankingText.minnanoTip || rankingText.avfanTip;
      }

      if (channel === 'r18dev') {
        return rankingText.r18devTip || rankingText.avfanTip;
      }

      if (channel === 'local') {
        return rankingText.localTip;
      }

      if (channel === 'avfan') {
        return rankingText.avfanTip;
      }

      return rankingText.officialProxyTip;
    }

    function setHelpText() {
      const modeHelp = isAnnualMode() ? rankingText.annualHelp : rankingText.currentMonthOnly || rankingText.monthHelp;
      const channel = getSelectedChannel();
      const channelHelp = getChannelHelpText(channel);
      elements.rankingHelp.textContent = [modeHelp, channelHelp].filter(Boolean).join(' ');
      if (elements.rankingChannelTip) {
        elements.rankingChannelTip.textContent = getChannelTipText(channel);
      }
      elements.rankingYearField.classList.remove('hidden');
      elements.rankingMonthField.classList.toggle('hidden', isAnnualMode());
    }

    function setMetaText(text) {
      elements.rankingMeta.textContent = text || rankingText.empty;
      elements.rankingMeta.title = text || rankingText.empty;
    }

    function setSource(sourceName, sourceUrl) {
      currentSourceUrl = sourceUrl || '';

      if (!currentSourceUrl) {
        elements.rankingSource.classList.add('hidden');
        elements.rankingSourceText.textContent = '';
        elements.rankingSourceText.title = '';
        return;
      }

      const sourceText = `${rankingText.sourcePrefix}${sourceName} ${toSourceLabel(sourceUrl)}`;
      elements.rankingSource.classList.remove('hidden');
      elements.rankingSourceText.textContent = sourceText;
      elements.rankingSourceText.title = `${rankingText.sourcePrefix}${sourceName} ${sourceUrl}`;
    }

    function renderEmpty(text) {
      clearChildren(elements.rankingView);
      const empty = document.createElement('article');
      empty.className = 'ranking-empty';
      empty.textContent = text || rankingText.empty;
      elements.rankingView.appendChild(empty);
    }

    async function fillActressTarget(item) {
      const actressName = String(item && item.actressName ? item.actressName : '').trim();
      if (!actressName) {
        return;
      }

      try {
        const lookupContext = formController && typeof formController.getLookupContext === 'function'
          ? formController.getLookupContext()
          : { preferredBase: elements.base.value.trim(), magnetOnly: elements.nomag.checked };

        logController.appendLog(
          'info',
          `${UI_TEXT.messages.rankingResolvingPrefix}${actressName}`,
          new Date().toISOString()
        );

        const result = await desktopApi.resolveActressCrawlTarget({
          actressName,
          preferredBase: lookupContext.preferredBase,
          magnetOnly: lookupContext.magnetOnly
        });

        if (formController && typeof formController.applyActressLookupResult === 'function') {
          formController.applyActressLookupResult(result);
        }

        const fillCount =
          Number.isFinite(result.fillCount) && result.fillCount >= 0 ? result.fillCount : result.preferredCount;
        const summary = [
          `${UI_TEXT.messages.rankingResolvedPrefix}${result.resolvedActressName || actressName}`,
          `${UI_TEXT.messages.rankingResolvedMagnetPrefix}${result.magnetCount || fillCount}${UI_TEXT.messages.rankingResolvedCountSuffix}`,
          `${UI_TEXT.messages.rankingResolvedAllPrefix}${result.allCount || fillCount}${UI_TEXT.messages.rankingResolvedCountSuffix}`,
          `${UI_TEXT.messages.rankingResolvedPagesPrefix}${result.totalPages}${UI_TEXT.messages.rankingResolvedPagesSuffix}`,
          UI_TEXT.messages.rankingResolvedDefaultHint
        ].join(' ');

        logController.appendLog('info', summary, new Date().toISOString());
      } catch (error) {
        logController.appendLog(
          'warn',
          `${UI_TEXT.messages.rankingResolveFailedPrefix}${getErrorMessage(error)}`,
          new Date().toISOString()
        );
      }
    }

    function createNameButton(item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ranking-name-link';
      button.textContent = item.actressName || rankingText.unknownActress;
      button.title = `${item.actressName || rankingText.unknownActress}${rankingText.autoFillButtonTitleSuffix || ''}`;
      button.addEventListener('click', async () => {
        await fillActressTarget(item);
      });
      return button;
    }

    function createSubtitle(item) {
      const subtitle = document.createElement('button');
      subtitle.type = 'button';
      subtitle.className = 'ranking-link';
      subtitle.textContent = `${rankingText.sourceItemPrefix}${toSourceLabel(item.profileUrl)}`;
      subtitle.title = item.profileUrl || '';
      subtitle.addEventListener('click', async () => {
        if (!item.profileUrl) {
          return;
        }

        await desktopApi.openExternal(item.profileUrl);
        logController.appendLog(
          'info',
          `${rankingText.openProfileLogPrefix}${item.profileUrl}`,
          new Date().toISOString()
        );
      });
      return subtitle;
    }

    function renderItems(items) {
      clearChildren(elements.rankingView);
      const normalizedItems = Array.isArray(items) ? items : [];

      if (normalizedItems.length === 0) {
        renderEmpty(rankingText.empty);
        return;
      }

      const fragment = document.createDocumentFragment();
      normalizedItems.forEach((item) => {
        const row = document.createElement('article');
        const rank = document.createElement('span');
        const info = document.createElement('div');

        row.className = 'ranking-item';
        rank.className = 'ranking-rank';
        info.className = 'ranking-info';

        rank.textContent = `${item.rank}${rankingText.rankSuffix}`;
        info.appendChild(createNameButton(item));

        // Show works count if available
        if (item.worksCount != null && Number.isFinite(item.worksCount)) {
          const worksEl = document.createElement('span');
          worksEl.className = 'ranking-works-count';
          worksEl.textContent = `${item.worksCount}\u672c`;
          info.appendChild(worksEl);
        }

        // Show latest work title if available
        if (item.latestTitle) {
          const latestEl = document.createElement('span');
          latestEl.className = 'ranking-latest-title';
          latestEl.textContent = item.latestTitle;
          latestEl.title = item.latestTitle;
          info.appendChild(latestEl);
        }

        if (item.profileUrl) {
          info.appendChild(createSubtitle(item));
        }

        row.appendChild(rank);
        row.appendChild(info);
        fragment.appendChild(row);
      });

      elements.rankingView.appendChild(fragment);
      elements.rankingView.scrollTop = 0;
    }

    function renderYearOptions(years = [], selectedYear = '') {
      const normalizedYears = Array.from(
        new Set(
          (Array.isArray(years) ? years : [])
            .map((value) => Number.parseInt(String(value || ''), 10))
            .filter((value) => Number.isFinite(value))
        )
      ).sort((left, right) => right - left);

      clearChildren(elements.rankingYear);

      if (normalizedYears.length === 0) {
        elements.rankingYear.appendChild(createOption('', rankingText.noYearData));
        elements.rankingYear.disabled = true;
        return;
      }

      normalizedYears.forEach((year) => {
        elements.rankingYear.appendChild(createOption(year, `${year}${rankingText.yearOptionSuffix}`));
      });

      elements.rankingYear.disabled = false;
      const preferredYear = String(selectedYear || normalizedYears[0]);
      elements.rankingYear.value = normalizedYears.some((year) => String(year) === preferredYear)
        ? preferredYear
        : String(normalizedYears[0]);
    }

    function renderMonthOptions(months = [], selectedMonth = '') {
      const normalizedMonths = Array.from(
        new Set(
          (Array.isArray(months) ? months : [])
            .map((value) => Number.parseInt(String(value || ''), 10))
            .filter((value) => Number.isFinite(value) && value >= 1 && value <= 12)
        )
      ).sort((left, right) => right - left);

      clearChildren(elements.rankingMonth);

      if (normalizedMonths.length === 0) {
        elements.rankingMonth.appendChild(createOption('', rankingText.noMonthData));
        elements.rankingMonth.disabled = true;
        return;
      }

      normalizedMonths.forEach((month) => {
        elements.rankingMonth.appendChild(createOption(month, toDisplayMonth(month)));
      });

      elements.rankingMonth.disabled = false;
      const preferredMonth = String(selectedMonth || normalizedMonths[0]);
      elements.rankingMonth.value = normalizedMonths.some((month) => String(month) === preferredMonth)
        ? preferredMonth
        : String(normalizedMonths[0]);
    }

    function syncPeriodSelectors(ranking) {
      renderYearOptions(ranking.availableYears, ranking.periodYear);
      if (!isAnnualMode()) {
        renderMonthOptions(ranking.availableMonths, ranking.periodMonth);
      }
    }

    function buildMetaText(ranking) {
      const channelLine = [
        `${rankingText.selectedSourcePrefix}${ranking.requestedSourceLabel || rankingText.channelSmart}`,
        `${rankingText.resolvedSourcePrefix}${ranking.resolvedSourceLabel || ranking.sourceName || rankingText.channelSmart}`
      ];

      const metaParts = [
        `${rankingText.periodPrefix}${ranking.periodLabel}`,
        `${rankingText.totalPrefix}${ranking.total}`,
        `${rankingText.fetchedAtPrefix}${new Date(ranking.fetchedAt).toLocaleString('zh-CN', { hour12: false })}`
      ];

      if (ranking.stale) {
        metaParts.push(rankingText.staleSuffix);
      }

      const lines = [channelLine.join(' | '), metaParts.join(' | ')];
      if (ranking.notice) {
        lines.push(`${rankingText.noticePrefix}${ranking.notice}`);
      }
      if (ranking.errorMessage && ranking.errorMessage !== ranking.notice) {
        lines.push(`${rankingText.warningPrefix}${toFriendlyIssueText(ranking.errorMessage)}`);
      }
      return lines.join('\n');
    }

    async function loadRankings(options = {}) {
      const { forceRefresh = false, silent = false } = options;
      const requestToken = latestLoadToken + 1;
      latestLoadToken = requestToken;

      const mode = elements.rankingMode.value || 'monthly';
      const year = elements.rankingYear.value;
      const month = !isAnnualMode() ? elements.rankingMonth.value : '';
      const source = getSelectedChannel();
      const proxy = elements.proxy && elements.proxy.value ? elements.proxy.value.trim() : '';

      if (!silent) {
        logController.appendLog('info', UI_TEXT.messages.rankingLoading, new Date().toISOString());
      }

      elements.refreshRankingButton.disabled = true;
      setMetaText(rankingText.loading);

      try {
        const ranking = await desktopApi.getActressRankings({
          mode,
          year,
          month,
          source,
          proxy,
          forceRefresh
        });

        if (requestToken !== latestLoadToken) {
          return;
        }

        syncPeriodSelectors(ranking);
        setSource(ranking.sourceName, ranking.sourceUrl);
        renderItems(ranking.items);
        setMetaText(buildMetaText(ranking));

        if (!silent) {
          logController.appendLog(
            'info',
            `${UI_TEXT.messages.rankingLoadedPrefix}${ranking.periodLabel}${UI_TEXT.messages.rankingLoadedMiddle}${ranking.total}${UI_TEXT.messages.rankingLoadedSuffix}`,
            new Date().toISOString()
          );
        }

        if (ranking.notice) {
          logController.appendLog('info', ranking.notice, new Date().toISOString());
        }
        if (ranking.errorMessage && ranking.errorMessage !== ranking.notice) {
          logController.appendLog('warn', ranking.errorMessage, new Date().toISOString());
        }
      } catch (error) {
        if (requestToken !== latestLoadToken) {
          return;
        }

        currentSourceUrl = '';
        elements.rankingSource.classList.add('hidden');
        renderEmpty(getErrorMessage(error));
        setMetaText(rankingText.loadFailedMeta);
        logController.appendLog('warn', getErrorMessage(error), new Date().toISOString());
      } finally {
        if (requestToken === latestLoadToken) {
          elements.refreshRankingButton.disabled = false;
        }
      }
    }

    function bindEvents() {
      elements.rankingSourceChannel.addEventListener('change', async () => {
        safeLocalStorageSet(STORAGE_KEY, getSelectedChannel());
        setHelpText();
        await loadRankings({ silent: true });
      });

      elements.rankingMode.addEventListener('change', async () => {
        setHelpText();
        await loadRankings({ silent: true });
      });

      elements.rankingYear.addEventListener('change', async () => {
        await loadRankings({ silent: true });
      });

      elements.rankingMonth.addEventListener('change', async () => {
        if (isAnnualMode()) {
          return;
        }

        await loadRankings({ silent: true });
      });

      elements.refreshRankingButton.addEventListener('click', async () => {
        await loadRankings({ forceRefresh: true });
      });

      elements.openRankingSourceButton.addEventListener('click', async () => {
        if (!currentSourceUrl) {
          return;
        }

        await desktopApi.openExternal(currentSourceUrl);
        logController.appendLog(
          'info',
          `${UI_TEXT.messages.rankingSourceOpenedPrefix}${currentSourceUrl}`,
          new Date().toISOString()
        );
      });

      elements.rankingSourceText.addEventListener('click', async () => {
        if (!currentSourceUrl) {
          return;
        }

        await desktopApi.openExternal(currentSourceUrl);
      });
    }

    function renderSourceChannelOptions() {
      clearChildren(elements.rankingSourceChannel);
      elements.rankingSourceChannel.appendChild(createOption('smart', rankingText.channelSmart));
      elements.rankingSourceChannel.appendChild(createOption('fanza', rankingText.channelFanza));
      elements.rankingSourceChannel.appendChild(createOption('dmm', rankingText.channelDmm));
      elements.rankingSourceChannel.appendChild(createOption('avfan', rankingText.channelAvfan));
      elements.rankingSourceChannel.appendChild(createOption('minnano', rankingText.channelMinnano || '\u307f\u3093\u306a\u306e\u30a2\u30d6'));
      elements.rankingSourceChannel.appendChild(createOption('r18dev', rankingText.channelR18dev || 'r18.dev'));
      elements.rankingSourceChannel.appendChild(createOption('local', rankingText.channelLocal));

      const validChannels = ['smart', 'fanza', 'dmm', 'avfan', 'minnano', 'r18dev', 'local'];
      const savedSource = safeLocalStorageGet(STORAGE_KEY, 'smart');
      elements.rankingSourceChannel.value = validChannels.includes(savedSource) ? savedSource : 'smart';
    }

    function bootstrap() {
      renderSourceChannelOptions();
      clearChildren(elements.rankingMode);
      elements.rankingMode.appendChild(createOption('monthly', rankingText.monthMode));
      elements.rankingMode.appendChild(createOption('annual', rankingText.annualMode));
      renderYearOptions([]);
      renderMonthOptions([]);
      setHelpText();
      bindEvents();
      void loadRankings({ silent: true });
    }

    return {
      bootstrap,
      loadRankings
    };
  }

  globalScope.desktopRankingController = {
    createRankingController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
