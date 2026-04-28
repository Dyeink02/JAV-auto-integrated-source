function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
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
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => consume()));
}

function resolveIntroAdDestinationPath(paths, path, sourcePath) {
  const introAdRoot = String((paths && paths.introAdDir) || '').trim();
  const waitingRoot = String((paths && paths.waitingDir) || '').trim();
  const normalizedSource = String(sourcePath || '').trim();
  if (!introAdRoot || !normalizedSource) {
    return path.join(introAdRoot, path.basename(normalizedSource));
  }

  if (waitingRoot) {
    const relativePath = path.relative(waitingRoot, normalizedSource);
    const isSafeRelative =
      relativePath &&
      !relativePath.startsWith('..') &&
      !path.isAbsolute(relativePath) &&
      !relativePath.includes(`..${path.sep}`);

    if (isSafeRelative) {
      return path.join(introAdRoot, relativePath);
    }
  }

  return path.join(introAdRoot, path.basename(normalizedSource));
}

function buildAdRiskReason(adRiskResult = {}) {
  const reasonParts = [];
  if (Number.isFinite(adRiskResult.score) && Number.isFinite(adRiskResult.threshold)) {
    reasonParts.push(`开头广告风险评分 ${adRiskResult.score}/${adRiskResult.threshold}`);
  }

  if (Array.isArray(adRiskResult.reasons) && adRiskResult.reasons.length > 0) {
    reasonParts.push(adRiskResult.reasons.join('；'));
  }

  return reasonParts.length > 0 ? reasonParts.join('；') : '命中开头广告风险';
}

async function runIntroAdPhase(context = {}) {
  const {
    fs,
    path,
    dryRun,
    paths,
    renameRecords,
    adDetectionEnabled,
    adThreshold,
    evaluateAdRisk,
    autoLearnFromDetection,
    normalizeFilmId,
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

  const records = Array.isArray(renameRecords) ? renameRecords : [];
  const adRiskRecords = [];
  const introAdRecords = [];

  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'intro-ad-start',
    total: records.length,
    processed: 0,
    failedOperations: summary.failedOperations
  });

  if (!adDetectionEnabled) {
    emitLog(onLog, 'info', '已关闭开头广告检测，跳过后置复核阶段。');
    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'intro-ad-progress',
      total: records.length,
      processed: records.length,
      failedOperations: summary.failedOperations
    });
    return {
      adRiskRecords,
      introAdRecords
    };
  }

  if (typeof evaluateAdRisk !== 'function') {
    emitLog(onLog, 'warn', '开头广告检测已启用，但当前无可用评估服务，已跳过后置复核。');
    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'intro-ad-progress',
      total: records.length,
      processed: records.length,
      failedOperations: summary.failedOperations
    });
    return {
      adRiskRecords,
      introAdRecords
    };
  }

  const introAdConcurrency = dryRun ? 1 : toPositiveInt(context.introAdConcurrency, 4);
  emitLog(onLog, 'info', `开头广告后置复核并发数：${introAdConcurrency}`);

  let processed = 0;
  async function processItem(record, index) {
    if (checkAbort()) return;
    await waitPause();
    const waitingPath = String(record && record.waitingPath ? record.waitingPath : '').trim();
    const filmCode = normalizeFilmId(record && record.filmCode ? record.filmCode : '');
    const size = Number(record && record.size ? record.size : 0);

    if (!waitingPath) {
      summary.failedOperations += 1;
      emitLog(onLog, 'warn', '开头广告后置复核跳过：缺少待整理路径。');
    } else {
      emitLog(onLog, 'info', `正在检测开头广告：${filmCode || path.basename(waitingPath)} (${processed + 1}/${records.length})`);
      try {
        if (!dryRun) {
          const stat = await fs.promises.stat(waitingPath).catch(() => null);
          if (!stat || !stat.isFile()) {
            throw new Error('待整理文件不存在或不可访问');
          }
        }

        const adRiskResult = await evaluateAdRisk({
          videoPath: waitingPath,
          filmCode,
          adThreshold
        });

        // Enhanced detection evidence logging
        if (adRiskResult) {
          const code = filmCode || path.basename(waitingPath);
          const ev = adRiskResult.evidence || {};
          const cs = ev.coarseStage || {};
          const coarseParts = [];
          if (cs.byTemplate) coarseParts.push(`模板(${cs.byTemplate.avgDistance})`);
          if (cs.byAdSample) coarseParts.push(`样本(${cs.byAdSample.avgDistance})`);
          if (cs.byKeyword) coarseParts.push('关键词');
          if (cs.byVisual) coarseParts.push('视觉');
          if (cs.byTransition) coarseParts.push('过渡');
          const coarseStr = coarseParts.length > 0 ? coarseParts.join('+') : '无';
          const bestAd = adRiskResult.bestAdDistance != null ? adRiskResult.bestAdDistance : '-';
          const bestNorm = adRiskResult.bestNormalDistance != null ? adRiskResult.bestNormalDistance : '-';
          const verdict = adRiskResult.isAd ? '广告' : '正常';
          emitLog(onLog, 'info',
            `[检测] ${code} | 得分:${adRiskResult.score}/${adRiskResult.threshold} | 粗筛:${coarseStr} | 最近广告样本:${bestAd} 正常样本:${bestNorm} | 判定:${verdict}`
          );
        }

        if (adRiskResult && adRiskResult.isAd) {
          const reasonText = buildAdRiskReason(adRiskResult);
          let destinationPath = waitingPath;
          let movedToIntroAd = false;
          summary.adRiskRejected += 1;

          // Task 7: Auto-learn from high-confidence detection results
          if (typeof autoLearnFromDetection === 'function') {
            try {
              const learnResult = autoLearnFromDetection({
                videoPath: waitingPath,
                isAd: true,
                score: adRiskResult.score,
                aHashes: (adRiskResult.evidence && adRiskResult.evidence.frameHashes || []).map((fh) => fh.hashBits || ''),
                dHashes: (adRiskResult.evidence && adRiskResult.evidence.frameHashes || []).map((fh) => fh.hashBitsD || ''),
                frameStatsList: [],
                frameSeconds: (adRiskResult.evidence && adRiskResult.evidence.model && adRiskResult.evidence.model.frameSeconds) || [],
                filmCode,
                adBestDistance: adRiskResult.bestAdDistance,
                normalBestDistance: adRiskResult.bestNormalDistance
              });
              if (learnResult && (learnResult.adSamplesAdded > 0 || learnResult.normalSamplesAdded > 0)) {
                emitLog(onLog, 'info', `\u81ea\u52a8\u5b66\u4e60\u53cd\u9988\uff1a\u65b0\u589e\u5e7f\u544a\u6837\u672c ${learnResult.adSamplesAdded} \u4e2a\uff0c\u6b63\u5e38\u6837\u672c ${learnResult.normalSamplesAdded} \u4e2a`);
              }
            } catch (learnError) {
              // Non-critical: auto-learning failure should not block organizer
              emitLog(onLog, 'warn', `\u81ea\u52a8\u5b66\u4e60\u53cd\u9988\u5931\u8d25\uff1a${learnError instanceof Error ? learnError.message : String(learnError)}`);
            }
          }

          if (!dryRun) {
            try {
              const targetPath = resolveIntroAdDestinationPath(paths, path, waitingPath);
              destinationPath = await moveWithUnique(waitingPath, targetPath);
              summary.movedToIntroAd += 1;
              summary.movedToWaiting = Math.max(0, Number(summary.movedToWaiting || 0) - 1);
              movedToIntroAd = true;
            } catch (moveError) {
              summary.failedOperations += 1;
              emitLog(
                onLog,
                'warn',
                `命中开头广告风险，但移入“含开头广告”失败：${waitingPath}，原因：${
                  moveError instanceof Error ? moveError.message : String(moveError)
                }`
              );
            }
          } else {
            summary.movedToIntroAd += 1;
            summary.movedToWaiting = Math.max(0, Number(summary.movedToWaiting || 0) - 1);
            movedToIntroAd = true;
          }

          introAdRecords.push({
            filmCode,
            path: destinationPath,
            size
          });
          adRiskRecords.push({
            filmCode,
            sourcePath: destinationPath,
            size,
            score: adRiskResult.score,
            threshold: adRiskResult.threshold,
            reasons: Array.isArray(adRiskResult.reasons) ? adRiskResult.reasons : [],
            evidence: adRiskResult.evidence || null
          });
          emitLog(
            onLog,
            movedToIntroAd ? 'warn' : 'info',
            movedToIntroAd
              ? `命中开头广告风险，已归入“含开头广告”：${waitingPath} -> ${destinationPath}（${reasonText}）`
              : `命中开头广告风险，保留在待整理待人工复核：${waitingPath}（${reasonText}）`
          );
        }
      } catch (error) {
        summary.adDetectionErrors += 1;
        emitLog(onLog, 'warn', `开头广告后置复核失败：${waitingPath}，原因：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    processed += 1;
    // Emit progress for every item so the user can see which film is being processed
    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'intro-ad-progress',
      total: records.length,
      processed,
      currentFilmCode: filmCode || '',
      failedOperations: summary.failedOperations
    });
    emitLog(onLog, 'info', `开头广告后置复核进度 ${processed}/${records.length}`);
  }

  if (introAdConcurrency <= 1) {
    for (let index = 0; index < records.length; index += 1) {
      if (checkAbort()) break;
      // eslint-disable-next-line no-await-in-loop
      await processItem(records[index], index);
    }
  } else {
    await runWithConcurrency(records, introAdConcurrency, processItem);
  }

  // Guarantee a final progress event on completion/abort
  emitProgress(onProgress, {
    scope: 'organizer',
    phase: 'intro-ad-progress',
    total: records.length,
    processed,
    failedOperations: summary.failedOperations
  });

  return {
    adRiskRecords,
    introAdRecords
  };
}

module.exports = {
  runIntroAdPhase
};
