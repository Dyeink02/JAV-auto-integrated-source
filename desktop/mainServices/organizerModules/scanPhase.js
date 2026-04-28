async function runScanPhase(context = {}) {
  const { collectFiles, rootPath, includeSubdirectories, emitLog, emitProgress, onLog, onProgress, signal, isPaused, summary } = context;

  const files = await collectFiles(rootPath, includeSubdirectories !== false, signal, isPaused);
  files.sort((left, right) => String(left.path || '').localeCompare(String(right.path || ''), 'en', { sensitivity: 'base' }));

  if (summary && typeof summary === 'object') {
    summary.scannedTotal = files.length;
  }

  emitLog(onLog, 'info', `扫描完成，待处理文件 ${files.length} 个。`);
  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'scan-start',
    total: files.length,
    processed: 0
  });

  return {
    files
  };
}

module.exports = {
  runScanPhase
};
