function createRunnerService({
  state,
  app,
  dialog,
  Notification,
  path,
  desktopRoot,
  runtimePackage,
  appTitle,
  appVersion,
  appDemoLabel,
  mainText,
  windowService,
  settingsStore,
  logBridge
}) {
  function getRunnerModule() {
    return require(path.join(desktopRoot, '..', 'dist', 'core', 'scraperRunner.js'));
  }

  function getOutputRuntimeUtilsModule() {
    return require(path.join(desktopRoot, '..', 'dist', 'core', 'outputRuntimeUtils.js'));
  }

  function showReminder(taskState) {
    const title = appTitle;
    const body = taskState.message || mainText.reminderFallback;

    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
      return;
    }

    const mainWindow = windowService.getWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: taskState.status === 'completed' ? 'info' : taskState.status === 'error' ? 'error' : 'warning',
        title,
        message: body
      });
    }
  }

  async function startRunner(settings) {
    if (state.activeRunner) {
      throw new Error(mainText.runnerBusy);
    }

    const { resolveRunOutputDirectory } = getOutputRuntimeUtilsModule();
    const outputResolution = resolveRunOutputDirectory({
      outputDir: settings.output,
      resumeExisting: Boolean(settings.resumeExisting)
    });
    const runtimeSettings = {
      ...settings,
      output: outputResolution.outputDir,
      outputResolved: true
    };

    await logBridge.flushDesktopPipelines();
    settingsStore.saveSettings(settings);
    state.currentTaskOutputDir = runtimeSettings.output;
    state.lastTaskOutputDir = runtimeSettings.output;
    logBridge.initializeTaskLogFiles(runtimeSettings.output, runtimeSettings);
    logBridge.writeTaskLog('info', `${mainText.taskLogCreatedPrefix}${logBridge.getLogContext().sessionLogPath}`);
    if (outputResolution.createdRunDir) {
      const outputMessage = `检测到输出目录已有历史结果，本次任务已自动切换到独立输出目录：${runtimeSettings.output}`;
      logBridge.writeTaskLog('info', outputMessage);
      logBridge.queueRendererLogEntry({
        level: 'info',
        message: outputMessage,
        timestamp: new Date().toISOString()
      });
    }

    const { default: ScraperRunner } = getRunnerModule();

    state.activeRunner = new ScraperRunner({
      ...runtimeSettings,
      demoMode: runtimeSettings.demoMode || runtimePackage.demoMode || 'aed',
      demoLabel: runtimeSettings.demoLabel || runtimePackage.demoLabel || 'AED',
      productDisplayName: runtimePackage.productDisplayName || appTitle,
      useProgressBars: false,
      handleSignals: false
    });

    state.activeRunner.on('log', (entry) => {
      logBridge.appendTaskLogEntry(entry);
      logBridge.queueRendererLogEntry(entry);
    });

    state.activeRunner.on('state', (taskState) => {
      logBridge.appendTaskStateEntry(taskState);
      logBridge.queueRendererState(taskState);

      const isFinalState = ['completed', 'error', 'stopped', 'incomplete'].includes(taskState.status);
      if (isFinalState && !state.pendingRestartSettings) {
        showReminder(taskState);
      }
    });

    state.activeRunner
      .run()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logBridge.writeTaskLog('error', message);
        logBridge.queueRendererState({
          status: 'error',
          message
        });
      })
      .finally(async () => {
        await logBridge.flushDesktopPipelines();
        state.activeRunner = null;
        state.currentTaskOutputDir = null;

        if (state.pendingRestartSettings) {
          const nextSettings = state.pendingRestartSettings;
          state.pendingRestartSettings = null;

          logBridge.queueRendererLogEntry({
            level: 'info',
            message: mainText.continueRecovery,
            timestamp: new Date().toISOString()
          });

          try {
            await startRunner(nextSettings);
          } catch (error) {
            const message = `${mainText.restartFailedPrefix}${error instanceof Error ? error.message : String(error)}`;
            logBridge.writeTaskLog('error', message);
            logBridge.queueRendererState({
              status: 'error',
              message
            });
          }
          return;
        }

        if (state.quittingAfterStop) {
          state.quittingAfterStop = false;
          app.quit();
        }
      });

    return { ok: true };
  }

  async function restartRunner(settings) {
    const nextSettings = {
      ...settings,
      resumeExisting: true
    };

    if (state.activeRunner) {
      state.pendingRestartSettings = nextSettings;
      await state.activeRunner.stop();
      return { ok: true, restarting: true };
    }

    await startRunner(nextSettings);
    return { ok: true, restarting: false };
  }

  async function stopRunner(options = {}) {
    if (!options.preserveRestart) {
      state.pendingRestartSettings = null;
    }

    if (!state.activeRunner) {
      return { ok: true };
    }

    await state.activeRunner.stop();
    return { ok: true };
  }

  async function handleBeforeQuit(event) {
    state.pendingRestartSettings = null;

    if (!state.activeRunner) {
      await logBridge.flushDesktopPipelines();
      return;
    }

    event.preventDefault();
    state.quittingAfterStop = true;
    await state.activeRunner.stop();
    await logBridge.flushDesktopPipelines();
  }

  async function updateAntiBlockUrls(settings) {
    const { default: ScraperRunner } = getRunnerModule();
    return ScraperRunner.updateAntiBlockUrls({
      base: settings.base,
      proxy: settings.proxy
    });
  }

  function isRunning() {
    return Boolean(state.activeRunner);
  }

  return {
    startRunner,
    restartRunner,
    stopRunner,
    handleBeforeQuit,
    updateAntiBlockUrls,
    isRunning
  };
}

module.exports = {
  createRunnerService
};
