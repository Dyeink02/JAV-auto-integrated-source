function createSettingsStore({ app, fs, path, appInfo, magnetFilename }) {
  function getSettingsPath() {
    return path.join(app.getPath('userData'), 'desktop-settings.json');
  }

  function getRankingCachePath() {
    return path.join(app.getPath('userData'), 'actress-ranking-cache.json');
  }

  function getDesktopTestOutputDir() {
    return path.join(app.getPath('temp'), 'jav-desktop-ui-test-output');
  }

  function getRankingHistoryDir() {
    return path.join(app.getPath('userData'), 'ranking-history');
  }

  function getRankingHistoryDirectories() {
    return [getRankingHistoryDir()];
  }

  function ensureRankingHistoryArtifacts() {
    const historyDir = getRankingHistoryDir();
    const guidePath = path.join(historyDir, 'ranking-history-guide.txt');
    const monthlyTemplatePath = path.join(historyDir, 'monthly-template.example.txt');
    const annualTemplatePath = path.join(historyDir, 'annual-template.example.txt');

    fs.mkdirSync(historyDir, { recursive: true });

    if (!fs.existsSync(guidePath)) {
      fs.writeFileSync(
        guidePath,
        [
          '本地历史榜单目录说明',
          '',
          '1. 你可以把历史榜单直接写成 JSON 文件后放进当前目录，软件会自动读取。',
          '2. 月榜建议文件名：2026-01-monthly.json',
          '3. 年榜建议文件名：2025-annual.json',
          '4. 支持字段：mode, sourceName, sourceUrl, title, periodLabel, periodYear, periodMonth, total, items',
          '5. items 内每条至少包含：rank, actressName',
          '',
          '如果你暂时没有真实数据，请不要直接伪造榜单内容。'
        ].join('\r\n'),
        'utf8'
      );
    }

    if (!fs.existsSync(monthlyTemplatePath)) {
      fs.writeFileSync(
        monthlyTemplatePath,
        [
          '{',
          '  "mode": "monthly",',
          '  "sourceName": "本地历史导入",',
          '  "sourceUrl": "",',
          '  "title": "2026年01月 本地历史月榜",',
          '  "periodLabel": "2026年01月",',
          '  "periodYear": 2026,',
          '  "periodMonth": 1,',
          '  "total": 2,',
          '  "items": [',
          '    { "rank": 1, "actressName": "示例女优A", "profileUrl": "", "imageUrl": "" },',
          '    { "rank": 2, "actressName": "示例女优B", "profileUrl": "", "imageUrl": "" }',
          '  ]',
          '}'
        ].join('\r\n'),
        'utf8'
      );
    }

    if (!fs.existsSync(annualTemplatePath)) {
      fs.writeFileSync(
        annualTemplatePath,
        [
          '{',
          '  "mode": "annual",',
          '  "sourceName": "本地历史导入",',
          '  "sourceUrl": "",',
          '  "title": "2025年 本地历史年榜",',
          '  "periodLabel": "2025年",',
          '  "periodYear": 2025,',
          '  "periodMonth": null,',
          '  "total": 2,',
          '  "items": [',
          '    { "rank": 1, "actressName": "示例女优A", "profileUrl": "", "imageUrl": "" },',
          '    { "rank": 2, "actressName": "示例女优B", "profileUrl": "", "imageUrl": "" }',
          '  ]',
          '}'
        ].join('\r\n'),
        'utf8'
      );
    }

    return {
      historyDir,
      guidePath,
      monthlyTemplatePath,
      annualTemplatePath
    };
  }

  function ensureDesktopTestArtifacts(outputDir = getDesktopTestOutputDir()) {
    fs.mkdirSync(outputDir, { recursive: true });

    const magnetFilePath = path.join(outputDir, magnetFilename);
    if (!fs.existsSync(magnetFilePath)) {
      fs.writeFileSync(magnetFilePath, 'magnet:?xt=urn:btih:desktop-test\n', 'utf8');
    }

    return {
      outputDir,
      magnetFilePath
    };
  }

  function getDefaultSettings() {
    return {
      base: appInfo.defaultBaseUrl || 'https://www.javbus.com',
      output: path.join(app.getPath('documents'), appInfo.outputFolderName || 'JAV自动化爬虫工具输出'),
      limit: 10,
      totalPages: 0,
      itemsPerPage: 30,
      parallel: 2,
      delay: 2,
      timeout: 30000,
      proxy: '',
      magnetExcludeKeywords: '',
      magnetContentValidation: false,
      cloudflare: false,
      nomag: false,
      allmag: false,
      nopic: false,
      secondValidation: true,
      taskTemplate: 'balanced',
      backgroundImage: '',
      organizerRoot: '',
      organizerMinSizeMB: 100,
      organizerSuffix: '-A',
      organizerAdFileAction: 'move-to-delete',
      organizerDryRun: false,
      organizerIncludeSubdirectories: true,
      organizerCrawlOutput: '',
      organizerStrictCodeMatch: true,
      organizerAdDetectionEnabled: true,
      organizerAdThreshold: 60,
      organizerAdKeywords: '',
      organizerAdModelType: 'mobile-net-v3-lite'
    };
  }

  function loadSettings() {
    const defaults = getDefaultSettings();
    const filePath = getSettingsPath();

    if (!fs.existsSync(filePath)) {
      return defaults;
    }

    try {
      const loadedSettings = {
        ...defaults,
        ...JSON.parse(fs.readFileSync(filePath, 'utf8'))
      };
      delete loadedSettings.exportCoverImages;
      return loadedSettings;
    } catch {
      return defaults;
    }
  }

  function saveSettings(settings) {
    const persistedSettings = {
      ...loadSettings(),
      ...settings
    };
    delete persistedSettings.resumeExisting;
    delete persistedSettings.exportCoverImages;

    fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(persistedSettings, null, 2), 'utf8');
  }

  function getCurrentOutputDir() {
    return loadSettings().output || app.getPath('documents');
  }

  function getMagnetFilePath(outputDir) {
    return path.join(outputDir || getCurrentOutputDir(), magnetFilename);
  }

  return {
    getSettingsPath,
    getRankingCachePath,
    getRankingHistoryDir,
    getRankingHistoryDirectories,
    ensureRankingHistoryArtifacts,
    getDesktopTestOutputDir,
    ensureDesktopTestArtifacts,
    getDefaultSettings,
    loadSettings,
    saveSettings,
    getCurrentOutputDir,
    getMagnetFilePath
  };
}

module.exports = {
  createSettingsStore
};
