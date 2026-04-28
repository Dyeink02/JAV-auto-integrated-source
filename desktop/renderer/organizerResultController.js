(function initializeOrganizerResultController(globalScope) {
  /**
   * Creates the result sub-controller: report rendering, review panel, learning operations, guides.
   * @param {{ state: object, elements: object, desktopApi: object, messages: object, STORAGE_KEYS: object, utils: object, ctrl: object }} deps
   */
  function createOrganizerResultController(deps) {
    const { state, elements, desktopApi, messages, STORAGE_KEYS, utils, ctrl } = deps;
    const { appendLogLine, clearChildren, normalizeAdModelType, getErrorMessage } = utils;

    function renderReportFiles(reportFiles = []) {
      if (!elements.organizerReportPaths) {
        return;
      }
      clearChildren(elements.organizerReportPaths);
      if (!Array.isArray(reportFiles) || reportFiles.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'organizer-report-item';
        empty.textContent = '预览模式下不会生成报告文件。';
        elements.organizerReportPaths.appendChild(empty);
        return;
      }
      reportFiles.forEach((filePath) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'organizer-report-item';
        row.textContent = filePath;
        row.addEventListener('click', async () => {
          await desktopApi.openPath(filePath);
        });
        elements.organizerReportPaths.appendChild(row);
      });
    }

    function renderReviewPanel(result = null) {
      if (!elements.organizerReviewPanel) {
        return;
      }
      clearChildren(elements.organizerReviewPanel);
      const safeResult = result && typeof result === 'object' ? result : null;
      if (!safeResult) {
        const empty = document.createElement('p');
        empty.className = 'organizer-review-empty';
        empty.textContent = '整理完成后，这里会显示：遗漏番号、含开头广告补抓、误判复核入口。';
        elements.organizerReviewPanel.appendChild(empty);
        return;
      }
      const reportMap = safeResult.reportMap && typeof safeResult.reportMap === 'object' ? safeResult.reportMap : {};
      const missingDownload =
        safeResult.missingDownload && typeof safeResult.missingDownload === 'object' ? safeResult.missingDownload : {};
      const adRisk = safeResult.adRisk && typeof safeResult.adRisk === 'object' ? safeResult.adRisk : {};
      const rows = [
        {
          title: `遗漏番号：${Number(missingDownload.missingCodeCount || 0)} 条`,
          meta: `补抓磁力：${Number(missingDownload.missingMagnetCount || 0)} 条`,
          reportPath: reportMap.missingMagnets || ''
        },
        {
          title: `含开头广告番号：${Number(adRisk.riskCodeCount || 0)} 条`,
          meta: `补抓磁力：${Number(adRisk.supplementMagnetCount || 0)} 条`,
          reportPath: reportMap.adRiskMagnets || ''
        },
        {
          title: '误判复核入口',
          meta: '打开"含开头广告明细"进行人工复核，并回灌样本。',
          reportPath: reportMap.adRiskDetail || ''
        }
      ];
      rows.forEach((row) => {
        const rowNode = document.createElement('div');
        rowNode.className = 'organizer-review-row';
        const content = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = row.title;
        content.appendChild(title);
        const meta = document.createElement('p');
        meta.className = 'organizer-review-meta';
        meta.textContent = row.meta;
        content.appendChild(meta);
        rowNode.appendChild(content);
        if (row.reportPath) {
          const openButton = document.createElement('button');
          openButton.type = 'button';
          openButton.className = 'ghost-button';
          openButton.textContent = '打开报告';
          openButton.addEventListener('click', async () => {
            await desktopApi.openPath(row.reportPath);
          });
          rowNode.appendChild(openButton);
        }
        elements.organizerReviewPanel.appendChild(rowNode);
      });
    }

    async function showFirstLaunchGuideIfNeeded() {
      if (typeof desktopApi.showAlert !== 'function') {
        return;
      }
      let shown = false;
      try {
        shown = globalThis.localStorage.getItem(STORAGE_KEYS.organizerGuideShown) === '1';
      } catch {
        shown = false;
      }
      if (shown) {
        return;
      }
      await desktopApi.showAlert({
        type: 'info',
        title: '一体化流程引导',
        message: '推荐首次使用流程',
        detail:
          '1）先爬取并导出磁力。\n2）客户下载后把文件集中到同一个根目录。\n3）执行整理，并在复盘面板查看遗漏番号与补抓报告。',
        buttonLabel: '开始使用'
      });
      try {
        globalThis.localStorage.setItem(STORAGE_KEYS.organizerGuideShown, '1');
      } catch {
        // Ignore localStorage write failures in restrictive runtimes.
      }
    }

    async function showLearningGuide(kind) {
      if (typeof desktopApi.showAlert !== 'function') {
        return;
      }
      const title = '样本学习使用说明';
      if (kind === 'import-ad') {
        await desktopApi.showAlert({
          type: 'info',
          title,
          message: '导入广告样本',
          detail:
            '请选择"确认含开头广告"的截图或视频样本。建议优先选择视频开头 3-15 秒画面，并持续补充样本。',
          buttonLabel: '我知道了'
        });
        return;
      }
      if (kind === 'import-normal') {
        await desktopApi.showAlert({
          type: 'info',
          title,
          message: '导入正常样本',
          detail:
            '请选择"确认无开头广告"的正常视频样本。广告/正常样本数量尽量接近，可以降低误判。',
          buttonLabel: '我知道了'
        });
        return;
      }
      await desktopApi.showAlert({
        type: 'info',
        title,
        message: '按番号自动学习',
        detail:
          '先输入番号（逗号或换行分隔），再点击学习。软件会在根目录匹配番号并自动抓取开头帧。',
        buttonLabel: '开始学习'
      });
    }

    async function refreshAdLearningSummary(logMessage = false) {
      if (typeof desktopApi.getAdLearningSummary !== 'function') {
        ctrl.renderLearningSummary(null);
        return null;
      }
      const summary = await desktopApi.getAdLearningSummary();
      state.adSummary = summary || null;
      if (elements.organizerAdThreshold && summary && summary.thresholds && Number.isFinite(summary.thresholds.adScore)) {
        elements.organizerAdThreshold.value = String(summary.thresholds.adScore);
      }
      if (elements.organizerAdModelType && summary) {
        elements.organizerAdModelType.value = normalizeAdModelType(summary.activeModel);
      }
      ctrl.renderLearningSummary(summary);
      ctrl.applyAdDetectionUiState();
      if (logMessage) {
        appendLogLine(elements.organizerLogView, 'info', '广告学习摘要已刷新。');
      }
      return summary;
    }

    async function syncAdLearningModel(options = {}) {
      if (typeof desktopApi.updateAdLearningModel !== 'function') {
        return state.adSummary;
      }
      const learningConfig = ctrl.getLearningConfig();
      const result = await desktopApi.updateAdLearningModel({
        keywords: learningConfig.adKeywords,
        adScore: learningConfig.adThreshold,
        modelType: learningConfig.adModelType
      });
      state.adSummary = result || null;
      ctrl.renderLearningSummary(result);
      ctrl.applyAdDetectionUiState();
      if (options.logSuccess) {
        appendLogLine(
          elements.organizerLogView,
          'info',
          `广告学习策略已同步：阈值 ${learningConfig.adThreshold}，关键词 ${learningConfig.adKeywords || '(空)'}`
        );
      }
      return result;
    }

    async function learnSamplesByCodes(label) {
      if (typeof desktopApi.learnAdSamplesByCodes !== 'function') {
        throw new Error('当前版本未启用"按番号自动学习"能力。');
      }
      await showLearningGuide('learn-by-codes');
      const codes = ctrl.getLearningCodes();
      if (codes.length === 0) {
        throw new Error('请先输入要学习的番号（支持逗号或换行分隔）。');
      }
      const sourceRoot = String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim();
      if (!sourceRoot) {
        throw new Error(messages.rootRequired);
      }
      const result = await desktopApi.learnAdSamplesByCodes({
        label,
        codes,
        rootPath: sourceRoot,
        includeSubdirectories: true,
        modelType: ctrl.getLearningConfig().adModelType
      });
      state.adSummary = result && result.summary ? result.summary : state.adSummary;
      ctrl.renderLearningSummary(state.adSummary);
      const matchedVideoCount = Number(result && result.matchedVideoCount) || 0;
      const importedSampleCount = Number(result && result.importedSampleCount) || 0;
      const missingCodes = Array.isArray(result && result.missingCodes) ? result.missingCodes : [];
      appendLogLine(
        elements.organizerLogView,
        'info',
        `${label === 'normal' ? '正常' : '广告'}按番号学习完成：命中视频 ${matchedVideoCount}，新增样本 ${importedSampleCount}，未命中番号 ${missingCodes.length}`
      );
      if (missingCodes.length > 0) {
        appendLogLine(elements.organizerLogView, 'warn', `未匹配到的番号：${missingCodes.join(', ')}`);
      }
    }

    async function runLearningTask(label) {
      if (state.running) {
        appendLogLine(elements.organizerLogView, 'warn', '当前已有任务在运行，请等待完成后再发起新的学习任务。');
        return;
      }
      const readableLabel = label === 'normal' ? '正常样本' : '广告样本';
      state.running = true;
      state.activeTask = 'learning';
      ctrl.setActionButtonState();
      ctrl.setStatus('running', `按番号学习进行中（${readableLabel}）...`);
      ctrl.setSummaryMessage(`按番号学习已启动（${readableLabel}）。`);
      appendLogLine(elements.organizerLogView, 'info', `开始按番号学习：${readableLabel}`);
      try {
        await learnSamplesByCodes(label);
        ctrl.setStatus('completed', `学习完成：${readableLabel}`);
      } catch (error) {
        const message = getErrorMessage(error);
        appendLogLine(elements.organizerLogView, 'error', message);
        ctrl.setStatus('error', message);
        ctrl.setSummaryMessage(message);
      } finally {
        state.running = false;
        state.activeTask = '';
        ctrl.setActionButtonState();
      }
    }

    async function importLearningSamples(label) {
      if (typeof desktopApi.chooseLearningSamples !== 'function' || typeof desktopApi.importAdLearningSamples !== 'function') {
        throw new Error('当前版本未启用广告学习导入能力。');
      }
      await showLearningGuide(label === 'normal' ? 'import-normal' : 'import-ad');
      const samplePaths = await desktopApi.chooseLearningSamples();
      if (!Array.isArray(samplePaths) || samplePaths.length === 0) {
        appendLogLine(elements.organizerLogView, 'info', '未选择样本文件。');
        return;
      }
      const result = await desktopApi.importAdLearningSamples({
        label,
        samplePaths,
        modelType: ctrl.getLearningConfig().adModelType
      });
      state.adSummary = result && result.summary ? result.summary : state.adSummary;
      ctrl.renderLearningSummary(state.adSummary);
      const importedCount = Array.isArray(result && result.imported) ? result.imported.length : 0;
      const skippedCount = Array.isArray(result && result.skipped) ? result.skipped.length : 0;
      appendLogLine(
        elements.organizerLogView,
        'info',
        `${label === 'normal' ? '正常' : '广告'}样本导入完成：成功 ${importedCount}，跳过 ${skippedCount}`
      );
    }

    return {
      renderReportFiles,
      renderReviewPanel,
      showFirstLaunchGuideIfNeeded,
      showLearningGuide,
      refreshAdLearningSummary,
      syncAdLearningModel,
      learnSamplesByCodes,
      runLearningTask,
      importLearningSamples
    };
  }

  globalScope._organizerResultController = { create: createOrganizerResultController };
})(typeof globalThis !== 'undefined' ? globalThis : window);
