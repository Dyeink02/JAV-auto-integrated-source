async function runReportPhase(context = {}) {
  const {
    dryRun,
    paths,
    summary,
    expectedCodeSets,
    expectedCodeEntryMap,
    detectedFilmCodes,
    adRiskRecords,
    renameRecords,
    unmatchedRecords,
    buildSupplementMagnetEntries,
    mergeMagnetEntries,
    normalizeFilmId,
    sortCodeAlphabetically,
    emitLog,
    onLog,
    writeReports
  } = context;

  const adRiskCodes = sortCodeAlphabetically(
    new Set(
      (Array.isArray(adRiskRecords) ? adRiskRecords : [])
        .map((record) => normalizeFilmId(record && record.filmCode ? record.filmCode : ''))
        .filter(Boolean)
    )
  );
  const adRiskMagnetEntries = buildSupplementMagnetEntries(adRiskCodes, expectedCodeEntryMap);
  summary.supplementMagnetCount = adRiskMagnetEntries.reduce(
    (total, entry) => total + mergeMagnetEntries((entry && entry.magnets) || []).length,
    0
  );

  const missingCodes = sortCodeAlphabetically(
    new Set(Array.from((expectedCodeSets && expectedCodeSets.codeSet) || []).filter((code) => !detectedFilmCodes.has(code)))
  );
  const missingMagnetEntries = buildSupplementMagnetEntries(missingCodes, expectedCodeEntryMap);
  summary.missingCodeCount = missingCodes.length;
  summary.missingMagnetCount = missingMagnetEntries.reduce(
    (total, entry) => total + mergeMagnetEntries((entry && entry.magnets) || []).length,
    0
  );

  if (summary.missingCodeCount > 0) {
    emitLog(onLog, 'warn', `发现遗漏番号 ${summary.missingCodeCount} 条，已生成补抓磁力报告（总磁力 ${summary.missingMagnetCount} 条）。`);
  } else {
    emitLog(onLog, 'info', '未发现遗漏番号。');
  }

  let reportMap = {};
  if (!dryRun) {
    reportMap =
      (await writeReports(
        paths,
        summary,
        renameRecords,
        unmatchedRecords,
        adRiskRecords,
        adRiskMagnetEntries,
        missingMagnetEntries
      )) || {};
  }

  return {
    adRiskCodes,
    adRiskMagnetEntries,
    missingCodes,
    missingMagnetEntries,
    reportMap,
    reportFiles: dryRun
      ? []
      : [
          paths.renameMapPath,
          paths.unmatchedPath,
          paths.adRiskCodesPath,
          paths.adRiskDetailPath,
          paths.adRiskMagnetsPath,
          paths.missingMagnetsPath
        ]
  };
}

module.exports = {
  runReportPhase
};
