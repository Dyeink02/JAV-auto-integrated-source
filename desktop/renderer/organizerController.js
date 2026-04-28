(function initializeOrganizerController(globalScope) {
  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function toSafeInteger(value, fallback, minimum = 1, maximum = Number.POSITIVE_INFINITY) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
      return Math.max(minimum, Math.min(maximum, fallback));
    }
    return Math.max(minimum, Math.min(maximum, parsed));
  }

  function normalizeKeywordText(rawValue) {
    const rawText = String(rawValue || '').trim();
    if (!rawText) {
      return [];
    }
    return Array.from(
      new Set(
        rawText
          .split(/[\r\n,，;；\s]+/)
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
    );
  }

  function normalizeAdModelType(rawValue) {
    // Only one model now: ONNX MobileNetV3
    return 'mobile-net-v3-onnx';
  }

  function appendLogLine(logView, level, message, timestamp) {
    if (!logView) {
      return;
    }
    const line = document.createElement('p');
    line.className = `log-line ${level || 'info'}`;
    const timeLabel = timestamp
      ? new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
      : new Date().toLocaleTimeString('zh-CN', { hour12: false });
    line.textContent = `[${timeLabel}] ${message}`;
    logView.appendChild(line);
    logView.scrollTop = logView.scrollHeight;
  }

  function clearChildren(node) {
    while (node && node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function setDisabled(element, disabled) {
    if (element) {
      element.disabled = disabled;
    }
  }

  function createOrganizerController(options) {
    const { elements, desktopApi } = options;
    const progressSchema = globalScope.desktopProgressSchema || null;
    const STORAGE_KEYS = {
      organizerGuideShown: 'jav.organizer.guide.v1.shown'
    };
    const messages = {
      idle: '等待开始整理。',
      running: '正在整理视频文件，请稍候...',
      complete: '视频整理完成。',
      previewComplete: '预览扫描完成，未移动任何文件。',
      ready: '视频整理模块已就绪。',
      rootRequired: '请先选择要整理的根目录。',
      minSizeInvalid: '最小体积必须大于等于 1MB。',
      crawlOutputRequired: '请先填写或自动带入爬虫结果目录。'
    };

    const state = {
      running: false,
      paused: false,
      activeTask: '',
      expectedCodes: [],
      expectedCodeEntries: [],
      codeSourcePath: '',
      adSummary: null,
      latestResult: null
    };
    const organizerHeroText = {
      subtitle: '基于JAV自动化整理归纳视频软件。'
    };

    const utils = {
      getErrorMessage, toSafeInteger, normalizeKeywordText, normalizeAdModelType,
      appendLogLine, clearChildren, setDisabled
    };

    // Shared controller API — populated after all sub-controllers are created
    const ctrl = {};

    const sharedDeps = { state, elements, desktopApi, messages, progressSchema, STORAGE_KEYS, organizerHeroText, utils, ctrl };

    // Create sub-controllers
    const formMethods = globalScope._organizerFormController.create(sharedDeps);
    const progressMethods = globalScope._organizerProgressController.create(sharedDeps);
    const resultMethods = globalScope._organizerResultController.create(sharedDeps);

    // Merge all sub-controller methods into shared ctrl for cross-module calls
    Object.assign(ctrl, formMethods, progressMethods, resultMethods);

    // ── Orchestration functions (remain in main controller) ──────────────

    async function runOrganizerTask(dryRun) {
      if (state.running) {
        return;
      }
      try {
        const settings = ctrl.getSettings(dryRun);
        ctrl.validateSettings(settings);
        if (!dryRun && settings.adFileAction === 'delete-directly') {
          const confirmed = globalThis.confirm(
            '你已选择"直接删除广告文件"。此操作不可撤销，是否继续？'
          );
          if (!confirmed) {
            appendLogLine(elements.organizerLogView, 'warn', '用户取消操作（未确认直接删除）。');
            return;
          }
        }
        await ctrl.syncAdLearningModel({ logSuccess: false });

        state.running = true;
        state.activeTask = 'organizer';
        ctrl.setActionButtonState();
        ctrl.setStatus('running', messages.running);
        appendLogLine(
          elements.organizerLogView,
          'info',
          `${
            dryRun ? '开始预览扫描（不移动文件）...' : '开始执行整理（将处理文件）...'
          } 广告处理方式：${ctrl.getAdFileActionLabel(settings.adFileAction)}。`
        );

        const result = await desktopApi.runOrganizer(settings);
        state.latestResult = result || null;
        const summary = result && result.summary ? result.summary : {};
        ctrl.setSummaryCounts(summary);
        ctrl.renderReportFiles(result && result.reportFiles ? result.reportFiles : []);
        ctrl.renderReviewPanel(result);

        const finishMessage = dryRun ? messages.previewComplete : messages.complete;
        ctrl.setSummaryMessage(
          `${finishMessage} 待整理 ${summary.movedToWaiting || 0} 个，待删除 ${summary.movedToDelete || 0} 个，含开头广告 ${
            summary.movedToIntroAd || 0
          } 个，直接删除 ${summary.deletedDirectly || 0} 个，遗漏番号 ${summary.missingCodeCount || 0} 条。`
        );
        appendLogLine(elements.organizerLogView, 'info', finishMessage);
        ctrl.setStatus('completed', finishMessage);
      } catch (error) {
        const message = getErrorMessage(error);
        appendLogLine(elements.organizerLogView, 'error', message);
        ctrl.setSummaryMessage(message);
        ctrl.setStatus('error', message);
      } finally {
        state.running = false;
        state.paused = false;
        state.activeTask = '';
        ctrl.setActionButtonState();
      }
    }

    async function applyLatestCrawlOutput() {
      const context = await desktopApi.getIntegrationContext();
      const preferredOutput = String(context && context.preferredOutputDir ? context.preferredOutputDir : '').trim();
      if (preferredOutput && elements.organizerCrawlOutput) {
        elements.organizerCrawlOutput.value = preferredOutput;
        appendLogLine(elements.organizerLogView, 'info', `已填入最近爬虫结果目录：${preferredOutput}`);
      }
    }

    async function loadExpectedCodes() {
      const outputDir = String(elements.organizerCrawlOutput && elements.organizerCrawlOutput.value ? elements.organizerCrawlOutput.value : '').trim();
      if (!outputDir) {
        throw new Error(messages.crawlOutputRequired);
      }
      const result = await desktopApi.loadCrawlFilmCodes({ outputDir });
      state.expectedCodes = Array.isArray(result && result.codes) ? result.codes : [];
      state.expectedCodeEntries = Array.isArray(result && result.codeEntries) ? result.codeEntries : [];
      state.codeSourcePath = String(result && result.filmDataPath ? result.filmDataPath : '');
      ctrl.updateCodeMetaView({
        codeCount: state.expectedCodes.length,
        sourcePath: state.codeSourcePath
      });
      appendLogLine(
        elements.organizerLogView,
        'info',
        `番号名单加载完成：${state.expectedCodes.length} 条（${state.codeSourcePath || outputDir}）`
      );
    }

    // Also add orchestration functions to ctrl for cross-module access
    ctrl.runOrganizerTask = runOrganizerTask;
    ctrl.applyLatestCrawlOutput = applyLatestCrawlOutput;
    ctrl.loadExpectedCodes = loadExpectedCodes;

    function bindEvents() {
      if (elements.organizerBrowseRootButton) {
        elements.organizerBrowseRootButton.addEventListener('click', async () => {
          try {
            const selected = await desktopApi.chooseOrganizerRoot();
            if (!selected) return;
            elements.organizerRoot.value = selected;
            appendLogLine(elements.organizerLogView, 'info', `已选择目标目录：${selected}`);
          } catch (error) {
            appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error));
          }
        });
      }
      if (elements.organizerUseLatestOutputButton) {
        elements.organizerUseLatestOutputButton.addEventListener('click', async () => {
          try { await applyLatestCrawlOutput(); } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerLoadCodesButton) {
        elements.organizerLoadCodesButton.addEventListener('click', async () => {
          try { await loadExpectedCodes(); } catch (error) {
            appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error));
            ctrl.updateCodeMetaView({ codeCount: state.expectedCodes.length, sourcePath: state.codeSourcePath });
          }
        });
      }
      if (elements.organizerImportAdSamplesButton) {
        elements.organizerImportAdSamplesButton.addEventListener('click', async () => {
          try { await ctrl.importLearningSamples('ad'); } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerHelpImportAdButton) {
        elements.organizerHelpImportAdButton.addEventListener('click', async () => { await ctrl.showLearningGuide('import-ad'); });
      }
      if (elements.organizerImportNormalSamplesButton) {
        elements.organizerImportNormalSamplesButton.addEventListener('click', async () => {
          try { await ctrl.importLearningSamples('normal'); } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerHelpImportNormalButton) {
        elements.organizerHelpImportNormalButton.addEventListener('click', async () => { await ctrl.showLearningGuide('import-normal'); });
      }
      if (elements.organizerLearnAdByCodesButton) {
        elements.organizerLearnAdByCodesButton.addEventListener('click', async () => { await ctrl.runLearningTask('ad'); });
      }
      if (elements.organizerHelpLearnAdButton) {
        elements.organizerHelpLearnAdButton.addEventListener('click', async () => { await ctrl.showLearningGuide('learn-by-codes'); });
      }
      if (elements.organizerLearnNormalByCodesButton) {
        elements.organizerLearnNormalByCodesButton.addEventListener('click', async () => { await ctrl.runLearningTask('normal'); });
      }
      if (elements.organizerHelpLearnNormalButton) {
        elements.organizerHelpLearnNormalButton.addEventListener('click', async () => { await ctrl.showLearningGuide('learn-by-codes'); });
      }
      if (elements.organizerRefreshLearningSummaryButton) {
        elements.organizerRefreshLearningSummaryButton.addEventListener('click', async () => {
          try { await ctrl.syncAdLearningModel({ logSuccess: true }); await ctrl.refreshAdLearningSummary(true); } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerClearLearningModelButton) {
        elements.organizerClearLearningModelButton.addEventListener('click', async () => {
          if (typeof desktopApi.clearAdLearningModel !== 'function') return;
          const confirmed = globalThis.confirm('确定要删除所有学习摘要吗？\n\n所有以往学习过的广告/正常样本、片头模板将被永久清空，该操作不可撤销。');
          if (!confirmed) return;
          try {
            const summary = await desktopApi.clearAdLearningModel();
            state.adSummary = summary || null;
            ctrl.renderLearningSummary(summary);
            appendLogLine(elements.organizerLogView, 'info', '已删除所有学习摘要，模型已重置为默认状态。');
          } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerAdDetectionEnabled) {
        elements.organizerAdDetectionEnabled.addEventListener('change', () => {
          if (elements.organizerAdDetectionEnable) elements.organizerAdDetectionEnable.checked = Boolean(elements.organizerAdDetectionEnabled.checked);
          if (elements.organizerAdDetectionDisable) elements.organizerAdDetectionDisable.checked = !elements.organizerAdDetectionEnabled.checked;
          ctrl.applyAdDetectionUiState();
        });
      }
      if (elements.organizerAdDetectionEnable) {
        elements.organizerAdDetectionEnable.addEventListener('change', () => {
          if (!elements.organizerAdDetectionEnable.checked) return;
          if (elements.organizerAdDetectionEnabled) elements.organizerAdDetectionEnabled.checked = true;
          if (elements.organizerAdDetectionDisable) elements.organizerAdDetectionDisable.checked = false;
          ctrl.applyAdDetectionUiState();
        });
      }
      if (elements.organizerAdDetectionDisable) {
        elements.organizerAdDetectionDisable.addEventListener('change', () => {
          if (!elements.organizerAdDetectionDisable.checked) return;
          if (elements.organizerAdDetectionEnabled) elements.organizerAdDetectionEnabled.checked = false;
          if (elements.organizerAdDetectionEnable) elements.organizerAdDetectionEnable.checked = false;
          ctrl.applyAdDetectionUiState();
        });
      }
      if (elements.organizerAdModelType) {
        elements.organizerAdModelType.addEventListener('change', () => {
          elements.organizerAdModelType.value = normalizeAdModelType(elements.organizerAdModelType.value);
        });
      }
      if (elements.organizerOpenRootButton) {
        elements.organizerOpenRootButton.addEventListener('click', async () => {
          const rootPath = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
          if (!rootPath) { appendLogLine(elements.organizerLogView, 'warn', messages.rootRequired); return; }
          await desktopApi.openOrganizerPath(rootPath, 'root');
        });
      }
      if (elements.organizerOpenWaitingButton) {
        elements.organizerOpenWaitingButton.addEventListener('click', async () => {
          const rootPath = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
          if (!rootPath) { appendLogLine(elements.organizerLogView, 'warn', messages.rootRequired); return; }
          await desktopApi.openOrganizerPath(rootPath, 'waiting');
        });
      }
      if (elements.organizerOpenDeleteButton) {
        elements.organizerOpenDeleteButton.addEventListener('click', async () => {
          const rootPath = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
          if (!rootPath) { appendLogLine(elements.organizerLogView, 'warn', messages.rootRequired); return; }
          await desktopApi.openOrganizerPath(rootPath, 'delete');
        });
      }
      if (elements.organizerOpenIntroAdButton) {
        elements.organizerOpenIntroAdButton.addEventListener('click', async () => {
          const rootPath = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
          if (!rootPath) { appendLogLine(elements.organizerLogView, 'warn', messages.rootRequired); return; }
          await desktopApi.openOrganizerPath(rootPath, 'intro-ad');
        });
      }
      if (elements.organizerOpenReportsButton) {
        elements.organizerOpenReportsButton.addEventListener('click', async () => {
          const rootPath = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
          if (!rootPath) { appendLogLine(elements.organizerLogView, 'warn', messages.rootRequired); return; }
          await desktopApi.openOrganizerPath(rootPath, 'reports');
        });
      }
      if (elements.organizerStartButton) {
        elements.organizerStartButton.addEventListener('click', async () => {
          await runOrganizerTask(Boolean(elements.organizerDryRun && elements.organizerDryRun.checked));
        });
      }
      if (elements.organizerPreviewButton) {
        elements.organizerPreviewButton.addEventListener('click', async () => { await runOrganizerTask(true); });
      }
      if (elements.organizerClearLogButton) {
        elements.organizerClearLogButton.addEventListener('click', () => {
          clearChildren(elements.organizerLogView);
          appendLogLine(elements.organizerLogView, 'info', '整理日志已清空。');
        });
      }
      if (elements.organizerExportLogButton) {
        elements.organizerExportLogButton.addEventListener('click', async () => {
          if (typeof desktopApi.exportOrganizerLog !== 'function') return;
          const logLines = elements.organizerLogView ? Array.from(elements.organizerLogView.querySelectorAll('.log-line')) : [];
          if (logLines.length === 0) { appendLogLine(elements.organizerLogView, 'warn', '当前无日志内容可导出。'); return; }
          const content = logLines.map((el) => el.textContent || '').join('\n');
          try {
            const result = await desktopApi.exportOrganizerLog(content);
            if (result && result.saved) appendLogLine(elements.organizerLogView, 'info', `日志已导出至：${result.filePath}`);
          } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerPauseButton) {
        elements.organizerPauseButton.addEventListener('click', async () => {
          if (!state.running || typeof desktopApi.pauseOrganizer !== 'function') return;
          try {
            const result = await desktopApi.pauseOrganizer();
            state.paused = Boolean(result && result.paused);
            ctrl.setActionButtonState();
          } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
      if (elements.organizerStopButton) {
        elements.organizerStopButton.addEventListener('click', async () => {
          if (!state.running || typeof desktopApi.stopOrganizer !== 'function') return;
          const confirmed = globalThis.confirm('确定要停止当前整理任务吗？');
          if (!confirmed) return;
          try {
            await desktopApi.stopOrganizer();
            state.paused = false;
            ctrl.setActionButtonState();
          } catch (error) { appendLogLine(elements.organizerLogView, 'error', getErrorMessage(error)); }
        });
      }
    }

    function bindIpcEvents() {
      if (typeof desktopApi.onOrganizerLog === 'function') {
        desktopApi.onOrganizerLog((payload) => {
          const level = String(payload && payload.level ? payload.level : 'info');
          const message = String(payload && payload.message ? payload.message : '');
          const timestamp = payload && payload.timestamp ? payload.timestamp : undefined;
          appendLogLine(elements.organizerLogView, level, message, timestamp);
        });
      }
      if (typeof desktopApi.onOrganizerState === 'function') {
        desktopApi.onOrganizerState((payload) => {
          if (!payload || typeof payload !== 'object') return;
          const mode = String(payload.mode || '');
          const status = String(payload.status || '');
          if (mode === 'organizer-progress') {
            ctrl.applyRuntimeProgress(payload.progress || payload);
            return;
          }
          if (status === 'completed') {
            state.running = false;
            state.paused = false;
            state.activeTask = '';
            ctrl.setActionButtonState();
            return;
          }
          if (status === 'error') {
            state.running = false;
            state.paused = false;
            state.activeTask = '';
            ctrl.setActionButtonState();
            const message = String(payload.message || '');
            if (message) {
              ctrl.setStatus('error', message);
              ctrl.setSummaryMessage(message);
            }
          }
        });
      }
    }

    async function bootstrap() {
      const settings = await desktopApi.getSettings();
      ctrl.applyOrganizerHeroCopy();
      ctrl.renderOrganizerVersionHistory();

      const registry = globalScope.__desktopTextModules || {};
      const appInfo = registry.APP_INFO || {};
      const organizerVersionBadge = document.getElementById('organizer-version-badge');
      if (organizerVersionBadge && appInfo.version) {
        organizerVersionBadge.textContent = `v${appInfo.version}`;
      }

      if (elements.organizerRoot) elements.organizerRoot.value = settings.organizerRoot || '';
      if (elements.organizerMinSize) elements.organizerMinSize.value = String(toSafeInteger(settings.organizerMinSizeMB, 100, 1));
      if (elements.organizerSuffix) elements.organizerSuffix.value = String(settings.organizerSuffix || '-A');
      const normalizedAdFileAction = ctrl.normalizeAdFileAction(settings.organizerAdFileAction);
      if (elements.organizerAdFileActionMove) elements.organizerAdFileActionMove.checked = normalizedAdFileAction !== 'delete-directly';
      if (elements.organizerAdFileActionDelete) elements.organizerAdFileActionDelete.checked = normalizedAdFileAction === 'delete-directly';
      if (elements.organizerDryRun) elements.organizerDryRun.checked = Boolean(settings.organizerDryRun);
      if (elements.organizerIncludeSubdirectories) elements.organizerIncludeSubdirectories.checked = settings.organizerIncludeSubdirectories !== false;
      if (elements.organizerCrawlOutput) {
        elements.organizerCrawlOutput.value = String(settings.organizerCrawlOutput || '').trim() || String(settings.output || '').trim();
      }
      if (elements.organizerAdDetectionEnabled) elements.organizerAdDetectionEnabled.checked = settings.organizerAdDetectionEnabled !== false;
      if (elements.organizerAdDetectionEnable) elements.organizerAdDetectionEnable.checked = settings.organizerAdDetectionEnabled !== false;
      if (elements.organizerAdDetectionDisable) elements.organizerAdDetectionDisable.checked = settings.organizerAdDetectionEnabled === false;
      if (elements.organizerAdModelType) elements.organizerAdModelType.value = normalizeAdModelType(settings.organizerAdModelType);
      if (elements.organizerAdThreshold) elements.organizerAdThreshold.value = String(toSafeInteger(settings.organizerAdThreshold, 60, 1, 100));
      if (elements.organizerAdKeywords) elements.organizerAdKeywords.value = String(settings.organizerAdKeywords || '');
      if (elements.organizerLearningCodes) elements.organizerLearningCodes.value = '';

      bindEvents();
      bindIpcEvents();
      ctrl.setSummaryCounts({});
      ctrl.renderReportFiles([]);
      ctrl.renderReviewPanel(null);
      ctrl.setSummaryMessage(messages.idle);
      ctrl.setStatus('idle', messages.idle);
      ctrl.updateCodeMetaView({ codeCount: 0, sourcePath: '' });
      ctrl.renderLearningSummary(null);
      appendLogLine(elements.organizerLogView, 'info', messages.ready);
      ctrl.applyAdDetectionUiState();

      await ctrl.refreshAdLearningSummary(false).catch(() => {});
      await applyLatestCrawlOutput().catch(() => {});
      await ctrl.showFirstLaunchGuideIfNeeded().catch(() => {});
    }

    return {
      bootstrap
    };
  }

  globalScope.desktopOrganizerController = {
    createOrganizerController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
