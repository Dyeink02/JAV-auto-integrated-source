(function initializeOrganizerProgressController(globalScope) {
  /**
   * Creates the progress sub-controller: status display, statistics, action buttons, learning summary.
   * @param {{ state: object, elements: object, desktopApi: object, messages: object, progressSchema: object, organizerHeroText: object, utils: object, ctrl: object }} deps
   */
  function createOrganizerProgressController(deps) {
    const { state, elements, messages, progressSchema, organizerHeroText, utils, ctrl } = deps;
    const { setDisabled, appendLogLine } = utils;

    function setStatus(status, message = '') {
      const normalizedStatus =
        status === 'running' || status === 'starting' || status === 'completed' || status === 'error'
          ? status
          : 'idle';
      if (!elements.organizerStatusPill) {
        return;
      }
      elements.organizerStatusPill.className = `status-pill ${normalizedStatus}`;
      elements.organizerStatusPill.textContent = message || messages.idle;
    }

    function setSummaryCounts(summary = {}) {
      if (elements.organizerScanned) {
        elements.organizerScanned.textContent = String(summary.scannedTotal ?? 0);
      }
      if (elements.organizerVideoTotal) {
        elements.organizerVideoTotal.textContent = String(summary.videoTotal ?? 0);
      }
      if (elements.organizerMatched) {
        elements.organizerMatched.textContent = String(summary.qualifiedVideo ?? 0);
      }
      if (elements.organizerMovedWaiting) {
        elements.organizerMovedWaiting.textContent = String(summary.movedToWaiting ?? 0);
      }
      if (elements.organizerMovedDelete) {
        elements.organizerMovedDelete.textContent = String(summary.movedToDelete ?? 0);
      }
      if (elements.organizerFailed) {
        elements.organizerFailed.textContent = String(summary.failedOperations ?? 0);
      }
    }

    function setSummaryMessage(message) {
      if (elements.organizerSummaryMessage) {
        elements.organizerSummaryMessage.textContent = message || messages.idle;
      }
    }

    function buildProgressMessage(progress = {}) {
      if (progressSchema && typeof progressSchema.buildProgressMessage === 'function') {
        return progressSchema.buildProgressMessage(progress);
      }
      return '';
    }

    function buildOrganizerProgressSummary(progress = {}) {
      return buildProgressMessage(progress);
    }

    function applyRuntimeProgress(progress = {}) {
      const scope = String(progress.scope || '');
      const phase = String(progress.phase || '');

      if (scope === 'organizer') {
        if (elements.organizerScanned && Number.isFinite(Number(progress.processed))) {
          elements.organizerScanned.textContent = String(progress.processed);
        }
        if (elements.organizerVideoTotal && Number.isFinite(Number(progress.videoTotal))) {
          elements.organizerVideoTotal.textContent = String(progress.videoTotal);
        }
        if (elements.organizerMatched && Number.isFinite(Number(progress.qualifiedVideo))) {
          elements.organizerMatched.textContent = String(progress.qualifiedVideo);
        }
        if (elements.organizerMovedWaiting) {
          if (phase.startsWith('waiting') && Number.isFinite(Number(progress.processed))) {
            elements.organizerMovedWaiting.textContent = String(progress.processed);
          } else if (phase === 'scan-completed' && Number.isFinite(Number(progress.waitingTotal))) {
            elements.organizerMovedWaiting.textContent = String(progress.waitingTotal);
          }
        }
        if (elements.organizerMovedDelete) {
          if (phase.startsWith('delete') && Number.isFinite(Number(progress.processed))) {
            elements.organizerMovedDelete.textContent = String(progress.processed);
          } else if (phase === 'scan-completed' && Number.isFinite(Number(progress.deleteTotal))) {
            elements.organizerMovedDelete.textContent = String(progress.deleteTotal);
          }
        }
        if (elements.organizerFailed && Number.isFinite(Number(progress.failedOperations))) {
          elements.organizerFailed.textContent = String(progress.failedOperations);
        }
      }

      const summaryText = buildProgressMessage(progress);
      if (summaryText) {
        setSummaryMessage(summaryText);
      }
    }

    function setActionButtonState() {
      const disabled = state.running;
      [
        elements.organizerStartButton,
        elements.organizerPreviewButton,
        elements.organizerLoadCodesButton,
        elements.organizerUseLatestOutputButton,
        elements.organizerLearningCodes,
        elements.organizerImportAdSamplesButton,
        elements.organizerHelpImportAdButton,
        elements.organizerImportNormalSamplesButton,
        elements.organizerHelpImportNormalButton,
        elements.organizerLearnAdByCodesButton,
        elements.organizerHelpLearnAdButton,
        elements.organizerLearnNormalByCodesButton,
        elements.organizerHelpLearnNormalButton,
        elements.organizerRefreshLearningSummaryButton,
        elements.organizerClearLearningModelButton,
        elements.organizerAdFileActionMove,
        elements.organizerAdFileActionDelete,
        elements.organizerAdDetectionEnabled,
        elements.organizerAdDetectionEnable,
        elements.organizerAdDetectionDisable,
        elements.organizerAdModelType
      ].forEach((element) => setDisabled(element, disabled));
      if (elements.organizerPauseButton) {
        elements.organizerPauseButton.disabled = !disabled;
        elements.organizerPauseButton.textContent = state.paused ? '继续' : '暂停';
      }
      if (elements.organizerStopButton) {
        elements.organizerStopButton.disabled = !disabled;
      }
      ctrl.applyAdDetectionUiState();
    }

    function renderLearningSummary(summary = null) {
      if (!elements.organizerLearningSummary) {
        return;
      }
      if (!summary) {
        elements.organizerLearningSummary.textContent = '尚未加载学习模型。';
        return;
      }
      const threshold = summary.thresholds && Number.isFinite(summary.thresholds.adScore) ? summary.thresholds.adScore : 60;
      const updatedAt = summary.updatedAt ? new Date(summary.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '-';
      const introTemplateCount = Number(summary.introTemplateCount || 0);
      const activeModelLabel = String(summary.activeModelLabel || summary.activeModel || 'MobileNetV3 Lite');
      const metrics = summary.metrics && typeof summary.metrics === 'object' ? summary.metrics : {};
      const lastLearning = metrics.lastLearning && typeof metrics.lastLearning === 'object' ? metrics.lastLearning : null;
      const observability = lastLearning
        ? `命中率 ${Number(lastLearning.hitRate || 0).toFixed(1)}% / 误判率 ${Number(lastLearning.falsePositiveRate || 0).toFixed(
            1
          )}% / 样本增量=${Number(lastLearning.sampleIncrement || 0)}`
        : '暂无';

      elements.organizerLearningSummary.textContent = [
        `关键词 ${summary.keywordCount || 0}`,
        `广告样本 ${summary.adSampleCount || 0}`,
        `正常样本 ${summary.normalSampleCount || 0}`,
        `片头模板 ${introTemplateCount}`,
        `AI模型 ${activeModelLabel}`,
        `阈值 ${threshold}`,
        `学习指标 ${observability}`,
        `更新时间 ${updatedAt}`
      ].join(' | ');
    }

    function applyOrganizerHeroCopy() {
      const subtitleElement = document.querySelector('#organizer-workspace .hero-subtitle');
      if (subtitleElement) {
        subtitleElement.textContent = organizerHeroText.subtitle;
      }
    }

    function renderOrganizerVersionHistory() {
      const container = document.getElementById('organizer-version-history-list');
      if (!container) return;
      const registry = globalScope.__desktopTextModules || {};
      const items = Array.isArray(registry.VERSION_HISTORY) ? registry.VERSION_HISTORY : [];
      const recentItems = items.slice(-8).reverse();
      utils.clearChildren(container);
      recentItems.forEach((entry) => {
        const li = document.createElement('li');
        const version = document.createElement('strong');
        version.textContent = entry.version || '';
        li.appendChild(version);
        li.appendChild(document.createTextNode(entry.summary || ''));
        container.appendChild(li);
      });
      const scrollContainer = container.parentElement;
      if (scrollContainer) {
        requestAnimationFrame(() => {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        });
      }
    }

    return {
      setStatus,
      setSummaryCounts,
      setSummaryMessage,
      buildProgressMessage,
      buildOrganizerProgressSummary,
      applyRuntimeProgress,
      setActionButtonState,
      renderLearningSummary,
      applyOrganizerHeroCopy,
      renderOrganizerVersionHistory
    };
  }

  globalScope._organizerProgressController = { create: createOrganizerProgressController };
})(typeof globalThis !== 'undefined' ? globalThis : window);
