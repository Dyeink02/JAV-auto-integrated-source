(function initializeFormFieldHelpers(globalScope) {
  /**
   * formFieldHelpers.js
   * 表单字段工具：数值规范化、磁力关键词验证、设置收集与校验。
   * 从 formController.js 提取，纯函数 + 轻量工厂。
   */

  /* ------------------------------------------------------------------ */
  /*  数值规范化                                                          */
  /* ------------------------------------------------------------------ */

  function toSafeInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeMinInteger(value, minimum, fallback) {
    return Math.max(minimum, toSafeInteger(value, fallback));
  }

  function normalizeNonNegativeInteger(value, fallback) {
    return Math.max(0, toSafeInteger(value, fallback));
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  /* ------------------------------------------------------------------ */
  /*  磁力关键词验证                                                       */
  /* ------------------------------------------------------------------ */

  function normalizeMagnetExcludeKeywords(rawValue) {
    return String(rawValue || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(', ');
  }

  function validateMagnetExcludeKeywords(rawValue) {
    const trimmedValue = String(rawValue || '').trim();
    if (!trimmedValue) {
      return { valid: true, normalized: '' };
    }

    if (/[，、；;\r\n]/.test(trimmedValue)) {
      return { valid: false, normalized: trimmedValue };
    }

    const parts = trimmedValue.split(',');
    if (
      trimmedValue.startsWith(',') ||
      trimmedValue.endsWith(',') ||
      parts.some((item) => !item.trim())
    ) {
      return { valid: false, normalized: trimmedValue };
    }

    return { valid: true, normalized: normalizeMagnetExcludeKeywords(trimmedValue) };
  }

  /**
   * @param {object} deps
   * @param {object} deps.elements
   * @param {object} deps.desktopApi
   * @param {object} deps.UI_TEXT
   */
  function createMagnetValidator(deps) {
    const { elements, desktopApi, UI_TEXT } = deps;

    function focusField() {
      window.setTimeout(() => {
        elements.magnetExcludeKeywords.focus();
        elements.magnetExcludeKeywords.select();
      }, 0);
    }

    async function ensureReady(rawValue) {
      const validation = validateMagnetExcludeKeywords(rawValue);
      if (validation.valid) {
        elements.magnetExcludeKeywords.value = validation.normalized;
        return validation.normalized;
      }

      if (desktopApi && typeof desktopApi.showAlert === 'function') {
        await desktopApi.showAlert({
          type: 'warning',
          title: UI_TEXT.fields.magnetExcludeKeywords,
          message: UI_TEXT.validation.magnetExcludeKeywordsInvalid
        });
      } else {
        window.alert(UI_TEXT.validation.magnetExcludeKeywordsInvalid);
      }

      focusField();
      throw new Error(UI_TEXT.validation.magnetExcludeKeywordsInvalid);
    }

    return { ensureReady };
  }

  /* ------------------------------------------------------------------ */
  /*  设置收集与校验                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * @param {object} deps
   * @param {object} deps.elements
   * @param {object} deps.UI_TEXT
   * @param {object} deps.TASK_TEMPLATES
   */
  function createSettingsHelper(deps) {
    const { elements, UI_TEXT, TASK_TEMPLATES } = deps;

    function getItemsPerPage() {
      return normalizeMinInteger(elements.itemsPerPage.value, 1, UI_TEXT.limits.defaultItemsPerPage);
    }

    function getSuggestedPages(limit, itemsPerPage) {
      if (!limit || limit <= 0 || !itemsPerPage || itemsPerPage <= 0) return null;
      const pages = Math.ceil(limit / itemsPerPage);
      const remainder = limit % itemsPerPage;
      return { pages, lastPageCount: remainder === 0 ? itemsPerPage : remainder };
    }

    function getSettings() {
      return {
        base: elements.base.value.trim(),
        output: elements.output.value.trim(),
        limit: normalizeNonNegativeInteger(elements.limit.value, 0),
        totalPages: normalizeNonNegativeInteger(elements.totalPages.value, 0),
        itemsPerPage: getItemsPerPage(),
        parallel: normalizeMinInteger(elements.parallel.value, 1, TASK_TEMPLATES.balanced.parallel),
        delay: normalizeNonNegativeInteger(elements.delay.value, TASK_TEMPLATES.balanced.delay),
        timeout: normalizeMinInteger(
          elements.timeout.value,
          UI_TEXT.limits.minTimeout,
          TASK_TEMPLATES.balanced.timeout
        ),
        proxy: elements.proxy.value.trim(),
        magnetExcludeKeywords: elements.magnetExcludeKeywords.value.trim(),
        taskTemplate: elements.taskTemplate.value,
        cloudflare: elements.cloudflare.checked,
        secondValidation: elements.secondValidation.checked,
        nomag: elements.nomag.checked,
        allmag: elements.allmag.checked,
        magnetContentValidation: elements.magnetContentValidation.checked,
        nopic: elements.nopic.checked
      };
    }

    function validateSettings(settings) {
      if (!settings.base) throw new Error(UI_TEXT.validation.baseRequired);
      if (!settings.output) throw new Error(UI_TEXT.validation.outputRequired);
      if (Number.isNaN(settings.itemsPerPage) || settings.itemsPerPage < 1) throw new Error(UI_TEXT.validation.itemsPerPageInvalid);
      if (Number.isNaN(settings.parallel) || settings.parallel < 1) throw new Error(UI_TEXT.validation.parallelInvalid);
      if (Number.isNaN(settings.totalPages) || settings.totalPages < 0) throw new Error(UI_TEXT.validation.totalPagesInvalid);
      if (Number.isNaN(settings.delay) || settings.delay < 0) throw new Error(UI_TEXT.validation.delayInvalid);
      if (Number.isNaN(settings.timeout) || settings.timeout < UI_TEXT.limits.minTimeout) {
        throw new Error(
          `${UI_TEXT.validation.timeoutInvalidPrefix}${UI_TEXT.limits.minTimeout}${UI_TEXT.validation.timeoutInvalidSuffix}`
        );
      }
    }

    return {
      getItemsPerPage,
      getSuggestedPages,
      getSettings,
      validateSettings
    };
  }

  globalScope.desktopFormFieldHelpers = {
    getErrorMessage,
    createMagnetValidator,
    createSettingsHelper
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
