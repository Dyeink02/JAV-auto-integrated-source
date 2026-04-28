async function runJudgePhase(context = {}) {
  const {
    fs,
    files,
    minSizeBytes,
    adFileAction,
    expectedCodeSets,
    extractFilmCodeFromFile,
    normalizeFilmId,
    shouldReportProgress,
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

  const candidates = [];
  const pendingDelete = [];
  const unmatchedRecords = [];
  const detectedFilmCodes = new Set();
  const expectedCodeSet =
    expectedCodeSets && expectedCodeSets.codeSet instanceof Set ? expectedCodeSets.codeSet : new Set();
  const hasExpectedCodes = expectedCodeSet.size > 0;
  const adActionLogPrefix = adFileAction === 'delete-directly' ? '待直接删除' : '已归入待删除';

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    if (checkAbort()) {
      emitLog(onLog, 'warn', '整理任务已被停止（判断阶段）。');
      break;
    }
    await waitPause();
    const fileEntry = files[fileIndex] || {};
    const srcPath = String(fileEntry.path || '');
    if (!srcPath) {
      summary.failedOperations += 1;
      continue;
    }

    const scannedCount = fileIndex + 1;
    if (shouldReportProgress(scannedCount, files.length, 30)) {
      emitProgress(onProgress, {
        scope: 'organizer',
        phase: 'scan-progress',
        total: files.length,
        processed: scannedCount,
        videoTotal: summary.videoTotal,
        qualifiedVideo: summary.qualifiedVideo
      });
      emitLog(onLog, 'info', `扫描进度 ${scannedCount}/${files.length}（已识别视频 ${summary.videoTotal}，有效视频 ${summary.qualifiedVideo}）`);
    }

    const item = {
      src: srcPath,
      size: 0,
      isVideo: Boolean(fileEntry.isVideo),
      filmCode: '',
      renameByFilmCode: false,
      keepOriginalReason: '',
      expectedCodeMatched: false
    };

    if (item.isVideo) {
      const stat = await fs.promises.stat(srcPath).catch(() => null);
      if (!stat || !stat.isFile()) {
        summary.failedOperations += 1;
        emitLog(onLog, 'warn', `文件状态异常，已跳过：${srcPath}`);
        continue;
      }
      item.size = stat.size;
      summary.videoTotal += 1;
    }

    const isLargeVideo = item.isVideo && item.size >= minSizeBytes;
    if (!isLargeVideo) {
      let reason = '非视频文件';
      if (item.isVideo) {
        reason = '低于最小容量阈值，判定为广告文件';
        summary.skippedSmall += 1;
      }

      pendingDelete.push(item);
      unmatchedRecords.push({
        path: item.src,
        size: item.size,
        reason
      });
      if (item.isVideo) {
        emitLog(onLog, 'info', `${adActionLogPrefix}：${item.src}（${reason}）`);
      }
      continue;
    }

    summary.nonAdVideo += 1;
    const extractedFilmCode = extractFilmCodeFromFile(item.src, expectedCodeSets.tokenSet);
    const normalizedFilmCode = extractedFilmCode ? normalizeFilmId(extractedFilmCode) : '';
    const expectedMatched = Boolean(normalizedFilmCode) && (!hasExpectedCodes || expectedCodeSet.has(normalizedFilmCode));

    if (normalizedFilmCode) {
      item.filmCode = normalizedFilmCode;
      item.expectedCodeMatched = expectedMatched;
      detectedFilmCodes.add(normalizedFilmCode);
      if (hasExpectedCodes && expectedMatched) {
        summary.matchedToCrawlCode += 1;
      }
    }

    if (normalizedFilmCode && expectedMatched) {
      item.renameByFilmCode = true;
      emitLog(onLog, 'info', `识别为有效视频：${item.src} -> ${normalizedFilmCode}`);
    } else {
      item.renameByFilmCode = false;
      if (!normalizedFilmCode) {
        summary.skippedNoCode += 1;
        item.keepOriginalReason = '未识别番号，保留原名';
      } else {
        item.keepOriginalReason = `未命中爬虫番号名单（${normalizedFilmCode}），保留原名`;
      }

      emitLog(onLog, 'info', `识别为有效视频但保留原名：${item.src}（${item.keepOriginalReason}）`);
    }

    summary.qualifiedVideo += 1;
    candidates.push(item);
  }

  summary.unmatchedVideo = unmatchedRecords.length;
  summary.adFileCount = pendingDelete.length;
  summary.detectedCodeCount = detectedFilmCodes.size;

  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'scan-completed',
    total: files.length,
    processed: files.length,
    waitingTotal: candidates.length,
    deleteTotal: pendingDelete.length,
    introAdTotal: 0,
    videoTotal: summary.videoTotal,
    qualifiedVideo: summary.qualifiedVideo
  });

  return {
    candidates,
    pendingDelete,
    unmatchedRecords,
    detectedFilmCodes
  };
}

module.exports = {
  runJudgePhase
};
