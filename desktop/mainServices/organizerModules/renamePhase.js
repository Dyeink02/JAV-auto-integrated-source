function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeAbsolutePath(path, sourcePath) {
  return path.resolve(String(sourcePath || '').trim());
}

function isPathInside(path, parentPath, targetPath) {
  const parent = normalizeAbsolutePath(path, parentPath);
  const target = normalizeAbsolutePath(path, targetPath);
  const relativePath = path.relative(parent, target);
  if (!relativePath) {
    return true;
  }
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

function isManagedRootChild(paths, path, directoryPath) {
  const rootPath = normalizeAbsolutePath(path, paths.rootPath);
  const targetPath = normalizeAbsolutePath(path, directoryPath);
  if (!isPathInside(path, rootPath, targetPath)) {
    return true;
  }

  const relativePath = path.relative(rootPath, targetPath);
  const topDirName = relativePath.split(path.sep).filter(Boolean)[0] || '';
  if (!topDirName) {
    return true;
  }

  const managedTopDirs = new Set([
    path.basename(paths.waitingDir),
    path.basename(paths.introAdDir),
    path.basename(paths.toDeleteDir),
    'logs',
    '.video-organizer-state'
  ]);

  return managedTopDirs.has(topDirName);
}

async function runWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return;
  }

  const workerCount = Math.max(1, Math.min(concurrency, list.length));
  let cursor = 0;

  async function consume() {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= list.length) {
        return;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await worker(list[currentIndex], currentIndex);
      } catch {
        // Error isolation: one worker failure must not stop other workers.
        // The worker itself is responsible for logging/incrementing failedOperations.
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => consume()));
}

function resolveDeleteDestinationPath(paths, path, sourcePath) {
  const rootPath = String((paths && paths.rootPath) || '').trim();
  const normalizedSource = String(sourcePath || '').trim();
  if (!rootPath || !normalizedSource) {
    return path.join(paths.toDeleteDir, path.basename(normalizedSource));
  }

  const relativePath = path.relative(rootPath, normalizedSource);
  const isSafeRelative =
    relativePath &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath) &&
    !relativePath.includes(`..${path.sep}`) &&
    !relativePath.includes('..');

  if (!isSafeRelative) {
    return path.join(paths.toDeleteDir, path.basename(normalizedSource));
  }

  return path.join(paths.toDeleteDir, relativePath);
}

async function runRenamePhase(context = {}) {
  const {
    fs,
    path,
    dryRun,
    adFileAction,
    paths,
    candidates,
    pendingDelete,
    targetNames,
    shouldReportProgress,
    moveWithUnique,
    emitLog,
    emitProgress,
    onLog,
    onProgress,
    signal,
    isPaused,
    summary
  } = context;

  const checkAbort = () => signal && signal.aborted;
  const waitPause = async () => {
    if (typeof isPaused !== 'function') return;
    while (isPaused() && !(signal && signal.aborted)) {
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  const renameRecords = [];
  const waitingMoveFailedSources = new Set();
  const totalDeleteCount = Array.isArray(pendingDelete) ? pendingDelete.length : 0;
  // 记录已移动视频所在的文件夹，用于后续直接删除整个文件夹
  const movedVideoFolders = new Set();

  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'waiting-start',
    total: candidates.length,
    processed: 0,
    deleteTotal: totalDeleteCount,
    introAdTotal: 0
  });

  for (let index = 0; index < candidates.length; index += 1) {
    if (checkAbort()) {
      emitLog(onLog, 'warn', '整理任务已被停止（重命名阶段）。');
      break;
    }
    await waitPause();
    const candidate = candidates[index] || {};
    const plannedName = String(targetNames[index] || '').trim();
    const fallbackName = path.basename(String(candidate.src || '').trim());
    const fileName = plannedName || fallbackName;
    const destinationPath = path.join(paths.waitingDir, fileName);
    const originalName = path.basename(String(candidate.src || ''));
    const renameApplied = Boolean(candidate.renameByFilmCode && candidate.filmCode);
    const keepOriginalReason = renameApplied ? '' : String(candidate.keepOriginalReason || '未命中番号，保留原名');

    if (dryRun) {
      summary.movedToWaiting += 1;
      renameRecords.push({
        originalName,
        originalPath: candidate.src,
        waitingPath: destinationPath,
        newName: path.basename(destinationPath),
        filmCode: candidate.filmCode,
        renameApplied,
        note: keepOriginalReason,
        expectedCodeMatched: Boolean(candidate.expectedCodeMatched),
        size: Number(candidate.size || 0)
      });
      emitProgress(onProgress, {
        scope: 'organizer',
        phase: 'waiting-progress',
        total: candidates.length,
        processed: index + 1,
        deleteTotal: totalDeleteCount,
        introAdTotal: 0,
        failedOperations: summary.failedOperations
      });
      emitLog(onLog, 'info', `[预览] 待整理：${candidate.src} -> ${destinationPath}`);
      continue;
    }

    try {
      const movedPath = await moveWithUnique(candidate.src, destinationPath);
      summary.movedToWaiting += 1;
      // 记录原文件夹路径，用于后续直接删除整个文件夹
      const originalDir = path.dirname(candidate.src);
      if (originalDir && !isManagedRootChild(paths, path, originalDir)) {
        movedVideoFolders.add(originalDir);
      }
      renameRecords.push({
        originalName,
        originalPath: candidate.src,
        waitingPath: movedPath,
        newName: path.basename(movedPath),
        filmCode: candidate.filmCode,
        renameApplied,
        note: keepOriginalReason,
        expectedCodeMatched: Boolean(candidate.expectedCodeMatched),
        size: Number(candidate.size || 0)
      });
      emitLog(
        onLog,
        'info',
        renameApplied
          ? `已移入待整理并按番号改名：${candidate.src} -> ${movedPath}`
          : `已移入待整理并保留原名：${candidate.src} -> ${movedPath}（${keepOriginalReason}）`
      );
    } catch (error) {
      summary.failedOperations += 1;
      waitingMoveFailedSources.add(normalizeAbsolutePath(path, candidate.src));
      emitLog(onLog, 'warn', `移动到待整理失败：${candidate.src}，原因：${error instanceof Error ? error.message : String(error)}`);
    }

    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'waiting-progress',
      total: candidates.length,
      processed: index + 1,
      deleteTotal: totalDeleteCount,
      introAdTotal: 0,
      failedOperations: summary.failedOperations
    });
  }

  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'delete-start',
    total: totalDeleteCount,
    processed: 0,
    adFileAction,
    introAdTotal: 0
  });

  const deleteConcurrency = dryRun
    ? 1
    : toPositiveInt(context.deleteConcurrency, adFileAction === 'delete-directly' ? 20 : 16);
  emitLog(onLog, 'info', `待删除阶段并发数：${deleteConcurrency}`);

  let deleteProcessed = 0;
  const pendingDeleteMap = new Map();
  (Array.isArray(pendingDelete) ? pendingDelete : []).forEach((item) => {
    const sourcePath = String(item && item.src ? item.src : '').trim();
    if (!sourcePath) {
      return;
    }
    pendingDeleteMap.set(normalizeAbsolutePath(path, sourcePath), item);
  });

  // 直接删除模式：移动完视频后，直接删除原文件夹，不再逐文件扫描
  if (!dryRun && adFileAction === 'delete-directly' && movedVideoFolders.size > 0) {
    const sortedDirs = Array.from(movedVideoFolders).sort((left, right) => right.length - left.length);
    let folderDeleteCount = 0;

    for (const sourceDir of sortedDirs) {
      if (checkAbort()) {
        break;
      }

      // 如果该文件夹下有移动失败的文件，跳过删除以保护数据
      let hasProtectedSource = false;
      for (const failedSource of waitingMoveFailedSources) {
        if (failedSource === sourceDir || failedSource.startsWith(`${sourceDir}${path.sep}`)) {
          hasProtectedSource = true;
          break;
        }
      }
      if (hasProtectedSource) {
        emitLog(onLog, 'warn', `原文件夹保留（存在移动失败文件）：${sourceDir}`);
        continue;
      }

      // 直接删除整个文件夹
      await fs.promises.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
      const dirExists = await fs.promises.stat(sourceDir).then(() => true).catch(() => false);
      if (!dirExists) {
        folderDeleteCount += 1;
        emitLog(onLog, 'info', `已删除原文件夹：${sourceDir}`);
      } else {
        emitLog(onLog, 'warn', `原文件夹删除失败：${sourceDir}`);
      }
    }

    emitLog(onLog, 'info', `文件夹删除完成：共删除 ${folderDeleteCount}/${movedVideoFolders.size} 个文件夹`);
  }

  // 后续保留原有的 pendingDelete 处理逻辑（用于非 delete-directly 模式）
  if (!dryRun && adFileAction === 'move-to-delete' && pendingDeleteMap.size > 0) {
    const directoryCandidates = new Set();
    for (const item of pendingDeleteMap.values()) {
      const sourcePath = normalizeAbsolutePath(path, item.src);
      const sourceDir = path.dirname(sourcePath);
      if (!sourceDir || sourceDir === normalizeAbsolutePath(path, paths.rootPath)) {
        continue;
      }
      if (isManagedRootChild(paths, path, sourceDir)) {
        continue;
      }
      directoryCandidates.add(sourceDir);
    }

    const sortedDirs = Array.from(directoryCandidates).sort((left, right) => left.length - right.length);
    for (const sourceDir of sortedDirs) {
      let hasProtectedSource = false;
      for (const failedSource of waitingMoveFailedSources) {
        if (failedSource === sourceDir || failedSource.startsWith(`${sourceDir}${path.sep}`)) {
          hasProtectedSource = true;
          break;
        }
      }
      if (hasProtectedSource) {
        continue;
      }

      await fs.promises.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
      const dirExists = await fs.promises.stat(sourceDir).then(() => true).catch(() => false);
      if (dirExists) {
        continue;
      }

      let removedInDir = 0;
      for (const [sourcePath] of Array.from(pendingDeleteMap.entries())) {
        if (sourcePath === sourceDir || sourcePath.startsWith(`${sourceDir}${path.sep}`)) {
          pendingDeleteMap.delete(sourcePath);
          removedInDir += 1;
        }
      }

      if (removedInDir > 0) {
        deleteProcessed += removedInDir;
        summary.deletedDirectly += removedInDir;
        emitLog(onLog, 'info', `已按目录快速删除：${sourceDir}（文件 ${removedInDir} 个）`);
        if (shouldReportProgress(deleteProcessed, totalDeleteCount, 40)) {
          emitProgress(onProgress, {
            scope: 'organizer',
            phase: 'delete-progress',
            total: totalDeleteCount,
            processed: deleteProcessed,
            adFileAction,
            introAdTotal: 0,
            failedOperations: summary.failedOperations
          });
        }
      }
    }
  }

  const remainingDeleteItems =
    adFileAction === 'delete-directly' && !dryRun ? Array.from(pendingDeleteMap.values()) : Array.from(pendingDeleteMap.values());

  async function processDeleteItem(item, deleteIndex) {
    const shouldLogDeleteDetail = Boolean(item.isVideo) || shouldReportProgress(deleteProcessed + 1, totalDeleteCount, 80);

    if (dryRun) {
      if (adFileAction === 'delete-directly') {
        summary.deletedDirectly += 1;
      } else {
        summary.movedToDelete += 1;
      }
      if (shouldLogDeleteDetail) {
        emitLog(
          onLog,
          'info',
          adFileAction === 'delete-directly' ? `[预览] 待直接删除：${item.src}` : `[预览] 待移入待删除：${item.src}`
        );
      }
    } else {
      try {
        if (adFileAction === 'delete-directly') {
          await fs.promises.unlink(item.src);
          summary.deletedDirectly += 1;
          if (shouldLogDeleteDetail) {
            emitLog(onLog, 'info', `已直接删除：${item.src}`);
          }
        } else {
          const destinationPath = resolveDeleteDestinationPath(paths, path, item.src);
          const movedPath = await moveWithUnique(item.src, destinationPath);
          summary.movedToDelete += 1;
          if (shouldLogDeleteDetail) {
            emitLog(onLog, 'info', `已移入待删除：${item.src} -> ${movedPath}`);
          }
        }
      } catch (error) {
        summary.failedOperations += 1;
        emitLog(
          onLog,
          'warn',
          `${adFileAction === 'delete-directly' ? '直接删除失败' : '移入待删除失败'}：${item.src}，原因：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    deleteProcessed += 1;
    if (shouldReportProgress(deleteProcessed, totalDeleteCount, 40)) {
      emitProgress(onProgress, {
        scope: 'organizer',
        phase: 'delete-progress',
        total: totalDeleteCount,
        processed: deleteProcessed,
        adFileAction,
        introAdTotal: 0,
        failedOperations: summary.failedOperations
      });
    }
  }

  if (deleteConcurrency <= 1) {
    for (let deleteIndex = 0; deleteIndex < remainingDeleteItems.length; deleteIndex += 1) {
      // eslint-disable-next-line no-await-in-loop
      await processDeleteItem(remainingDeleteItems[deleteIndex], deleteIndex);
    }
  } else {
    await runWithConcurrency(remainingDeleteItems, deleteConcurrency, processDeleteItem);
  }

  return {
    renameRecords
  };
}

module.exports = {
  runRenamePhase
};
