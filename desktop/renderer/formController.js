(function initializeFormController(globalScope) {
  /**
   * formController.js
   * 表单控制器门面：模板应用、事件绑定、初始化引导。
   * 子模块：formProxyValidator.js, formFieldHelpers.js
   */

  const { createProxyValidator } = globalScope.desktopFormProxyValidator;
  const { getErrorMessage, createMagnetValidator, createSettingsHelper } = globalScope.desktopFormFieldHelpers;

  function createFormController(options) {
    const { elements, desktopApi, logController, stateController, uiText } = options;
    const { UI_TEXT, TASK_TEMPLATES } = uiText;

    // 初始化子模块
    const proxyValidator = createProxyValidator({ elements, desktopApi, UI_TEXT });
    const magnetValidator = createMagnetValidator({ elements, desktopApi, UI_TEXT });
    const settingsHelper = createSettingsHelper({ elements, UI_TEXT, TASK_TEMPLATES });

    function applyBackgroundImage(backgroundImageUrl = '') {
      if (backgroundImageUrl) {
        const safeUrl = backgroundImageUrl.replace(/['"()\\]/g, (ch) => '\\' + ch.charCodeAt(0).toString(16).padStart(2, '0'));
        document.documentElement.style.setProperty('--page-backdrop-image', `url("${safeUrl}")`);
      } else {
        document.documentElement.style.removeProperty('--page-backdrop-image');
      }

      if (elements.resetBackgroundButton) {
        elements.resetBackgroundButton.disabled = !backgroundImageUrl;
      }
    }

    function applyTemplate(templateKey, templateOptions = {}) {
      const template = TASK_TEMPLATES[templateKey] || TASK_TEMPLATES.balanced;
      const { keepLimit = true, keepBase = true, keepOutput = true } = templateOptions;

      elements.taskTemplate.value = templateKey;
      elements.parallel.value = String(template.parallel);
      elements.delay.value = String(template.delay);
      elements.timeout.value = String(template.timeout);
      elements.itemsPerPage.value = String(template.itemsPerPage);
      elements.cloudflare.checked = template.cloudflare;
      elements.secondValidation.checked = template.secondValidation;

      if (!keepLimit) elements.limit.value = '0';
      if (!keepBase) elements.base.value = '';
      if (!keepOutput) elements.output.value = '';

      refreshSuggestedPages();
    }

    function refreshSuggestedPages() {
      const limit = Number(elements.limit.value || 0);
      const totalPages = Number(elements.totalPages.value || 0);
      const itemsPerPage = settingsHelper.getItemsPerPage();
      const suggestion = settingsHelper.getSuggestedPages(limit, itemsPerPage);

      if (!suggestion) {
        elements.totalPagesAdvice.textContent = UI_TEXT.advice.defaultPrimary;
        elements.totalPagesMeta.textContent = `${UI_TEXT.advice.defaultSecondaryPrefix}${itemsPerPage}${UI_TEXT.advice.defaultSecondarySuffix}`;
        elements.useSuggestedPagesButton.disabled = true;
        return;
      }

      elements.totalPagesAdvice.textContent = `${UI_TEXT.advice.suggestedPagesPrefix}${suggestion.pages}${UI_TEXT.advice.suggestedPagesSuffix}`;
      elements.totalPagesMeta.textContent =
        `${UI_TEXT.advice.lastPageEstimatePrefix}${itemsPerPage}${UI_TEXT.advice.lastPageEstimateMiddle}${suggestion.lastPageCount}${UI_TEXT.advice.lastPageEstimateSuffix}` +
        (totalPages > 0
          ? ` ${UI_TEXT.advice.manualPagesPrefix}${totalPages}${UI_TEXT.advice.manualPagesSuffix}`
          : '');
      elements.useSuggestedPagesButton.disabled = false;
    }

    function bindBaseUrlChips() {
      elements.baseUrlHints.addEventListener('click', (event) => {
        const chip = event.target.closest('.base-url-chip');
        if (!chip) return;

        const url = chip.dataset.url || '';
        if (!url) return;

        if (elements.base.value !== url) {
          elements.base.value = url;
          elements.base.dispatchEvent(new Event('input', { bubbles: true }));
          elements.base.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }

    function getLookupContext() {
      return {
        preferredBase: elements.base.value.trim(),
        magnetOnly: elements.nomag.checked
      };
    }

    function applyActressLookupResult(result = {}) {
      const fillCount =
        Number.isFinite(result.fillCount) && result.fillCount >= 0 ? result.fillCount : result.preferredCount;

      if (result.resolvedBase) elements.base.value = String(result.resolvedBase).trim();
      if (Number.isFinite(result.itemsPerPage) && result.itemsPerPage > 0) elements.itemsPerPage.value = String(result.itemsPerPage);
      if (Number.isFinite(fillCount) && fillCount >= 0) elements.limit.value = String(fillCount);
      if (Number.isFinite(result.totalPages) && result.totalPages >= 0) elements.totalPages.value = String(result.totalPages);

      refreshSuggestedPages();
    }

    function bindEvents() {
      elements.limit.addEventListener('input', refreshSuggestedPages);
      elements.totalPages.addEventListener('input', refreshSuggestedPages);
      elements.itemsPerPage.addEventListener('input', refreshSuggestedPages);
      elements.base.addEventListener('input', () => {
        refreshSuggestedPages();
        if (elements.proxy.value.trim()) proxyValidator.scheduleValidation(300);
        proxyValidator.scheduleAutoValidation();
      });
      elements.proxy.addEventListener('input', () => {
        proxyValidator.scheduleValidation();
        proxyValidator.scheduleAutoValidation();
      });
      elements.proxy.addEventListener('blur', () => {
        if (!elements.proxy.value.trim()) {
          proxyValidator.setStatus('empty');
          proxyValidator.scheduleAutoValidation();
          return;
        }
        void proxyValidator.validate(elements.proxy.value.trim());
        proxyValidator.scheduleAutoValidation();
      });

      elements.taskTemplate.addEventListener('change', () => {
        applyTemplate(elements.taskTemplate.value);
        logController.appendLog(
          'info',
          `${UI_TEXT.messages.templateAppliedPrefix}${TASK_TEMPLATES[elements.taskTemplate.value]?.label || TASK_TEMPLATES.balanced.label}`,
          new Date().toISOString()
        );
      });

      elements.useSuggestedPagesButton.addEventListener('click', () => {
        const suggestion = settingsHelper.getSuggestedPages(Number(elements.limit.value || 0), settingsHelper.getItemsPerPage());
        if (!suggestion) return;

        elements.totalPages.value = String(suggestion.pages);
        refreshSuggestedPages();
        logController.appendLog(
          'info',
          `${UI_TEXT.messages.suggestedPagesAppliedPrefix}${suggestion.pages}${UI_TEXT.messages.suggestedPagesAppliedSuffix}`,
          new Date().toISOString()
        );
      });

      elements.startButton.addEventListener('click', async () => {
        try {
          const settings = settingsHelper.getSettings();
          settingsHelper.validateSettings(settings);
          settings.magnetExcludeKeywords = await magnetValidator.ensureReady(settings.magnetExcludeKeywords);
          await proxyValidator.ensureReady(settings.proxy);
          logController.appendLog('info', UI_TEXT.messages.startRunning, new Date().toISOString());
          await desktopApi.startCrawl(settings);
        } catch (error) {
          const message = getErrorMessage(error);
          logController.appendLog('error', message, new Date().toISOString());
          stateController.setStatus('error', message);
        }
      });

      elements.restartButton.addEventListener('click', async () => {
        try {
          const settings = settingsHelper.getSettings();
          settingsHelper.validateSettings(settings);
          settings.magnetExcludeKeywords = await magnetValidator.ensureReady(settings.magnetExcludeKeywords);
          await proxyValidator.ensureReady(settings.proxy);
          logController.appendLog('warn', UI_TEXT.messages.restartRunning, new Date().toISOString());
          const result = await desktopApi.restartCrawl(settings);

          if (result && result.restarting) {
            logController.appendLog('info', UI_TEXT.messages.restartQueued, new Date().toISOString());
          } else {
            logController.appendLog('info', UI_TEXT.messages.restartStarted, new Date().toISOString());
          }
        } catch (error) {
          const message = getErrorMessage(error);
          logController.appendLog('error', message, new Date().toISOString());
          stateController.setStatus('error', message);
        }
      });

      elements.stopButton.addEventListener('click', async () => {
        if (elements.stopButton.disabled) return;
        elements.stopButton.disabled = true;
        logController.appendLog('warn', UI_TEXT.messages.stopRequested, new Date().toISOString());
        try {
          await desktopApi.stopCrawl();
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.browseOutputButton.addEventListener('click', async () => {
        try {
          const selected = await desktopApi.chooseOutput();
          if (selected) {
            elements.output.value = selected;
            logController.appendLog('info', `${UI_TEXT.messages.outputSelectedPrefix}${selected}`, new Date().toISOString());
          }
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.chooseBackgroundButton.addEventListener('click', async () => {
        try {
          const nextSettings = await desktopApi.chooseBackgroundImage();
          if (!nextSettings) return;
          applyBackgroundImage(nextSettings.backgroundImageUrl);
          if (nextSettings.backgroundImage) {
            logController.appendLog('info', `${UI_TEXT.messages.backgroundSelectedPrefix}${nextSettings.backgroundImage}`, new Date().toISOString());
          }
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.resetBackgroundButton.addEventListener('click', async () => {
        try {
          const nextSettings = await desktopApi.clearBackgroundImage();
          applyBackgroundImage(nextSettings && nextSettings.backgroundImageUrl);
          logController.appendLog('info', UI_TEXT.messages.backgroundReset, new Date().toISOString());
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.openOutputButton.addEventListener('click', async () => {
        try {
          const opened = await desktopApi.openOutputDir(elements.output.value.trim());
          if (opened) {
            logController.appendLog('info', `${UI_TEXT.messages.outputOpenedPrefix}${opened}`, new Date().toISOString());
          }
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.openMagnetFileButton.addEventListener('click', async () => {
        try {
          const opened = await desktopApi.openMagnetFile(elements.output.value.trim());
          if (opened) {
            logController.appendLog('info', `${UI_TEXT.messages.magnetOpenedPrefix}${opened}`, new Date().toISOString());
          }
        } catch (error) {
          logController.appendLog('warn', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.openLogFolderButton.addEventListener('click', async () => {
        const opened = await desktopApi.openLogFolder();
        if (opened) {
          logController.appendLog('info', `${UI_TEXT.messages.logFolderOpenedPrefix}${opened}`, new Date().toISOString());
        }
      });

      elements.updateAntiBlockButton.addEventListener('click', async () => {
        try {
          const settings = settingsHelper.getSettings();
          logController.appendLog('info', UI_TEXT.messages.antiBlockUpdating, new Date().toISOString());
          const result = await desktopApi.updateAntiBlock(settings);
          logController.appendLog(
            'info',
            `${UI_TEXT.messages.antiBlockUpdatedPrefix}${result.antiBlockUrls.length}${UI_TEXT.messages.antiBlockUpdatedSuffix}${result.filePath}`,
            new Date().toISOString()
          );
        } catch (error) {
          logController.appendLog('error', getErrorMessage(error), new Date().toISOString());
        }
      });

      elements.clearLogButton.addEventListener('click', () => {
        logController.clearLogView();
        logController.appendLog('info', UI_TEXT.log.cleared, new Date().toISOString());
      });
    }

    async function bootstrap() {
      const initialSettings = await desktopApi.getSettings();
      const initialLogContext = await desktopApi.getLogContext();
      const templateKey = initialSettings.taskTemplate || 'balanced';

      if (TASK_TEMPLATES[templateKey]) {
        applyTemplate(templateKey, { keepLimit: true, keepBase: true, keepOutput: true });
      } else {
        elements.taskTemplate.value = 'balanced';
        elements.itemsPerPage.value = String(initialSettings.itemsPerPage || UI_TEXT.limits.defaultItemsPerPage);
        elements.parallel.value = String(initialSettings.parallel || TASK_TEMPLATES.balanced.parallel);
        elements.delay.value = String(initialSettings.delay || TASK_TEMPLATES.balanced.delay);
        elements.timeout.value = String(initialSettings.timeout || TASK_TEMPLATES.balanced.timeout);
        elements.cloudflare.checked = Boolean(initialSettings.cloudflare);
        elements.secondValidation.checked = Boolean(initialSettings.secondValidation);
      }

      elements.base.value = initialSettings.base || '';
      elements.output.value = initialSettings.output || '';
      elements.limit.value = String(initialSettings.limit || 0);
      elements.totalPages.value = String(initialSettings.totalPages || 0);
      elements.proxy.value = initialSettings.proxy || '';
      elements.magnetExcludeKeywords.value = initialSettings.magnetExcludeKeywords || '';
      elements.nomag.checked = Boolean(initialSettings.nomag);
      elements.allmag.checked = Boolean(initialSettings.allmag);
      elements.magnetContentValidation.checked = Boolean(initialSettings.magnetContentValidation);
      elements.nopic.checked = Boolean(initialSettings.nopic);

      bindBaseUrlChips();
      bindEvents();
      applyBackgroundImage(initialSettings.backgroundImageUrl);
      logController.updateLogContext(initialLogContext);
      refreshSuggestedPages();
      if (elements.proxy.value.trim()) {
        await proxyValidator.validate(elements.proxy.value.trim());
      } else {
        proxyValidator.setStatus('empty');
      }
      proxyValidator.scheduleAutoValidation();
      stateController.setStatus('idle', UI_TEXT.state.defaultMessage);
      logController.appendLog('info', UI_TEXT.state.ready, new Date().toISOString());
    }

    return {
      bootstrap,
      getLookupContext,
      applyActressLookupResult
    };
  }

  globalScope.desktopFormController = {
    createFormController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
