(function initializeFormProxyValidator(globalScope) {
  /**
   * formProxyValidator.js
   * 代理验证状态机：防抖验证、自动轮询、状态 UI 更新。
   * 从 formController.js 提取，通过工厂函数接收依赖。
   */

  const PROXY_AUTO_CHECK_INTERVAL_MS = 30000;

  /**
   * @param {object} deps
   * @param {object} deps.elements  - DOM 元素引用（proxy, proxyStatus, proxyStatusDetail, base）
   * @param {object} deps.desktopApi
   * @param {object} deps.UI_TEXT
   * @returns 代理验证公共 API
   */
  function createProxyValidator(deps) {
    const { elements, desktopApi, UI_TEXT } = deps;

    const state = {
      timerId: null,
      autoTimerId: null,
      requestToken: 0,
      lastValue: '',
      lastStatus: 'empty'
    };

    function clearTimer() {
      if (!state.timerId) return;
      clearTimeout(state.timerId);
      state.timerId = null;
    }

    function clearAutoTimer() {
      if (!state.autoTimerId) return;
      clearTimeout(state.autoTimerId);
      state.autoTimerId = null;
    }

    function setStatus(status, detailText = '') {
      const normalizedStatus =
        status === 'checking' || status === 'valid' || status === 'invalid' ? status : 'empty';
      const statusText = UI_TEXT.proxyStatus[normalizedStatus] || UI_TEXT.proxyStatus.empty;
      const fallbackDetailKey = `${normalizedStatus}Detail`;
      const nextDetail =
        typeof detailText === 'string' && detailText.trim()
          ? detailText.trim()
          : UI_TEXT.proxyStatus[fallbackDetailKey] || UI_TEXT.fields.proxyHelp;

      state.lastStatus = normalizedStatus;

      if (elements.proxyStatus) {
        elements.proxyStatus.className = `proxy-status-chip ${normalizedStatus}`;
        elements.proxyStatus.textContent = statusText;
      }

      if (elements.proxyStatusDetail) {
        elements.proxyStatusDetail.textContent = nextDetail;
      }
    }

    async function validate(proxyValue) {
      const trimmedValue = String(proxyValue || '').trim();
      clearTimer();
      state.requestToken += 1;
      const requestToken = state.requestToken;
      state.lastValue = trimmedValue;

      if (!trimmedValue) {
        setStatus('empty');
        return { status: 'empty', detail: UI_TEXT.proxyStatus.emptyDetail };
      }

      setStatus('checking');

      try {
        const result = await desktopApi.validateProxy(trimmedValue, {
          targetUrl: elements.base.value.trim() || UI_TEXT.placeholders.base
        });

        if (requestToken !== state.requestToken) return result;

        if (result && result.status === 'valid') {
          setStatus('valid', result.detail);
          return result;
        }

        setStatus('invalid', result && result.detail);
        return result || { status: 'invalid', detail: UI_TEXT.proxyStatus.invalidDetail };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (requestToken === state.requestToken) {
          setStatus('invalid', message);
        }
        return { status: 'invalid', detail: message };
      }
    }

    function scheduleValidation(delayMs = 650) {
      const trimmedValue = elements.proxy.value.trim();
      clearTimer();

      if (!trimmedValue) {
        state.requestToken += 1;
        state.lastValue = '';
        setStatus('empty');
        return;
      }

      setStatus('checking');
      state.timerId = setTimeout(() => {
        state.timerId = null;
        void validate(trimmedValue);
      }, delayMs);
    }

    function scheduleAutoValidation(delayMs = PROXY_AUTO_CHECK_INTERVAL_MS) {
      clearAutoTimer();
      state.autoTimerId = setTimeout(async () => {
        state.autoTimerId = null;
        const trimmedValue = elements.proxy.value.trim();

        if (!trimmedValue) {
          setStatus('empty');
          scheduleAutoValidation();
          return;
        }

        await validate(trimmedValue);
        scheduleAutoValidation();
      }, Math.max(1000, delayMs));
    }

    async function ensureReady(proxyValue) {
      const trimmedValue = String(proxyValue || '').trim();
      if (!trimmedValue) {
        setStatus('empty');
        return;
      }

      const result = await validate(trimmedValue);
      if (!result || result.status !== 'valid') {
        throw new Error(UI_TEXT.validation.proxyInvalid);
      }
    }

    return {
      setStatus,
      validate,
      scheduleValidation,
      scheduleAutoValidation,
      ensureReady
    };
  }

  globalScope.desktopFormProxyValidator = { createProxyValidator };
})(typeof globalThis !== 'undefined' ? globalThis : window);
