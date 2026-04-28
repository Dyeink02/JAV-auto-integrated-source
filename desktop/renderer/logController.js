(function initializeLogController(globalScope) {
  function clearChildren(container) {
    if (container) {
      container.replaceChildren();
    }
  }

  function createLogController(options) {
    const {
      logView,
      logFilePath,
      maxLines,
      defaultHint,
      logPathPrefix,
      truncatedSuffix = '内容过长，已自动折叠显示。',
      visibleLevels = ['info', 'warn', 'error'],
      maxVisibleLength = 240,
      hiddenKeywords = []
    } = options;

    let queuedLogs = [];
    let flushScheduled = false;
    let flushTimer = null;
    let currentLogContextText = '';

    const visibleLevelSet = new Set(visibleLevels.map((level) => String(level).toLowerCase()));

    function normalizeVisibleMessage(message) {
      const singleLineMessage = String(message ?? '').replace(/\s+/g, ' ').trim();
      if (singleLineMessage.length <= maxVisibleLength) {
        return singleLineMessage;
      }

      return `${singleLineMessage.slice(0, maxVisibleLength)} ${truncatedSuffix}`;
    }

    function shouldDisplay(level, message) {
      const normalizedLevel = String(level || '').toLowerCase();
      if (!visibleLevelSet.has(normalizedLevel)) {
        return false;
      }

      return !hiddenKeywords.some((keyword) => String(message || '').includes(keyword));
    }

    function scheduleFlush() {
      if (flushScheduled) {
        return;
      }

      flushScheduled = true;
      flushTimer = setTimeout(flushLogs, 160);
    }

    function appendLog(level, message, timestamp) {
      if (!shouldDisplay(level, message)) {
        return;
      }

      queuedLogs.push({
        level: String(level || 'info').toLowerCase(),
        message: normalizeVisibleMessage(message),
        timestamp
      });

      scheduleFlush();
    }

    function flushLogs() {
      flushScheduled = false;
      flushTimer = null;

      if (queuedLogs.length === 0) {
        return;
      }

      const shouldStickToBottom =
        logView.scrollHeight - logView.scrollTop - logView.clientHeight <= Math.max(logView.clientHeight * 0.25, 48);

      const fragment = document.createDocumentFragment();
      const batch = queuedLogs;
      queuedLogs = [];

      batch.forEach((item) => {
        const line = document.createElement('div');
        const date = item.timestamp ? new Date(item.timestamp) : new Date();

        line.className = `log-line ${item.level}`;
        line.textContent = `[${date.toLocaleString('zh-CN', { hour12: false })}] ${item.message}`;
        fragment.appendChild(line);
      });

      logView.appendChild(fragment);

      while (logView.childElementCount > maxLines) {
        logView.removeChild(logView.firstElementChild);
      }

      if (shouldStickToBottom) {
        logView.scrollTop = logView.scrollHeight;
      }
    }

    function updateLogContext(context = {}) {
      const nextText =
        context && context.sessionLogPath ? `${logPathPrefix}${context.sessionLogPath}` : defaultHint;

      if (nextText === currentLogContextText) {
        return;
      }

      currentLogContextText = nextText;
      logFilePath.textContent = nextText;
      logFilePath.title = nextText;
    }

    function clearLogView() {
      queuedLogs = [];
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushScheduled = false;
      clearChildren(logView);
    }

    return {
      appendLog,
      clearLogView,
      updateLogContext
    };
  }

  globalScope.desktopLogController = {
    createLogController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
