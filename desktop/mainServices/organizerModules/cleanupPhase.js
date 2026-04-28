async function runCleanupPhase(context = {}) {
  const { dryRun, rootPath, cleanupEmptyDirectories, emitLog, onLog, preservedTopDirs } = context;

  if (dryRun) {
    return {
      removedEmptyDirs: 0
    };
  }

  const removedEmptyDirs = await cleanupEmptyDirectories(rootPath, {
    onLog,
    preservedTopDirs: preservedTopDirs instanceof Set ? preservedTopDirs : new Set()
  });
  const count = Array.isArray(removedEmptyDirs) ? removedEmptyDirs.length : 0;

  emitLog(onLog, 'info', `空目录清理完成：${count} 个。`);

  return {
    removedEmptyDirs: count
  };
}

module.exports = {
  runCleanupPhase
};
