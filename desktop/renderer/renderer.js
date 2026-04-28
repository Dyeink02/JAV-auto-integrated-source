(function initializeRenderer(globalScope) {
  const desktopApi = globalScope.javDesktop;
  const uiText = globalScope.desktopUiText;
  const logControllerFactory = globalScope.desktopLogController;
  const stateControllerFactory = globalScope.desktopStateController;
  const formControllerFactory = globalScope.desktopFormController;
  const rankingControllerFactory = globalScope.desktopRankingController;
  const organizerControllerFactory = globalScope.desktopOrganizerController;

  if (
    !desktopApi ||
    !uiText ||
    !logControllerFactory ||
    !stateControllerFactory ||
    !formControllerFactory ||
    !rankingControllerFactory ||
    !organizerControllerFactory
  ) {
    const fallbackMessage =
      uiText && uiText.UI_TEXT && uiText.UI_TEXT.runtime
        ? uiText.UI_TEXT.runtime.missingDependencies
        : '桌面端渲染依赖未完整加载。';
    throw new Error(fallbackMessage);
  }

  const { UI_TEXT, STATUS_LABELS, FAILURE_CATEGORY_LABELS, applyStaticText } = uiText;

  const elements = {
    navCrawlerButton: document.getElementById('nav-crawler'),
    navOrganizerButton: document.getElementById('nav-organizer'),
    crawlerWorkspace: document.getElementById('crawler-workspace'),
    organizerWorkspace: document.getElementById('organizer-workspace'),
    base: document.getElementById('base'),
    output: document.getElementById('output'),
    limit: document.getElementById('limit'),
    totalPages: document.getElementById('totalPages'),
    itemsPerPage: document.getElementById('itemsPerPage'),
    parallel: document.getElementById('parallel'),
    delay: document.getElementById('delay'),
    timeout: document.getElementById('timeout'),
    proxy: document.getElementById('proxy'),
    proxyStatus: document.getElementById('proxy-status'),
    proxyStatusDetail: document.getElementById('proxy-status-detail'),
    magnetExcludeKeywords: document.getElementById('magnetExcludeKeywords'),
    taskTemplate: document.getElementById('taskTemplate'),
    cloudflare: document.getElementById('cloudflare'),
    secondValidation: document.getElementById('secondValidation'),
    nomag: document.getElementById('nomag'),
    allmag: document.getElementById('allmag'),
    magnetContentValidation: document.getElementById('magnetContentValidation'),
    nopic: document.getElementById('nopic'),
    startButton: document.getElementById('start'),
    stopButton: document.getElementById('stop'),
    restartButton: document.getElementById('restart'),
    chooseBackgroundButton: document.getElementById('choose-background'),
    resetBackgroundButton: document.getElementById('reset-background'),
    browseOutputButton: document.getElementById('browse-output'),
    openOutputButton: document.getElementById('open-output'),
    openMagnetFileButton: document.getElementById('open-magnet-file'),
    openLogFolderButton: document.getElementById('open-log-folder'),
    updateAntiBlockButton: document.getElementById('update-antiblock'),
    clearLogButton: document.getElementById('clear-log'),
    useSuggestedPagesButton: document.getElementById('use-suggested-pages'),
    statusPill: document.getElementById('status-pill'),
    stateMessage: document.getElementById('state-message'),
    currentBox: document.getElementById('current-box'),
    currentItemsView: document.getElementById('current-items'),
    unfinishedBox: document.getElementById('unfinished-box'),
    unfinishedItemsView: document.getElementById('unfinished-items'),
    unfinishedTotalView: document.getElementById('unfinished-total'),
    duplicateBox: document.getElementById('duplicate-box'),
    duplicateItemsView: document.getElementById('duplicate-items'),
    duplicateTotalView: document.getElementById('duplicate-total'),
    pageGapBox: document.getElementById('page-gap-box'),
    pageGapItemsView: document.getElementById('page-gap-items'),
    failedBox: document.getElementById('failed-box'),
    failedItemsView: document.getElementById('failed-items'),
    logView: document.getElementById('log-view'),
    logFilePath: document.getElementById('log-file-path'),
    statPage: document.getElementById('stat-page'),
    statQueued: document.getElementById('stat-queued'),
    statAttempted: document.getElementById('stat-attempted'),
    statCompleted: document.getElementById('stat-completed'),
    totalPagesAdvice: document.getElementById('total-pages-advice'),
    totalPagesMeta: document.getElementById('total-pages-meta'),
    baseUrlHints: document.getElementById('base-url-hints'),
    sourceLink: document.getElementById('source-link'),
    rankingMode: document.getElementById('ranking-mode'),
    rankingSourceChannel: document.getElementById('ranking-source-channel'),
    rankingYear: document.getElementById('ranking-year'),
    rankingYearField: document.getElementById('ranking-year-field'),
    rankingMonth: document.getElementById('ranking-month'),
    rankingMonthField: document.getElementById('ranking-month-field'),
    rankingHelp: document.getElementById('ranking-help'),
    rankingChannelTip: document.getElementById('ranking-channel-tip'),
    rankingMeta: document.getElementById('ranking-meta'),
    rankingSource: document.getElementById('ranking-source'),
    rankingSourceText: document.getElementById('ranking-source-text'),
    openRankingSourceButton: document.getElementById('open-ranking-source'),
    refreshRankingButton: document.getElementById('refresh-ranking'),
    rankingView: document.getElementById('ranking-view'),
    organizerRoot: document.getElementById('organizer-root'),
    organizerBrowseRootButton: document.getElementById('organizer-browse-root'),
    organizerOpenRootButton: document.getElementById('organizer-open-root'),
    organizerCrawlOutput: document.getElementById('organizer-crawl-output'),
    organizerUseLatestOutputButton: document.getElementById('organizer-use-latest-output'),
    organizerLoadCodesButton: document.getElementById('organizer-load-codes'),
    organizerCodeSource: document.getElementById('organizer-code-source'),
    organizerCodeCount: document.getElementById('organizer-code-count'),
    organizerMinSize: document.getElementById('organizer-min-size'),
    organizerSuffix: document.getElementById('organizer-suffix'),
    organizerAdFileActionMove: document.getElementById('organizer-ad-file-action-move'),
    organizerAdFileActionDelete: document.getElementById('organizer-ad-file-action-delete'),
    organizerDryRun: document.getElementById('organizer-dry-run'),
    organizerIncludeSubdirectories: document.getElementById('organizer-include-subdirectories'),
    organizerAdDetectionEnabled: document.getElementById('organizer-ad-detection-enabled'),
    organizerAdDetectionEnable: document.getElementById('organizer-ad-detection-enable'),
    organizerAdDetectionDisable: document.getElementById('organizer-ad-detection-disable'),
    organizerOnnxStatus: document.getElementById('organizer-onnx-status'),
    organizerAdThreshold: document.getElementById('organizer-ad-threshold'),
    organizerAdKeywords: document.getElementById('organizer-ad-keywords'),
    organizerLearningCodes: document.getElementById('organizer-learning-codes'),
    organizerImportAdSamplesButton: document.getElementById('organizer-import-ad-samples'),
    organizerHelpImportAdButton: document.getElementById('organizer-help-import-ad'),
    organizerImportNormalSamplesButton: document.getElementById('organizer-import-normal-samples'),
    organizerHelpImportNormalButton: document.getElementById('organizer-help-import-normal'),
    organizerLearnAdByCodesButton: document.getElementById('organizer-learn-ad-by-codes'),
    organizerHelpLearnAdButton: document.getElementById('organizer-help-learn-ad'),
    organizerLearnNormalByCodesButton: document.getElementById('organizer-learn-normal-by-codes'),
    organizerHelpLearnNormalButton: document.getElementById('organizer-help-learn-normal'),
    organizerRefreshLearningSummaryButton: document.getElementById('organizer-refresh-learning-summary'),
    organizerClearLearningModelButton: document.getElementById('organizer-clear-learning-model'),
    organizerLearningSummary: document.getElementById('organizer-learning-summary'),
    organizerStartButton: document.getElementById('organizer-start'),
    organizerPreviewButton: document.getElementById('organizer-preview'),
    organizerOpenWaitingButton: document.getElementById('organizer-open-waiting'),
    organizerOpenDeleteButton: document.getElementById('organizer-open-delete'),
    organizerOpenIntroAdButton: document.getElementById('organizer-open-intro-ad'),
    organizerOpenReportsButton: document.getElementById('organizer-open-reports'),
    organizerClearLogButton: document.getElementById('organizer-clear-log'),
    organizerExportLogButton: document.getElementById('organizer-export-log'),
    organizerPauseButton: document.getElementById('organizer-pause'),
    organizerStopButton: document.getElementById('organizer-stop'),
    organizerStatusPill: document.getElementById('organizer-status-pill'),
    organizerScanned: document.getElementById('organizer-stat-scanned'),
    organizerVideoTotal: document.getElementById('organizer-stat-video'),
    organizerMatched: document.getElementById('organizer-stat-matched'),
    organizerMovedWaiting: document.getElementById('organizer-stat-waiting'),
    organizerMovedDelete: document.getElementById('organizer-stat-delete'),
    organizerFailed: document.getElementById('organizer-stat-failed'),
    organizerSummaryMessage: document.getElementById('organizer-summary-message'),
    organizerReportPaths: document.getElementById('organizer-report-paths'),
    organizerReviewPanel: document.getElementById('organizer-review-panel'),
    organizerLogView: document.getElementById('organizer-log-view')
  };

  applyStaticText(document);

  const logController = logControllerFactory.createLogController({
    logView: elements.logView,
    logFilePath: elements.logFilePath,
    maxLines: UI_TEXT.limits.maxLogLines,
    defaultHint: UI_TEXT.log.defaultHint,
    logPathPrefix: UI_TEXT.log.createdPrefix,
    truncatedSuffix: UI_TEXT.log.truncatedSuffix,
    visibleLevels: UI_TEXT.log.visibleLevels,
    maxVisibleLength: UI_TEXT.log.maxVisibleLength,
    hiddenKeywords: UI_TEXT.log.hiddenKeywords
  });

  const stateController = stateControllerFactory.createStateController({
    statusPill: elements.statusPill,
    stateMessage: elements.stateMessage,
    startButton: elements.startButton,
    stopButton: elements.stopButton,
    restartButton: elements.restartButton,
    statPage: elements.statPage,
    statQueued: elements.statQueued,
    statAttempted: elements.statAttempted,
    statCompleted: elements.statCompleted,
    currentBox: elements.currentBox,
    currentItemsView: elements.currentItemsView,
    unfinishedBox: elements.unfinishedBox,
    unfinishedItemsView: elements.unfinishedItemsView,
    unfinishedTotalView: elements.unfinishedTotalView,
    duplicateBox: elements.duplicateBox,
    duplicateItemsView: elements.duplicateItemsView,
    duplicateTotalView: elements.duplicateTotalView,
    pageGapBox: elements.pageGapBox,
    pageGapItemsView: elements.pageGapItemsView,
    failedBox: elements.failedBox,
    failedItemsView: elements.failedItemsView,
    statusLabels: STATUS_LABELS,
    defaultMessage: UI_TEXT.state.defaultMessage,
    emptyTexts: {
      active: UI_TEXT.state.activeEmpty,
      unfinished: UI_TEXT.state.unfinishedEmpty,
      duplicate: UI_TEXT.state.duplicateEmpty,
      pageGap: UI_TEXT.state.pageGapEmpty,
      failed: UI_TEXT.state.failedEmpty
    },
    maxPanelItems: UI_TEXT.limits.maxPanelItems,
    renderInterval: Math.max(UI_TEXT.limits.stateRenderInterval || 0, 180),
    failureCategoryLabels: FAILURE_CATEGORY_LABELS,
    stateTexts: {
      failedSummaryPrefix: UI_TEXT.state.failedSummaryPrefix,
      failedSummaryMiddle: UI_TEXT.state.failedSummaryMiddle,
      failedSummarySuffix: UI_TEXT.state.failedSummarySuffix,
      unknownItem: UI_TEXT.state.unknownItem,
      defaultFailureReason: UI_TEXT.state.defaultFailureReason,
      failureCategoryPrefix: UI_TEXT.state.failureCategoryPrefix,
      failureRetryPrefix: UI_TEXT.state.failureRetryPrefix,
      failureManualReview: UI_TEXT.state.failureManualReview,
      failureAdvicePrefix: UI_TEXT.state.failureAdvicePrefix,
      failureTimePrefix: UI_TEXT.state.failureTimePrefix
    }
  });

  const formController = formControllerFactory.createFormController({
    elements,
    desktopApi,
    logController,
    stateController,
    uiText
  });

  const rankingController = rankingControllerFactory.createRankingController({
    elements,
    desktopApi,
    logController,
    uiText,
    formController
  });

  const organizerController = organizerControllerFactory.createOrganizerController({
    elements,
    desktopApi,
    uiText
  });

  let lastAnnouncedLogPath = '';
  const bootstrapRetryDelays = [0, 150, 300, 600, 1000];

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function bindExternalLink(linkElement) {
    if (!linkElement) {
      return;
    }

    linkElement.addEventListener('click', async (event) => {
      const targetUrl = linkElement.href || linkElement.getAttribute('href');
      if (!targetUrl) {
        return;
      }

      event.preventDefault();
      await desktopApi.openExternal(targetUrl);
    });
  }

  bindExternalLink(elements.sourceLink);

  function setWorkspace(targetWorkspace) {
    const showOrganizer = targetWorkspace === 'organizer';

    if (elements.crawlerWorkspace) {
      elements.crawlerWorkspace.classList.toggle('hidden', showOrganizer);
    }

    if (elements.organizerWorkspace) {
      elements.organizerWorkspace.classList.toggle('hidden', !showOrganizer);
    }

    if (elements.navCrawlerButton) {
      elements.navCrawlerButton.classList.toggle('is-active', !showOrganizer);
    }

    if (elements.navOrganizerButton) {
      elements.navOrganizerButton.classList.toggle('is-active', showOrganizer);
    }
  }

  function bindWorkspaceSwitch() {
    if (elements.navCrawlerButton) {
      elements.navCrawlerButton.addEventListener('click', () => setWorkspace('crawler'));
    }

    if (elements.navOrganizerButton) {
      elements.navOrganizerButton.addEventListener('click', () => setWorkspace('organizer'));
    }
  }

  bindWorkspaceSwitch();
  setWorkspace('crawler');

  desktopApi.onLog((payload) => {
    const entries = Array.isArray(payload) ? payload : [payload];

    entries.forEach((entry) => {
      if (!entry) {
        return;
      }

      logController.appendLog(entry.level, entry.message, entry.timestamp);
    });
  });

  desktopApi.onState((state) => {
    stateController.enqueueState({
      status: state.status,
      message: state.message,
      stats: state.stats,
      activeItems: state.activeItems || [],
      duplicateItems: state.duplicateItems || [],
      duplicateItemsTotal:
        state.duplicateItemsTotal ?? (Array.isArray(state.duplicateItems) ? state.duplicateItems.length : 0),
      unfinishedItems: state.unfinishedItems || state.missingItems || [],
      unfinishedItemsTotal:
        state.unfinishedItemsTotal ??
        state.missingItemsTotal ??
        (Array.isArray(state.unfinishedItems) ? state.unfinishedItems.length : 0),
      pageGapItems: state.pageGapItems || [],
      failedDetails: state.failedDetails || [],
      failedDetailsTotal:
        state.failedDetailsTotal ?? (Array.isArray(state.failedDetails) ? state.failedDetails.length : 0)
    });
  });

  desktopApi.onLogContext((context) => {
    logController.updateLogContext(context);

    if (context && context.sessionLogPath && context.sessionLogPath !== lastAnnouncedLogPath) {
      lastAnnouncedLogPath = context.sessionLogPath;
      logController.appendLog(
        'info',
        `${UI_TEXT.log.createdEventPrefix}${context.sessionLogPath}`,
        new Date().toISOString()
      );
    }
  });

  async function bootstrapRenderer() {
    let lastError = null;

    for (let index = 0; index < bootstrapRetryDelays.length; index += 1) {
      if (bootstrapRetryDelays[index] > 0) {
        await delay(bootstrapRetryDelays[index]);
      }

      try {
        await formController.bootstrap();
        await rankingController.bootstrap();
        await organizerController.bootstrap();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    const message = `${UI_TEXT.runtime.bootstrapFailedPrefix}${lastError instanceof Error ? lastError.message : String(lastError)}`;
    console.error(message, lastError);
    logController.appendLog('error', message, new Date().toISOString());
    stateController.setStatus('error', message);
  }

  void bootstrapRenderer();
})(typeof globalThis !== 'undefined' ? globalThis : window);
