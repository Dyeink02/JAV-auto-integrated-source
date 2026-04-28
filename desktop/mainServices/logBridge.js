const { PUSH } = require('../common/ipcChannels');

function createLogBridge({
  fs,
  path,
  sendToRenderer,
  mainText,
  statusLabels,
  logFilterPatterns,
  fileNames,
  appTitle,
  appVersion,
  appDemoLabel
}) {
  let currentTaskLogDir = null;
  let currentTaskLogPath = null;
  let currentLatestLogPath = null;
  let lastTaskStateSignature = '';
  let lastTaskStateAt = 0;
  let pendingTaskLogLines = [];
  let pendingTaskLogFlushTimer = null;
  let taskLogFlushPromise = Promise.resolve();
  let pendingRendererLogEntries = [];
  let pendingRendererLogFlushTimer = null;
  let pendingRendererState = null;
  let pendingRendererStateFlushTimer = null;

  const SESSION_LOG_LEVELS = new Set(['info', 'warn', 'error']);
  const TASK_LOG_BATCH_SIZE = 24;
  const TASK_LOG_FLUSH_INTERVAL_MS = 180;
  const RENDERER_LOG_BATCH_SIZE = 40;
  const RENDERER_LOG_FLUSH_INTERVAL_MS = 180;
  const RENDERER_STATE_FLUSH_INTERVAL_MS = 320;
  const noisyLogPatterns = Array.isArray(logFilterPatterns?.noisy) ? logFilterPatterns.noisy : [];
  const keyLogPatterns = Array.isArray(logFilterPatterns?.key) ? logFilterPatterns.key : [];
  const localizedStatusLabels = statusLabels || {};
  const logLevelLabels = mainText?.logLevelLabels || {};
  const logPrefixLabels = mainText?.logPrefixLabels || {};

  function padNumber(value) {
    return String(value).padStart(2, '0');
  }

  function formatLogStamp(date = new Date()) {
    return `${date.getFullYear()}${padNumber(date.getMonth() + 1)}${padNumber(date.getDate())}-${padNumber(
      date.getHours()
    )}${padNumber(date.getMinutes())}${padNumber(date.getSeconds())}`;
  }

  function formatLogLineStamp(value) {
    if (!value) {
      const now = new Date();
      return `${now.getFullYear()}-${padNumber(now.getMonth() + 1)}-${padNumber(now.getDate())} ${padNumber(
        now.getHours()
      )}:${padNumber(now.getMinutes())}:${padNumber(now.getSeconds())}`;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(
      date.getHours()
    )}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
  }

  function getLogContext() {
    return {
      logDir: currentTaskLogDir,
      sessionLogPath: currentTaskLogPath,
      latestLogPath: currentLatestLogPath
    };
  }

  function flushRendererLogBatch() {
    if (pendingRendererLogFlushTimer) {
      clearTimeout(pendingRendererLogFlushTimer);
      pendingRendererLogFlushTimer = null;
    }

    if (pendingRendererLogEntries.length === 0) {
      return;
    }

    const batch = pendingRendererLogEntries;
    pendingRendererLogEntries = [];
    sendToRenderer(PUSH.RUNNER_LOG, batch);
  }

  function scheduleRendererLogFlush() {
    if (pendingRendererLogEntries.length >= RENDERER_LOG_BATCH_SIZE) {
      flushRendererLogBatch();
      return;
    }

    if (!pendingRendererLogFlushTimer) {
      pendingRendererLogFlushTimer = setTimeout(flushRendererLogBatch, RENDERER_LOG_FLUSH_INTERVAL_MS);
    }
  }

  function getLocalizedLogLevel(level) {
    return logLevelLabels[String(level || '').toLowerCase()] || String(level || '信息').toUpperCase();
  }

  function localizeLogPrefix(message) {
    let normalizedMessage = String(message || '');

    Object.entries(logPrefixLabels).forEach(([sourcePrefix, localizedPrefix]) => {
      if (normalizedMessage.startsWith(sourcePrefix)) {
        normalizedMessage = `${localizedPrefix}${normalizedMessage.slice(sourcePrefix.length).trimStart()}`;
      }
    });

    return normalizedMessage;
  }

  function formatSessionLogMessage(message) {
    const normalizedMessage = localizeLogPrefix(String(message || '').trim());
    if (!normalizedMessage) {
      return '';
    }

    if (keyLogPatterns.some((pattern) => normalizedMessage.includes(pattern))) {
      return `${mainText.keyLogPrefix}${normalizedMessage}`;
    }

    return normalizedMessage;
  }

  function shouldWriteSessionLogEntry(entry) {
    const level = String(entry?.level || 'info').toLowerCase();
    if (!SESSION_LOG_LEVELS.has(level)) {
      return false;
    }

    const message = String(entry?.message || '');
    return !noisyLogPatterns.some((pattern) => message.includes(pattern));
  }

  function queueRendererLogEntry(entry) {
    if (!shouldWriteSessionLogEntry(entry)) {
      return;
    }

    pendingRendererLogEntries.push({
      ...entry,
      message: formatSessionLogMessage(entry.message)
    });
    scheduleRendererLogFlush();
  }

  function flushRendererState() {
    if (pendingRendererStateFlushTimer) {
      clearTimeout(pendingRendererStateFlushTimer);
      pendingRendererStateFlushTimer = null;
    }

    if (!pendingRendererState) {
      return;
    }

    const state = pendingRendererState;
    pendingRendererState = null;
    sendToRenderer(PUSH.RUNNER_STATE, state);
  }

  function queueRendererState(state) {
    if (!state) {
      return;
    }

    const isFinalState = ['completed', 'error', 'stopped', 'incomplete'].includes(
      String(state.status || '').toLowerCase()
    );
    pendingRendererState = state;

    if (isFinalState) {
      flushRendererState();
      return;
    }

    if (!pendingRendererStateFlushTimer) {
      pendingRendererStateFlushTimer = setTimeout(flushRendererState, RENDERER_STATE_FLUSH_INTERVAL_MS);
    }
  }

  async function flushTaskLogBuffer() {
    if (pendingTaskLogFlushTimer) {
      clearTimeout(pendingTaskLogFlushTimer);
      pendingTaskLogFlushTimer = null;
    }

    if (!currentTaskLogPath || !currentLatestLogPath || pendingTaskLogLines.length === 0) {
      return taskLogFlushPromise;
    }

    const taskLogPath = currentTaskLogPath;
    const latestLogPath = currentLatestLogPath;
    const lines = pendingTaskLogLines;
    pendingTaskLogLines = [];
    const payload = `${lines.join('\r\n')}\r\n`;

    taskLogFlushPromise = taskLogFlushPromise
      .then(() =>
        Promise.all([
          fs.promises.appendFile(taskLogPath, payload, 'utf8'),
          fs.promises.appendFile(latestLogPath, payload, 'utf8')
        ])
      )
      .catch((error) => {
        console.warn('flushTaskLogBuffer failed:', error);
      });

    return taskLogFlushPromise;
  }

  function scheduleTaskLogFlush() {
    if (pendingTaskLogLines.length >= TASK_LOG_BATCH_SIZE) {
      void flushTaskLogBuffer();
      return;
    }

    if (!pendingTaskLogFlushTimer) {
      pendingTaskLogFlushTimer = setTimeout(() => {
        void flushTaskLogBuffer();
      }, TASK_LOG_FLUSH_INTERVAL_MS);
    }
  }

  async function flushDesktopPipelines() {
    flushRendererState();
    flushRendererLogBatch();
    await flushTaskLogBuffer();
  }

  function appendTaskLogLine(line) {
    if (!currentTaskLogPath || !currentLatestLogPath) {
      return;
    }

    pendingTaskLogLines.push(String(line || ''));
    scheduleTaskLogFlush();
  }

  function writeTaskLog(level, message, timestamp) {
    appendTaskLogLine(
      `[${formatLogLineStamp(timestamp)}] ${getLocalizedLogLevel(level)}: ${String(message || '')}`
    );
  }

  function appendTaskLogEntry(entry) {
    if (!shouldWriteSessionLogEntry(entry)) {
      return;
    }

    writeTaskLog(entry.level || 'info', formatSessionLogMessage(entry.message), entry.timestamp);
  }

  function shouldWriteTaskStateEntry(state) {
    const status = String(state?.status || 'unknown').toLowerCase();
    const message = String(state?.message || '').trim();
    const now = Date.now();
    const signature = `${status}|${message}`;
    const isFinalState = ['completed', 'error', 'stopped', 'incomplete'].includes(status);

    if (isFinalState) {
      lastTaskStateSignature = signature;
      lastTaskStateAt = now;
      return true;
    }

    if (signature === lastTaskStateSignature && now - lastTaskStateAt < 2000) {
      return false;
    }

    lastTaskStateSignature = signature;
    lastTaskStateAt = now;
    return true;
  }

  function appendTaskStateEntry(state) {
    if (!shouldWriteTaskStateEntry(state)) {
      return;
    }

    const status = String(state.status || 'unknown').toLowerCase();
    const message = formatSessionLogMessage(state.message || '');
    const localizedStatus = localizedStatusLabels[status] || status;
    appendTaskLogLine(`[${formatLogLineStamp()}] ${mainText.stateLogPrefix || '状态'}(${localizedStatus}): ${message}`);
  }

  function initializeTaskLogFiles(outputDir, settings) {
    pendingTaskLogLines = [];
    pendingRendererLogEntries = [];
    pendingRendererState = null;
    currentTaskLogDir = path.join(outputDir, 'logs');
    currentTaskLogPath = path.join(currentTaskLogDir, `${fileNames.taskLogPrefix}-${formatLogStamp()}.txt`);
    currentLatestLogPath = path.join(currentTaskLogDir, fileNames.latestLogFilename);

    fs.mkdirSync(currentTaskLogDir, { recursive: true });

    const headerLines = [
      `${appTitle}${appDemoLabel ? ` ${appDemoLabel}` : ''} ${mainText.taskLogTitleSuffix}`,
      `${mainText.versionLabel}: ${appVersion}`,
      `${mainText.startTimeLabel}: ${formatLogLineStamp()}`,
      `${mainText.outputLabel}: ${outputDir}`,
      `${mainText.baseLabel}: ${settings.base || ''}`,
      `${mainText.runtimeSchemeLabel}: ${settings.demoLabel || settings.demoMode || appDemoLabel || 'AED'}`,
      '------------------------------------------------------------'
    ];
    const header = `${headerLines.join('\r\n')}\r\n`;

    fs.writeFileSync(currentTaskLogPath, header, 'utf8');
    fs.writeFileSync(currentLatestLogPath, header, 'utf8');
    lastTaskStateSignature = '';
    lastTaskStateAt = 0;
    sendToRenderer(PUSH.RUNNER_LOG_CONTEXT, getLogContext());
  }

  return {
    getLogContext,
    flushDesktopPipelines,
    queueRendererLogEntry,
    queueRendererState,
    appendTaskLogEntry,
    appendTaskStateEntry,
    appendTaskLogLine,
    writeTaskLog,
    initializeTaskLogFiles
  };
}

module.exports = {
  createLogBridge
};
