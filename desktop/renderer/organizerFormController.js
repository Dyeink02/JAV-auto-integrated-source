(function initializeOrganizerFormController(globalScope) {
  /**
   * Creates the form sub-controller: settings, validation, ad configuration.
   * @param {{ state: object, elements: object, desktopApi: object, messages: object, progressSchema: object, utils: object, ctrl: object }} deps
   */
  function createOrganizerFormController(deps) {
    const { state, elements, messages, progressSchema, utils, ctrl } = deps;
    const { toSafeInteger, normalizeKeywordText, normalizeAdModelType, setDisabled } = utils;

    function isAdDetectionEnabled() {
      if (elements.organizerAdDetectionEnable || elements.organizerAdDetectionDisable) {
        if (elements.organizerAdDetectionDisable && elements.organizerAdDetectionDisable.checked) {
          return false;
        }
        if (elements.organizerAdDetectionEnable && elements.organizerAdDetectionEnable.checked) {
          return true;
        }
      }
      return Boolean(elements.organizerAdDetectionEnabled && elements.organizerAdDetectionEnabled.checked);
    }

    function applyAdDetectionUiState() {
      const enabled = isAdDetectionEnabled();
      if (elements.organizerAdModelType) {
        elements.organizerAdModelType.disabled = !enabled || state.running;
      }
    }

    function getLearningConfig() {
      return {
        adDetectionEnabled: isAdDetectionEnabled(),
        adModelType: normalizeAdModelType(elements.organizerAdModelType && elements.organizerAdModelType.value),
        adThreshold: toSafeInteger(elements.organizerAdThreshold && elements.organizerAdThreshold.value, 60, 1, 100),
        adKeywords: normalizeKeywordText(elements.organizerAdKeywords && elements.organizerAdKeywords.value).join(', ')
      };
    }

    function getLearningCodes() {
      const rawCodes =
        elements.organizerLearningCodes && elements.organizerLearningCodes.value
          ? String(elements.organizerLearningCodes.value)
          : '';
      return Array.from(
        new Set(
          rawCodes
            .split(/[\r\n,，、;；\s]+/)
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean)
        )
      );
    }

    function updateCodeMetaView(meta = {}) {
      if (elements.organizerCodeCount) {
        elements.organizerCodeCount.textContent = String(meta.codeCount || 0);
      }
      if (elements.organizerCodeSource) {
        if (meta.sourcePath) {
          elements.organizerCodeSource.textContent = `来源：${meta.sourcePath}`;
        } else {
          elements.organizerCodeSource.textContent = '来源：尚未加载番号名单';
        }
      }
    }

    function getSelectedAdFileAction() {
      if (elements.organizerAdFileActionDelete && elements.organizerAdFileActionDelete.checked) {
        return 'delete-directly';
      }
      if (elements.organizerAdFileActionMove && elements.organizerAdFileActionMove.checked) {
        return 'move-to-delete';
      }
      return 'move-to-delete';
    }

    function normalizeAdFileAction(rawValue) {
      if (progressSchema && typeof progressSchema.normalizeAdFileAction === 'function') {
        return progressSchema.normalizeAdFileAction(rawValue);
      }
      return String(rawValue || '').trim() === 'delete-directly' ? 'delete-directly' : 'move-to-delete';
    }

    function getAdFileActionLabel(action) {
      return action === 'delete-directly' ? '直接删除广告文件' : '移入待删除';
    }

    function getSettings(dryRun) {
      const learningConfig = getLearningConfig();
      return {
        rootPath: String(elements.organizerRoot && elements.organizerRoot.value ? elements.organizerRoot.value : '').trim(),
        minSizeMB: toSafeInteger(elements.organizerMinSize && elements.organizerMinSize.value, 100, 1),
        suffix: String(elements.organizerSuffix && elements.organizerSuffix.value ? elements.organizerSuffix.value : '').trim() || '-A',
        adFileAction: normalizeAdFileAction(getSelectedAdFileAction()),
        dryRun,
        includeSubdirectories: Boolean(
          elements.organizerIncludeSubdirectories && elements.organizerIncludeSubdirectories.checked
        ),
        expectedCodes: state.expectedCodes,
        expectedCodeEntries: state.expectedCodeEntries,
        crawlOutputDir: String(
          elements.organizerCrawlOutput && elements.organizerCrawlOutput.value ? elements.organizerCrawlOutput.value : ''
        ).trim(),
        adDetectionEnabled: learningConfig.adDetectionEnabled,
        adModelType: learningConfig.adModelType,
        adThreshold: learningConfig.adThreshold,
        adKeywords: learningConfig.adKeywords
      };
    }

    function validateSettings(settings) {
      if (!settings.rootPath) {
        throw new Error(messages.rootRequired);
      }
      if (!Number.isFinite(settings.minSizeMB) || settings.minSizeMB < 1) {
        throw new Error(messages.minSizeInvalid);
      }
      if (!settings.crawlOutputDir) {
        throw new Error(messages.crawlOutputRequired);
      }
    }

    return {
      isAdDetectionEnabled,
      applyAdDetectionUiState,
      getLearningConfig,
      getLearningCodes,
      updateCodeMetaView,
      getSelectedAdFileAction,
      normalizeAdFileAction,
      getAdFileActionLabel,
      getSettings,
      validateSettings
    };
  }

  globalScope._organizerFormController = { create: createOrganizerFormController };
})(typeof globalThis !== 'undefined' ? globalThis : window);
