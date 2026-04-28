const { pipeline } = require('stream/promises');
const progressSchema = require('../common/progressSchema.js');
const { runScanPhase } = require('./organizerModules/scanPhase.js');
const { runJudgePhase } = require('./organizerModules/judgePhase.js');
const { runRenamePhase } = require('./organizerModules/renamePhase.js');
const { runIntroAdPhase } = require('./organizerModules/introAdPhase.js');
const { runReportPhase } = require('./organizerModules/reportPhase.js');
const { runCleanupPhase } = require('./organizerModules/cleanupPhase.js');
const {
  MANAGED_TOP_DIRS,
  MANAGED_TOP_DIRS_LOWER,
  emitLog,
  emitProgress,
  shouldReportProgress,
  isManagedDirectoryName,
  toSafeInteger,
  formatBytesToGB,
  normalizeAdFileAction,
  getAdFileActionLabel,
  normalizeSuffixInput,
  normalizeFilmId,
  normalizeCodeToken,
  extractFilmId,
  sortCodeAlphabetically,
  createFsHelpers
} = require('./organizerModules/organizerUtils.js');
const {
  PROGRESS_REPORT_STEP,
  MAX_CONFLICT_RENAME_ATTEMPTS,
  EMPTY_DIR_DELETE_MAX_RETRIES,
  DIR_DELETE_DEFAULT_MAX_ATTEMPTS,
  ROOT_CLEANUP_FIRST_SWEEP_ATTEMPTS,
  ROOT_CLEANUP_SECOND_SWEEP_ATTEMPTS,
  AD_RISK_HIGH_CONFIDENCE_SCORE,
  AD_RISK_REVIEW_SCORE
} = require('./organizerConstants.js');

function createOrganizerService({ fs, path }) {
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.ts', '.m4v']);
  const REPORT_FILES = {
    renameMap: '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈠煕濮橆厽銇濆┑陇鍩栧鍕偓锝庝簷濡叉劙姊绘笟鈧褑澧濋梺鍝勬噺閻╊垰顕ｉ崨濠冨缂侇垱娲橀弬鈧梻浣侯焾閺堫剛鍒掗悩缁樺€块柛鎾楀懐锛滈梺閫炲苯澧寸€规洖銈搁崺妤呭煛娴ｅ嘲顥氭俊銈囧Х閸嬫盯鎮樺┑瀣婵鍩栭悡娆撴煕閹邦垰鐨虹紒鐘哄吹閳ь剝顫夊ú姗€宕濆▎鎾崇畺濞寸姴顑呭婵嗏攽閻樻彃鈧敻宕戦幘缁樺仺闁告稑艌閹峰姊洪崜鎻掍簽闁哥姵鎹囬崺濠囧即閵忊€充化闂佽婢樻晶搴ｅ姬閳ь剟姊?txt',
    unmatched: '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偞鐗犻、鏇㈡晜閽樺缃曟繝鐢靛Т閿曘倗鈧凹鍣ｉ妴鍛村蓟閵夛妇鍙嗗┑鐘绘涧濡厼危瑜版帗鐓曢幖绮规闊剟鏌″畝鈧崰鎰焽韫囨稑绀堢憸蹇涘汲閻樼數纾藉ù锝嗗絻娴滈箖姊虹化鏇炲⒉閼垦兠瑰鍕煉闁哄瞼鍠栭獮宥夋惞椤愶絿褰呴梻渚€鈧偛鑻晶顖炴煟濡や焦绀嬮柛鈹垮灲楠炴ê煤缂佹ɑ娅岄梻浣告啞濞诧箓宕滃☉銏犲偍闁告鍋愰弨浠嬫煟閹邦剙绾фい銉у仱閺屾盯濡搁妷褍鐓熼梺璇″枤閸嬨倝鐛幇顓熷劅婵炴垶顨堥惄搴繆閻愵亜鈧牠宕濋幋锕€鏄ラ柛鏇ㄥ灠绾惧潡鏌熼幍顔碱暭闁?txt',
    deleteList: '闂傚倸鍊搁崐鎼佸磹妞嬪海鐭嗗〒姘ｅ亾妤犵偛顦甸弫宥夊礋椤掍焦顔囬梻浣虹帛閸旀洟顢氶鐘典笉濡わ絽鍟悡鍐喐濠婂牆绀堟慨妯块哺瀹曞弶绻涢幋娆忕仼鐎瑰憡绻冮妵鍕箻閸楃偟鍔撮梺閫炲苯澧い銊ワ躬瀵寮撮姀鐘茶€垮┑鈽嗗灣閸庛倗鎷犻悙鐑樺€甸悷娆忓绾炬悂鏌涢弮鈧崹鍧楀Υ娴ｅ壊娼ㄩ柍褜鍓熼獮鍐ㄢ枎韫囧﹥鐏侀梺鍦焾瀹?txt',
    adRiskCodes: '婵犵數濮撮惀澶愬级鎼存挸浜炬俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁惧墽绮换娑㈠箣濞嗗繒浠鹃梺绋匡龚閸╂牜鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｅ搫啸闁哥姵鐗犲璇差吋婢跺﹦鍘告繛杈剧到閹诧繝鎮橀幘鏂ユ斀闁绘劘灏欐晶娑欍亜閵娿儲顥㈡鐐茬墦婵℃悂濡烽钘夌槣闂佽崵濮村ú鈺侇嚕閹惧鐝堕柡鍥╁枍缁诲棝鏌ｉ幇鍏哥盎闁逞屽墯閸ㄥ灝鐣烽弴銏犺摕闁靛鍎抽澶愭⒑閹肩偛鍔€閻忕偛澧界粙浣糕攽閻愬樊鍤熷┑顔芥尦椤㈡牠宕ㄧ€涙ê浜楀┑鐐村灟閸ㄦ椽鎮￠弴銏＄厵闁煎壊鍓欐俊鑺ョ箾閸涱厽顥為柕鍥у瀵剟宕归鑺ヮ啋婵?txt',
    adRiskDetail: '婵犵數濮撮惀澶愬级鎼存挸浜炬俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁惧墽绮换娑㈠箣濞嗗繒浠鹃梺绋匡龚閸╂牜鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｅ搫啸闁哥姵鐗犲璇差吋婢跺﹦鍘告繛杈剧到閹诧繝鎮橀幘鏂ユ斀闁斥晛鍟徊鑽ょ磽瀹ュ拑韬柣娑卞櫍瀵粙鈥栭妷銉╁弰妞ゃ垺顨婇崺鈧い鎺嶆缁诲棗霉閻樺樊鍎愰柣鎾跺枑缁绘繈宕归锝呮殫闂佷紮绲块弫濠氬蓟閿涘嫪娌柛鎾楀嫬鍨辨俊銈囧Х閸嬬偟鏁敓鐘靛祦閻庯綆鍠楅崐濠氭煕閳╁喛鍏Δ鐘茬箲缁绘繂顕ラ柨瀣凡闁逞屽墯椤ㄥ棝骞堥妸鈺佺骇闁圭偨鍔嶅浠嬨€佸鈧幃婊堝幢濡や緡鍚欓梻鍌欒兌缁垶銆冮崨瀛樺亱濠电姴娲ょ壕鍧楁煟閺傚灝鎮戦柣鎾卞劜缁绘繈妫冨☉娆樻！閻庣懓鎲＄换鍫ュ蓟?txt',
    adRiskMagnets: '婵犵數濮撮惀澶愬级鎼存挸浜炬俊銈勭劍閸欏繘鏌ｉ幋锝嗩棄缁惧墽绮换娑㈠箣濞嗗繒浠鹃梺绋匡龚閸╂牜鎹㈠┑瀣棃婵炴垵宕崜鎵磽娴ｅ搫啸闁哥姵鐗犲璇差吋婢跺﹦鍘告繛杈剧到閹诧繝鎮橀幘鏂ユ斀闁绘劘灏欐晶娑欍亜閵娿儲顥㈡鐐茬墦婵℃悂濡烽钘夌槣闂佽崵濮村ú鈺侇嚕閹惧鐝堕柡鍥╁枍缁诲棝鏌ｉ幇鍏哥盎闁逞屽墯閸ㄥ灝鐣烽弴銏犺摕闁靛鍎抽澶愭⒑閹肩偛鍔€閻忕偛澧界粙浣糕攽閻愬樊鍤熷┑顔芥尦椤㈡牠宕ㄧ€涙ê浜楀┑鐐村灟閸ㄦ椽鎮￠弴銏＄厵闂侇叏绠戦弸娑樏瑰鍫㈢暫闁哄苯绉归弻銊р偓锝庡墮閳峰苯鈹戦纭锋敾婵＄偠妫勯悾鐑藉Ω閿斿墽鐦堥梺鍛婂姧缁插墽鈧俺宕电槐鎾诲磼濞嗘埈妲銈嗗灥濡繈骞冭閹瑩宕ｉ崒娑氭创濠殿喒鍋撻梺闈涚墕濡矂骞?txt',
    missingMagnets: '闂傚倸鍊搁崐鎼佸磹閹间礁纾瑰瀣椤愪粙鏌ㄩ悢鍝勑㈢紒鈧崼鐔稿弿婵☆垵娉曢崼顏堟煃瑜滈崜娆撳疮閺夋垹鏆﹂柛妤冨亹閺嬪酣鏌熼弶璺ㄤ粵缂傚秵顨婂缁樻媴閼恒儳銆婇梺鍝ュУ閹稿骞堥妸鈺傚仺缂佸娉曢敍娑㈡⒑閸愬弶鎯堥柛濠呭煐缁傚秴顭ㄩ崼銏犲絼闂佹悶鍎崝宥囦焊椤撶喆浜滈煫鍥э攻濞呭懘鏌嶇憴鍕伌闁诡喗鐟╁畷锝嗗緞婵犲嫮宕洪梻鍌欑劍閻綊宕曢悜妯碱洸妞ゅ繐瀚弳锕傛煥濠靛棭妲搁崬顖炴偡濠婂嫮鐭婇崡杈ㄣ亜閺冨倹娅曠紒鈾€鍋撴繝鐢靛仜閻楀棝鎮樺┑瀣嚑婵炴垶姘ㄧ壕鑲╃磽娴ｅ顏劽归绛嬫闁绘劖褰冮弳鐐烘倵闂堟稏鍋㈢€殿喖鐖奸獮濠囨倷閽樺顫囬梺鍝勮閸旀垵顕ｉ弶鎳虫棃鍩€椤掍胶顩查柟顖嗗本瀵?txt'
  };
  const NORMALIZED_REPORT_FILES = {
    renameMap: '\u66f4\u6539\u524d\u540e\u5bf9\u7167.txt',
    unmatched: '\u672a\u8bc6\u522b\u756a\u53f7\u89c6\u9891.txt',
    adRiskCodes: '\u542b\u5f00\u5934\u5e7f\u544a\u756a\u53f7.txt',
    adRiskDetail: '\u542b\u5f00\u5934\u5e7f\u544a\u660e\u7ec6.txt',
    adRiskMagnets: '\u542b\u5f00\u5934\u5e7f\u544a\u8865\u6293\u78c1\u529b.txt',
    missingMagnets: '\u9057\u6f0f\u756a\u53f7\u78c1\u529b\u8865\u6293.txt'
  };
  const LEGACY_REPORT_FILE_NAMES = Object.freeze([
    '删除清单.txt',
    '广告高风险番号.txt',
    '广告风险分级明细.txt',
    '广告高风险磁力补抓.txt'
  ]);
  const CRAWL_FILM_DATA_FILE = 'filmData.json';
  const PREFIX_BLACKLIST = new Set([
    'H264',
    'H265',
    'X264',
    'X265',
    'HEVC',
    'AAC',
    'DTS',
    'WEB',
    'WEBRIP',
    'WEBDL',
    'BLURAY',
    'UHD',
    'FHD',
    'HD',
    'SD',
    'MP4',
    'MKV',
    'TS',
    'AVI',
    'MOV',
    'M4V'
  ]);

  const { pathExists, ensureDirectory, writeTextFile, normalizeRootPath } = createFsHelpers({ fs, path });

  function buildExpectedCodeSets(rawCodes) {
    const codes = Array.isArray(rawCodes) ? rawCodes : [];
    const codeSet = new Set();
    const tokenSet = new Set();

    codes.forEach((code) => {
      const normalizedCode = normalizeFilmId(code);
      if (!normalizedCode) {
        return;
      }

      codeSet.add(normalizedCode);
      const token = normalizeCodeToken(normalizedCode);
      if (token) {
        tokenSet.add(token);
      }
    });

    return {
      codeSet,
      tokenSet
    };
  }

  function normalizeMagnetEntry(rawEntry) {
    if (!rawEntry) {
      return null;
    }

    if (typeof rawEntry === 'string') {
      const link = rawEntry.trim();
      if (!link) {
        return null;
      }
      return {
        link,
        size: ''
      };
    }

    if (typeof rawEntry !== 'object') {
      return null;
    }

    const link = String(rawEntry.link || rawEntry.magnet || '').trim();
    if (!link) {
      return null;
    }

    return {
      link,
      size: String(rawEntry.size || '').trim()
    };
  }

  function normalizeMagnetEntries(rawValue) {
    const list = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === 'string'
        ? rawValue
            .split(/\r?\n+/)
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

    const output = [];
    const seen = new Set();

    list.forEach((rawEntry) => {
      const entry = normalizeMagnetEntry(rawEntry);
      if (!entry) {
        return;
      }

      const key = entry.link.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      output.push(entry);
    });

    return output;
  }

  function mergeMagnetEntries(...groups) {
    const merged = [];
    const seen = new Set();

    groups.forEach((group) => {
      normalizeMagnetEntries(group).forEach((entry) => {
        const key = entry.link.toLowerCase();
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        merged.push(entry);
      });
    });

    return merged;
  }

  function buildExpectedCodeEntryMap(rawEntries) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const map = new Map();

    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }

      const code = normalizeFilmId(entry.code || '');
      if (!code) {
        return;
      }

      const existing = map.get(code) || [];
      const merged = mergeMagnetEntries(existing, entry.magnets);
      map.set(code, merged);
    });

    return map;
  }

  function extractRecordCode(record) {
    if (!record || typeof record !== 'object') {
      return '';
    }

    const candidates = [record.filmCode, record.sourceLink, record.code, record.title, record.fileName];
    for (const candidate of candidates) {
      const parsed = extractFilmId(candidate || '');
      if (parsed) {
        return parsed;
      }
    }

    return '';
  }

  function extractRecordMagnetEntries(record) {
    if (!record || typeof record !== 'object') {
      return [];
    }

    return mergeMagnetEntries(record.backupMagnetLinks, record.magnetLinks, record.magnet, record.magnets);
  }

  function isVideoFile(filePath) {
    return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }

  function stripDomainNoise(value) {
    return String(value || '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/[a-z0-9-]+\.(com|net|org|cn|cc|tv|xyz|me|vip|top)/gi, ' ')
      .trim();
  }

  function extractAdvancedFilmCode(value) {
    const compact = String(value || '')
      .toUpperCase()
      .replace(/\s+/g, '');
    const patterns = [
      /^([A-Z]{2,6})[-_]?(\d{2,6})$/,
      /^(N\d{3,6})$/,
      /^(T-?\d{3,6})$/,
      /^(CARIB\d{2,6})$/,
      /^(HEYZO\d{2,6})$/,
      /^(1PONDO\d{2,6})$/
    ];

    for (const pattern of patterns) {
      const match = compact.match(pattern);
      if (!match) {
        continue;
      }

      if (match.length === 3) {
        return normalizeFilmId(`${match[1]}-${match[2]}`);
      }

      return normalizeFilmId(String(match[1] || '').replace(/_/g, '-'));
    }

    return '';
  }

  function extractFilmCodeFromFile(filePath, expectedTokenSet) {
    const expectedTokens = expectedTokenSet || new Set();
    let baseName = path.basename(filePath, path.extname(filePath));
    const atIndex = baseName.lastIndexOf('@');
    if (atIndex >= 0 && atIndex + 1 < baseName.length) {
      baseName = baseName.slice(atIndex + 1);
    }

    baseName = stripDomainNoise(baseName);
    const normalized = baseName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();

    if (!normalized) {
      return '';
    }

    const compact = normalized.replace(/\s+/g, '');
    if (expectedTokens.size > 0) {
      for (const token of expectedTokens) {
        if (compact.includes(token)) {
          return normalizeFilmId(token);
        }
      }
    }

    const advanced = extractAdvancedFilmCode(normalized);
    if (advanced) {
      return advanced;
    }

    const fc2Match = normalized.match(/\bFC2[-_ ]*PPV[-_ ]*([0-9]{5,8})\b/i);
    if (fc2Match) {
      return normalizeFilmId(`FC2-PPV-${fc2Match[1]}`);
    }

    const standardMatch = normalized.match(/([A-Z]{2,12})[-_ ]*([0-9]{2,8})/i);
    if (standardMatch) {
      const prefix = String(standardMatch[1] || '').toUpperCase();
      const number = String(standardMatch[2] || '');
      if (!PREFIX_BLACKLIST.has(prefix)) {
        return normalizeFilmId(`${prefix}-${number}`);
      }
    }

    const compactMatch = normalized.match(/\b([A-Z]{2,12})([0-9]{2,8})\b/i);
    if (compactMatch) {
      const prefix = String(compactMatch[1] || '').toUpperCase();
      const number = String(compactMatch[2] || '');
      if (!PREFIX_BLACKLIST.has(prefix)) {
        return normalizeFilmId(`${prefix}-${number}`);
      }
    }

    return '';
  }

  function alphaIndexToText(n) {
    let index = Math.max(1, n);
    let output = '';
    while (index > 0) {
      index -= 1;
      output = String.fromCharCode(65 + (index % 26)) + output;
      index = Math.floor(index / 26);
    }
    return output;
  }

  function isAlphaNumericAscii(charCode) {
    return (
      (charCode >= 48 && charCode <= 57) ||
      (charCode >= 65 && charCode <= 90) ||
      (charCode >= 97 && charCode <= 122)
    );
  }

  function parseConflictSuffixStrategy(rawInput) {
    const raw = normalizeSuffixInput(rawInput);

    if (/\s/.test(raw)) {
      throw new Error('冲突后缀不能包含空格，请使用类似 -A、-1 或 _DUP 的格式。');
    }

    const alphaMatch = raw.match(/^(.*?)([A-Za-z])$/);
    if (alphaMatch) {
      const prefix = alphaMatch[1] || '';
      const lastPrefixChar = prefix ? prefix.charCodeAt(prefix.length - 1) : 0;
      const canUseAlpha = !prefix || !isAlphaNumericAscii(lastPrefixChar);
      if (canUseAlpha) {
        const startChar = String(alphaMatch[2] || 'A').toUpperCase().charCodeAt(0) - 64;
        return {
          mode: 'alpha',
          prefix,
          startChar: Math.min(Math.max(startChar, 1), 26),
          startNum: 1,
          raw
        };
      }
    }

    const numericMatch = raw.match(/^(.*?)(\d+)$/);
    if (numericMatch) {
      return {
        mode: 'num',
        prefix: numericMatch[1] || '',
        startChar: 1,
        startNum: Math.max(1, Number.parseInt(numericMatch[2], 10) || 1),
        raw
      };
    }

    return {
      mode: 'num',
      prefix: raw,
      startChar: 1,
      startNum: 1,
      raw
    };
  }

  function formatSuffix(strategy, sequence) {
    if (strategy.mode === 'alpha') {
      return `${strategy.prefix}${alphaIndexToText(strategy.startChar + sequence)}`;
    }
    return `${strategy.prefix}${strategy.startNum + sequence}`;
  }

  function resolvePaths(rootPath) {
    const normalizedRootPath = normalizeRootPath(rootPath);

    const result = {
      rootPath: normalizedRootPath,
      waitingDir: path.join(normalizedRootPath, '\u5f85\u6574\u7406'),
      toDeleteDir: path.join(normalizedRootPath, '\u5f85\u5220\u9664'),
      introAdDir: path.join(normalizedRootPath, '\u542b\u5f00\u5934\u5e7f\u544a'),
      logsDir: path.join(normalizedRootPath, 'logs'),
      stateDir: path.join(normalizedRootPath, '.video-organizer-state'),
      renameMapPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.renameMap),
      unmatchedPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.unmatched),
      adRiskCodesPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.adRiskCodes),
      adRiskDetailPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.adRiskDetail),
      adRiskMagnetsPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.adRiskMagnets),
      missingMagnetsPath: path.join(normalizedRootPath, NORMALIZED_REPORT_FILES.missingMagnets)
    };

    // Path traversal guard: ensure all resolved paths remain inside the root
    for (const [key, val] of Object.entries(result)) {
      if (key === 'rootPath') continue;
      const resolved = path.resolve(val);
      if (!resolved.startsWith(normalizedRootPath + path.sep) && resolved !== normalizedRootPath) {
        throw new Error(`路径越界：${key} 不在根目录内 (${resolved})`);
      }
    }

    return result;
  }

  function resolveTargetPath(rootPath, kind = 'root') {
    const paths = resolvePaths(rootPath);
    switch (String(kind || 'root')) {
      case 'waiting':
        return paths.waitingDir;
      case 'delete':
        return paths.toDeleteDir;
      case 'intro-ad':
        return paths.introAdDir;
      case 'logs':
        return paths.logsDir;
      case 'reports':
        return paths.rootPath;
      case 'root':
      default:
        return paths.rootPath;
    }
  }

  function resolveCrawlOutputPaths(outputDir) {
    const normalizedOutputDir = normalizeRootPath(outputDir);
    return {
      outputDir: normalizedOutputDir,
      filmDataPath: path.join(normalizedOutputDir, CRAWL_FILM_DATA_FILE)
    };
  }

  async function cleanupLegacyReportFiles(rootPath, onLog) {
    if (!rootPath || !path.isAbsolute(rootPath)) {
      return 0;
    }

    let removedCount = 0;
    for (const fileName of LEGACY_REPORT_FILE_NAMES) {
      const legacyPath = path.join(rootPath, fileName);
      const stat = await fs.promises.stat(legacyPath).catch(() => null);
      if (!stat || !stat.isFile()) {
        continue;
      }

      await fs.promises.rm(legacyPath, { force: true }).catch(() => {});
      removedCount += 1;
      emitLog(onLog, 'info', `已清理历史报告：${legacyPath}`);
    }

    return removedCount;
  }

  async function renameOrCopy(srcPath, targetPath) {
    try {
      await fs.promises.rename(srcPath, targetPath);
      return;
    } catch {
      await ensureDirectory(path.dirname(targetPath));
      const readStream = fs.createReadStream(srcPath);
      const writeStream = fs.createWriteStream(targetPath);
      try {
        await pipeline(readStream, writeStream);
      } catch (pipelineError) {
        readStream.destroy();
        writeStream.destroy();
        // Best-effort cleanup of partially written target
        await fs.promises.unlink(targetPath).catch(() => {});
        throw pipelineError;
      }
      await fs.promises.unlink(srcPath);
    }
  }

  async function moveWithUnique(srcPath, desiredTargetPath) {
    await ensureDirectory(path.dirname(desiredTargetPath));

    let targetPath = desiredTargetPath;
    if (await pathExists(targetPath)) {
      const extension = path.extname(desiredTargetPath);
      const baseName = path.basename(desiredTargetPath, extension);
      const parentDir = path.dirname(desiredTargetPath);

      for (let index = 1; index <= MAX_CONFLICT_RENAME_ATTEMPTS; index += 1) {
        const candidate = path.join(parentDir, `${baseName}_DUP${index}${extension}`);
        if (!(await pathExists(candidate))) {
          targetPath = candidate;
          break;
        }
      }
    }

    await renameOrCopy(srcPath, targetPath);
    return targetPath;
  }

  async function collectFiles(rootPath, includeSubdirectories, signal, isPaused) {
    const files = [];

    async function walk(currentPath, topDirName = '') {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (signal && signal.aborted) {
          return;
        }
        if (typeof isPaused === 'function') {
          while (isPaused() && !(signal && signal.aborted)) {
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        const entryPath = path.join(currentPath, entry.name);
        if (entry.isFile()) {
          files.push({
            path: entryPath,
            isVideo: isVideoFile(entryPath)
          });
          continue;
        }

        if (!entry.isDirectory()) {
          continue;
        }

        const nextTopDirName = topDirName || entry.name;
        if (isManagedDirectoryName(nextTopDirName) || isManagedDirectoryName(entry.name)) {
          continue;
        }

        if (!includeSubdirectories) {
          continue;
        }

        await walk(entryPath, nextTopDirName);
      }
    }

    await walk(rootPath, '');
    return files;
  }

  async function cleanupEmptyDirectories(rootPath, options = {}) {
    const preservedTopDirs = options.preservedTopDirs instanceof Set ? options.preservedTopDirs : MANAGED_TOP_DIRS;
    const removedDirs = [];
    const retryableCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);

    async function removeEmptyDirectory(targetPath) {
      for (let attempt = 0; attempt < EMPTY_DIR_DELETE_MAX_RETRIES; attempt += 1) {
        try {
          await fs.promises.rmdir(targetPath);
          return true;
        } catch (error) {
          const code = error && error.code ? String(error.code) : '';
          if (!retryableCodes.has(code) || attempt >= 2) {
            if (code) {
              const logLevel = code === 'ENOTEMPTY' ? 'debug' : 'warn';
              emitLog(options.onLog, logLevel, `空目录清理失败：${targetPath}（${code}）`);
            }
            return false;
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 30 * (attempt + 1)));
        }
      }
      return false;
    }

    async function walk(currentPath, isRoot = false) {
      let entries = [];
      try {
        entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        await walk(path.join(currentPath, entry.name), false);
      }

      if (isRoot) {
        return;
      }

      const relativePath = path.relative(rootPath, currentPath);
      if (!relativePath || relativePath.startsWith('..')) {
        return;
      }

      const topDirName = relativePath.split(path.sep).filter(Boolean)[0] || '';
      if (preservedTopDirs.has(topDirName)) {
        return;
      }

      const restEntries = await fs.promises.readdir(currentPath).catch(() => null);
      if (!Array.isArray(restEntries) || restEntries.length > 0) {
        return;
      }

      const removed = await removeEmptyDirectory(currentPath);
      if (removed) {
        removedDirs.push(currentPath);
        emitLog(options.onLog, 'info', `已删除空目录：${currentPath}`);
      }
    }

    await walk(rootPath, true);
    return removedDirs;
  }

  async function removeDirectoryWithRetry(targetPath, options = {}) {
    const retryableCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
    const maxAttempts = Math.max(1, Number.parseInt(String(options.maxAttempts ?? ''), 10) || DIR_DELETE_DEFAULT_MAX_ATTEMPTS);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await fs.promises.rm(targetPath, { recursive: true, force: true });
      } catch (error) {
        const code = error && error.code ? String(error.code) : '';
        if (!retryableCodes.has(code) && attempt >= maxAttempts - 1) {
          return false;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const exists = await pathExists(targetPath);
      if (!exists) {
        return true;
      }

      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }

    return !(await pathExists(targetPath));
  }

  async function compactRootDirectories(rootPath, paths, adFileAction, options = {}) {
    if (!rootPath || !paths || !path.isAbsolute(rootPath)) {
      return {
        removedDirs: 0,
        movedDirs: 0
      };
    }

    const dryRun = Boolean(options.dryRun);
    const keepTopDirs = new Set([
      path.basename(paths.waitingDir),
      path.basename(paths.introAdDir),
      path.basename(paths.logsDir),
      path.basename(paths.stateDir)
    ]);
    if (adFileAction === 'move-to-delete') {
      keepTopDirs.add(path.basename(paths.toDeleteDir));
    }

    let movedDirs = 0;
    let removedDirs = 0;
    const entries = await fs.promises.readdir(rootPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (keepTopDirs.has(entry.name)) {
        continue;
      }

      const sourceDir = path.join(rootPath, entry.name);
      if (dryRun) {
        emitLog(options.onLog, 'info', `[预览] 根目录残留目录待处理：${sourceDir}`);
        continue;
      }

      const removed = await removeDirectoryWithRetry(sourceDir, { maxAttempts: ROOT_CLEANUP_FIRST_SWEEP_ATTEMPTS });
      if (removed) {
        removedDirs += 1;
        emitLog(options.onLog, 'info', `根目录残留目录已删除：${sourceDir}`);
      } else {
        emitLog(options.onLog, 'warn', `根目录残留目录删除失败，请手动处理：${sourceDir}`);
      }
    }

    if (!dryRun) {
      const finalSweepEntries = await fs.promises.readdir(rootPath, { withFileTypes: true }).catch(() => []);
      for (const entry of finalSweepEntries) {
        if (!entry.isDirectory() || keepTopDirs.has(entry.name)) {
          continue;
        }

        const sourceDir = path.join(rootPath, entry.name);
        const removed = await removeDirectoryWithRetry(sourceDir, { maxAttempts: ROOT_CLEANUP_SECOND_SWEEP_ATTEMPTS });
        if (removed) {
          removedDirs += 1;
          emitLog(options.onLog, 'warn', `根目录二次清理已删除残留目录：${sourceDir}`);
        } else {
          emitLog(options.onLog, 'warn', `根目录二次清理仍失败，请关闭占用后重试：${sourceDir}`);
        }
      }
    }

    return {
      removedDirs,
      movedDirs
    };
  }

  function planTargetNames(candidates, strategy) {
    const groupedIndex = new Map();
    const outputNames = new Array(candidates.length);

    candidates.forEach((item, index) => {
      const shouldRenameByFilmCode = Boolean(item && item.renameByFilmCode && item.filmCode);
      if (!shouldRenameByFilmCode) {
        const originalName = path.basename(String((item && item.src) || '').trim());
        outputNames[index] = originalName || `UNNAMED_${index + 1}`;
        return;
      }

      if (!groupedIndex.has(item.filmCode)) {
        groupedIndex.set(item.filmCode, []);
      }
      groupedIndex.get(item.filmCode).push(index);
    });

    const sortedCodes = Array.from(groupedIndex.keys()).sort((left, right) =>
      left.localeCompare(right, 'en', { sensitivity: 'base' })
    );

    sortedCodes.forEach((filmCode) => {
      const indexes = groupedIndex.get(filmCode) || [];
      indexes.sort((left, right) =>
        String(candidates[left].src || '').localeCompare(String(candidates[right].src || ''), 'en', {
          sensitivity: 'base'
        })
      );

      const useSuffix = indexes.length > 1;
      indexes.forEach((candidateIndex, sequence) => {
        const extension = path.extname(candidates[candidateIndex].src).toLowerCase();
        const suffix = useSuffix ? formatSuffix(strategy, sequence) : '';
        outputNames[candidateIndex] = `${filmCode}${suffix}${extension}`;
      });
    });

    return outputNames;
  }

  function buildAdRiskCodeDetails(records = []) {
    const codeMap = new Map();

    (Array.isArray(records) ? records : []).forEach((record) => {
      const filmCode = normalizeFilmId(record && record.filmCode ? record.filmCode : '');
      if (!filmCode) {
        return;
      }

      const score = Number.isFinite(Number(record && record.score)) ? Number(record.score) : 0;
      const reasons = Array.isArray(record && record.reasons)
        ? record.reasons
            .map((item) => String(item || '').trim())
            .filter(Boolean)
        : [];
      const sourcePath = String(record && record.sourcePath ? record.sourcePath : '');
      const size = Number.isFinite(Number(record && record.size)) ? Number(record.size) : 0;
      const evidence = record && record.evidence && typeof record.evidence === 'object' ? record.evidence : null;
      const existing = codeMap.get(filmCode);

      if (!existing || score > existing.maxScore) {
        codeMap.set(filmCode, {
          filmCode,
          maxScore: score,
          sourcePath,
          size,
          reasons: reasons.slice(0, 6),
          evidence
        });
        return;
      }

      if (existing.reasons.length === 0 && reasons.length > 0) {
        existing.reasons = reasons.slice(0, 6);
      }
    });

    return Array.from(codeMap.values()).sort((left, right) => {
      if (right.maxScore !== left.maxScore) {
        return right.maxScore - left.maxScore;
      }
      return String(left.filmCode || '').localeCompare(String(right.filmCode || ''), 'en');
    });
  }

  function buildSupplementMagnetEntries(codes, expectedCodeEntryMap) {
    const codeEntryMap = expectedCodeEntryMap instanceof Map ? expectedCodeEntryMap : new Map();

    return sortCodeAlphabetically(codes).map((code) => ({
      code,
      magnets: mergeMagnetEntries(codeEntryMap.get(code) || [])
    }));
  }

  function summarizeUnmatchedRecords(records = [], maxDisplay = 600) {
    const list = Array.isArray(records) ? records.filter((item) => item && typeof item === 'object') : [];
    const reasonCounter = new Map();
    let videoCount = 0;
    let nonVideoCount = 0;

    list.forEach((item) => {
      const reason = String(item.reason || '未分类').trim() || '未分类';
      reasonCounter.set(reason, Number(reasonCounter.get(reason) || 0) + 1);
      if (isVideoFile(item.path || '')) {
        videoCount += 1;
      } else {
        nonVideoCount += 1;
      }
    });

    const displayRecords = list
      .slice(0)
      .sort((left, right) => {
        const leftVideo = isVideoFile(left.path || '') ? 1 : 0;
        const rightVideo = isVideoFile(right.path || '') ? 1 : 0;
        if (leftVideo !== rightVideo) {
          return rightVideo - leftVideo;
        }
        const leftSize = Number(left.size || 0);
        const rightSize = Number(right.size || 0);
        if (leftSize !== rightSize) {
          return rightSize - leftSize;
        }
        return String(left.path || '').localeCompare(String(right.path || ''), 'en', { sensitivity: 'base' });
      })
      .slice(0, Math.max(1, maxDisplay));

    const reasonStats = Array.from(reasonCounter.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count);

    return {
      total: list.length,
      videoCount,
      nonVideoCount,
      reasonStats,
      displayRecords,
      omittedCount: Math.max(0, list.length - displayRecords.length)
    };
  }

  function formatRenameRecordLine(record = {}, index = 0) {
    const filmCodeLabel = String(record.filmCode || '').trim() || '未识别番号';
    const renameApplied = Boolean(record.renameApplied);
    const note = String(record.note || '').trim();
    const actionLabel = renameApplied ? '按番号改名' : `保留原名（${note || '未命中番号'}）`;
    return `${index + 1}. ${record.originalName} => ${record.newName} | [${filmCodeLabel}] | ${actionLabel} | ${record.originalPath}`;
  }

  async function writeReports(
    paths,
    summary,
    renameRecords,
    unmatchedRecords,
    adRiskRecords = [],
    adRiskMagnetEntries = [],
    missingMagnetEntries = []
  ) {
    const nowText = new Date().toLocaleString('zh-CN', { hour12: false });

    await writeTextFile(paths.renameMapPath, [
      '视频整理助手 - 更改前后对照',
      `生成时间：${nowText}`,
      `扫描总数：${summary.scannedTotal}`,
      `视频总数：${summary.videoTotal}`,
      `命中番号：${summary.qualifiedVideo}`,
      `移入待整理：${summary.movedToWaiting}`,
      '',
      '明细（原名 => 新名 | 番号 | 原路径）：',
      '----------------------------------------',
      ...renameRecords.map(
        (record, index) => formatRenameRecordLine(record, index)
      )
    ]);

    const unmatchedSummary = summarizeUnmatchedRecords(unmatchedRecords, 600);
    await writeTextFile(paths.unmatchedPath, [
      '视频整理助手 - 待删除或未命中明细',
      `生成时间：${nowText}`,
      `视频总数：${summary.videoTotal}`,
      `命中番号：${summary.qualifiedVideo}`,
      `待删除处理总数：${(summary.movedToDelete || 0) + (summary.deletedDirectly || 0)}`,
      `移入待删除：${summary.movedToDelete || 0}`,
      `直接删除：${summary.deletedDirectly || 0}`,
      `归入含开头广告：${summary.movedToIntroAd || 0}`,
      '',
      '明细（原因 | 大小GB | 路径）：',
      '----------------------------------------',
      ...unmatchedSummary.displayRecords.map(
        (record, index) => `${index + 1}. [${record.reason}] ${formatBytesToGB(record.size)}GB | ${record.path}`
      ),
      ...(unmatchedSummary.omittedCount > 0
        ? [`... 鍏朵綑 ${unmatchedSummary.omittedCount} 鏉¤褰曞凡鐪佺暐锛堥伩鍏嶆姤鍛婅繃澶э級`]
        : [])
    ]);

    const adRiskCodeDetails = buildAdRiskCodeDetails(adRiskRecords);
    const adRiskCodes = adRiskCodeDetails.map((item) => item.filmCode);
    const highRiskCodes = adRiskCodeDetails.filter((item) => item.maxScore >= AD_RISK_HIGH_CONFIDENCE_SCORE);
    const reviewRiskCodes = adRiskCodeDetails.filter((item) => item.maxScore >= AD_RISK_REVIEW_SCORE && item.maxScore < AD_RISK_HIGH_CONFIDENCE_SCORE);
    const observedRiskCodes = adRiskCodeDetails.filter((item) => item.maxScore < AD_RISK_REVIEW_SCORE);

    await writeTextFile(paths.adRiskCodesPath, [
      '视频整理助手 - 含开头广告番号',
      `生成时间：${nowText}`,
      `含开头广告番号总数：${adRiskCodes.length}`,
      `高置信（>=80）：${highRiskCodes.length}`,
      `建议复核（70-79）：${reviewRiskCodes.length}`,
      `观察项（<70）：${observedRiskCodes.length}`,
      '',
      ...(adRiskCodes.length > 0 ? adRiskCodes.map((code, index) => `${index + 1}. ${code}`) : ['未发现含开头广告番号。'])
    ]);

    await writeTextFile(paths.adRiskDetailPath, [
      '视频整理助手 - 含开头广告明细',
      `生成时间：${nowText}`,
      `含开头广告番号总数：${adRiskCodeDetails.length}`,
      '分级规则：高置信 >=80；建议复核 70-79；观察项 <70',
      '',
      '明细（番号 | 评分 | 大小GB | 原因 | 证据 | 路径）：',
      '----------------------------------------',
      ...adRiskCodeDetails.map((item, index) => {
        const reasons = item.reasons.length > 0 ? item.reasons.join('; ') : '-';
        const sourcePath = item.sourcePath || '-';
        const evidence = item.evidence
          ? `帧哈希数=${Array.isArray(item.evidence.frameHashes) ? item.evidence.frameHashes.length : 0}；模板命中=${
              item.evidence.bestTemplateMatch ? item.evidence.bestTemplateMatch.templateId || '-' : '-'
            }；广告样本命中=${item.evidence.bestAdSampleMatch ? item.evidence.bestAdSampleMatch.sampleId || '-' : '-'}`
          : '-';
        return `${index + 1}. ${item.filmCode} | ${item.maxScore} | ${formatBytesToGB(item.size)}GB | ${reasons} | ${evidence} | ${sourcePath}`;
      }),
      ...(adRiskCodeDetails.length === 0 ? ['未发现含开头广告明细。'] : [])
    ]);

    const adRiskMagnetLines = [
      '视频整理助手 - 含开头广告补抓磁力',
      `生成时间：${nowText}`,
      `补抓条目总数：${adRiskMagnetEntries.length}`,
      ''
    ];

    if (!Array.isArray(adRiskMagnetEntries) || adRiskMagnetEntries.length === 0) {
      adRiskMagnetLines.push('未生成含开头广告补抓磁力。');
    } else {
      adRiskMagnetEntries.forEach((entry, index) => {
        const code = normalizeFilmId(entry.code || '');
        const magnets = mergeMagnetEntries(entry.magnets || []);
        adRiskMagnetLines.push(`${index + 1}. [${code || '未知番号'}]`);
        if (magnets.length === 0) {
          adRiskMagnetLines.push('   （无可用磁力）');
        } else {
          magnets.forEach((magnet, magnetIndex) => {
            const sizeLabel = magnet.size ? ` [${magnet.size}]` : '';
            adRiskMagnetLines.push(`   ${magnetIndex + 1})${sizeLabel} ${magnet.link}`);
          });
        }
        adRiskMagnetLines.push('');
      });
    }

    await writeTextFile(paths.adRiskMagnetsPath, adRiskMagnetLines);

    const missingMagnetLines = [
      '视频整理助手 - 遗漏番号磁力补抓',
      `生成时间：${nowText}`,
      `爬虫番号总数：${summary.expectedCodeTotal || 0}`,
      `本地识别番号总数：${summary.detectedCodeCount || 0}`,
      `遗漏番号总数：${summary.missingCodeCount || 0}`,
      `补抓磁力总数：${summary.missingMagnetCount || 0}`,
      ''
    ];

    if (!Array.isArray(missingMagnetEntries) || missingMagnetEntries.length === 0) {
      missingMagnetLines.push('未生成遗漏番号补抓磁力。');
    } else {
      missingMagnetEntries.forEach((entry, index) => {
        const code = normalizeFilmId(entry.code || '');
        const magnets = mergeMagnetEntries(entry.magnets || []);
        missingMagnetLines.push(`${index + 1}. [${code || '未知番号'}]`);
        if (magnets.length === 0) {
          missingMagnetLines.push('   （无可用磁力）');
        } else {
          magnets.forEach((magnet, magnetIndex) => {
            const sizeLabel = magnet.size ? ` [${magnet.size}]` : '';
            missingMagnetLines.push(`   ${magnetIndex + 1})${sizeLabel} ${magnet.link}`);
          });
        }
        missingMagnetLines.push('');
      });
    }

    await writeTextFile(paths.missingMagnetsPath, missingMagnetLines);

    return {
      renameMap: paths.renameMapPath,
      unmatched: paths.unmatchedPath,
      adRiskCodes: paths.adRiskCodesPath,
      adRiskDetail: paths.adRiskDetailPath,
      adRiskMagnets: paths.adRiskMagnetsPath,
      missingMagnets: paths.missingMagnetsPath
    };
  }
  function normalizeFilmDataRecords(parsed) {
    if (Array.isArray(parsed)) {
      return parsed;
    }

    if (!parsed || typeof parsed !== 'object') {
      return [];
    }

    if (Array.isArray(parsed.records)) {
      return parsed.records;
    }

    if (Array.isArray(parsed.filmData)) {
      return parsed.filmData;
    }

    const values = Object.values(parsed);
    if (values.length > 0 && values.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      return values;
    }

    return [parsed];
  }

  async function readFilmDataRecords(outputDir) {
    const { outputDir: normalizedOutputDir, filmDataPath } = resolveCrawlOutputPaths(outputDir);

    if (!normalizedOutputDir) {
      throw new Error('请先选择爬虫输出目录。');
    }

    const stat = await fs.promises.stat(filmDataPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new Error(`未找到 filmData.json：${filmDataPath}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(await fs.promises.readFile(filmDataPath, 'utf8'));
    } catch (error) {
      throw new Error(`解析 filmData.json 失败：${error instanceof Error ? error.message : String(error)}`);
    }

    const records = normalizeFilmDataRecords(parsed);
    return {
      outputDir: normalizedOutputDir,
      filmDataPath,
      records
    };
  }
  async function loadCrawlFilmCodes(options = {}) {
    const { outputDir, records, filmDataPath } = await readFilmDataRecords(options.outputDir);

    const codeEntryMap = new Map();
    records.forEach((record) => {
      if (!record || typeof record !== 'object') {
        return;
      }

      const code = extractRecordCode(record);
      if (!code) {
        return;
      }

      const existing = codeEntryMap.get(code) || [];
      const magnets = extractRecordMagnetEntries(record);
      codeEntryMap.set(code, mergeMagnetEntries(existing, magnets));
    });

    const codes = sortCodeAlphabetically(codeEntryMap.keys());
    const codeEntries = codes.map((code) => ({
      code,
      magnets: mergeMagnetEntries(codeEntryMap.get(code) || [])
    }));

    return {
      outputDir,
      filmDataPath,
      totalRecords: records.length,
      codeCount: codes.length,
      codes,
      codeEntries
    };
  }

  async function runOrganizer(options = {}) {
    const normalizedRootPath = normalizeRootPath(options.rootPath);
    if (!normalizedRootPath) {
      throw new Error('请先选择需要整理的根目录。');
    }

    const rootStat = await fs.promises.stat(normalizedRootPath).catch(() => null);
    if (!rootStat || !rootStat.isDirectory()) {
      throw new Error(`根目录不存在：${normalizedRootPath}`);
    }

    const dryRun = Boolean(options.dryRun);
    const includeSubdirectories = options.includeSubdirectories !== false;
    const minSizeMB = toSafeInteger(options.minSizeMB, 100, 1);
    const minSizeBytes = minSizeMB * 1024 * 1024;
    const suffixInput = normalizeSuffixInput(options.suffix);
    const suffixStrategy = parseConflictSuffixStrategy(suffixInput);
    const adFileAction = normalizeAdFileAction(options.adFileAction);
    const expectedCodeSets = buildExpectedCodeSets(options.expectedCodes);
    const expectedCodeEntryMap = buildExpectedCodeEntryMap(options.expectedCodeEntries);
    const adDetectionEnabled = options.adDetectionEnabled !== false;
    const adModelType = String(options.adModelType || '').trim() || 'mobile-net-v3-onnx';
    const adThreshold = toSafeInteger(options.adThreshold, 60, 1);
    const evaluateAdRisk = typeof options.evaluateAdRisk === 'function' ? options.evaluateAdRisk : null;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const signal = options.signal || null;
    const isPaused = typeof options.isPaused === 'function' ? options.isPaused : () => false;
    const paths = resolvePaths(normalizedRootPath);

    expectedCodeEntryMap.forEach((_, code) => {
      expectedCodeSets.codeSet.add(code);
      const token = normalizeCodeToken(code);
      if (token) {
        expectedCodeSets.tokenSet.add(token);
      }
    });

    if (!dryRun) {
      const ensureTasks = [ensureDirectory(paths.waitingDir), ensureDirectory(paths.introAdDir)];
      if (adFileAction === 'move-to-delete') {
        ensureTasks.push(ensureDirectory(paths.toDeleteDir));
      }
      await Promise.all(ensureTasks);
      await cleanupLegacyReportFiles(normalizedRootPath, options.onLog);
    }

    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'starting',
      dryRun,
      rootPath: normalizedRootPath,
      minSizeMB,
      adFileAction,
      adModelType
    });

    emitLog(
      options.onLog,
      'info',
      `开始执行整理（根目录=${normalizedRootPath}，最小体积=${minSizeMB}MB，模式=${dryRun ? '预览' : '执行'}，广告处理=${getAdFileActionLabel(adFileAction)}）`
    );

    if (expectedCodeSets.codeSet.size > 0) {
      emitLog(
        options.onLog,
        'info',
        `已加载爬虫番号名单：${expectedCodeSets.codeSet.size} 条`
      );
    } else {
      emitLog(options.onLog, 'warn', '未加载爬虫番号名单，将回退为仅按文件名提取番号。');
    }

    if (adDetectionEnabled) {
      if (evaluateAdRisk) {
        emitLog(options.onLog, 'info', `已启用开头广告风险检测，阈值=${adThreshold}`);
      } else {
        emitLog(options.onLog, 'warn', '已启用开头广告风险检测，但当前没有可用的评估服务。');
      }
    }

    const { files } = await runScanPhase({
      collectFiles,
      rootPath: normalizedRootPath,
      includeSubdirectories,
      emitLog,
      emitProgress,
      onLog: options.onLog,
      onProgress,
      signal,
      isPaused,
      summary: null
    });

    emitLog(options.onLog, 'info', `扫描完成，待处理文件 ${files.length} 个。`);

    const summary = {
      scannedTotal: files.length,
      videoTotal: 0,
      nonAdVideo: 0,
      qualifiedVideo: 0,
      matchedToCrawlCode: 0,
      movedToWaiting: 0,
      movedToDelete: 0,
      movedToIntroAd: 0,
      deletedDirectly: 0,
      adFileCount: 0,
      skippedNoCode: 0,
      skippedSmall: 0,
      unmatchedVideo: 0,
      failedOperations: 0,
      adRiskRejected: 0,
      adDetectionErrors: 0,
      supplementMagnetCount: 0,
      expectedCodeTotal: expectedCodeSets.codeSet.size,
      detectedCodeCount: 0,
      missingCodeCount: 0,
      missingMagnetCount: 0,
      removedEmptyDirs: 0
    };

    const phaseJudgeResult = await runJudgePhase({
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
      onLog: options.onLog,
      onProgress,
      signal,
      isPaused,
      summary
    });

    const phaseTargetNames = planTargetNames(phaseJudgeResult.candidates, suffixStrategy);

    const phaseRenameResult = await runRenamePhase({
      fs,
      path,
      dryRun,
      adFileAction,
      paths,
      candidates: phaseJudgeResult.candidates,
      pendingDelete: phaseJudgeResult.pendingDelete,
      targetNames: phaseTargetNames,
      shouldReportProgress,
      moveWithUnique,
      emitLog,
      emitProgress,
      onLog: options.onLog,
      onProgress,
      signal,
      isPaused,
      summary
    });

    const phaseIntroAdResult = await runIntroAdPhase({
      fs,
      path,
      dryRun,
      paths,
      renameRecords: phaseRenameResult.renameRecords,
      adDetectionEnabled,
      adThreshold,
      evaluateAdRisk,
      autoLearnFromDetection: options.autoLearnFromDetection,
      normalizeFilmId,
      shouldReportProgress,
      moveWithUnique,
      emitLog,
      emitProgress,
      onLog: options.onLog,
      onProgress,
      signal,
      isPaused,
      summary
    });

    const phaseReportResult = await runReportPhase({
      dryRun,
      paths,
      summary,
      expectedCodeSets,
      expectedCodeEntryMap,
      detectedFilmCodes: phaseJudgeResult.detectedFilmCodes,
      adRiskRecords: phaseIntroAdResult.adRiskRecords,
      renameRecords: phaseRenameResult.renameRecords,
      unmatchedRecords: phaseJudgeResult.unmatchedRecords,
      buildSupplementMagnetEntries,
      mergeMagnetEntries,
      normalizeFilmId,
      sortCodeAlphabetically,
      emitLog,
      onLog: options.onLog,
      writeReports
    });

    const compactResult = await compactRootDirectories(normalizedRootPath, paths, adFileAction, {
      dryRun,
      onLog: options.onLog
    });
    emitLog(
      options.onLog,
      'info',
      `根目录收口完成：删除残留目录 ${Number(compactResult.removedDirs || 0)} 个。`
    );

    const cleanupPreservedTopDirs = new Set([
      path.basename(paths.waitingDir),
      path.basename(paths.introAdDir),
      path.basename(paths.logsDir),
      path.basename(paths.stateDir)
    ]);
    if (adFileAction === 'move-to-delete') {
      cleanupPreservedTopDirs.add(path.basename(paths.toDeleteDir));
    }

    const phaseCleanupResult = await runCleanupPhase({
      dryRun,
      rootPath: normalizedRootPath,
      cleanupEmptyDirectories,
      emitLog,
      onLog: options.onLog,
      preservedTopDirs: cleanupPreservedTopDirs
    });
    summary.removedEmptyDirs = Number(phaseCleanupResult.removedEmptyDirs || 0);

    emitLog(
      options.onLog,
      'info',
      `整理完成：待整理=${summary.movedToWaiting}，待删除=${summary.movedToDelete}，含开头广告=${summary.movedToIntroAd}，直接删除=${summary.deletedDirectly}，开头广告命中=${summary.adRiskRejected}，失败=${summary.failedOperations}`
    );

    emitProgress(onProgress, {
      scope: 'organizer',
      phase: 'completed',
      waitingTotal: summary.movedToWaiting,
      waitingProcessed: summary.movedToWaiting,
      deleteTotal: summary.movedToDelete,
      deleteProcessed: summary.movedToDelete,
      introAdTotal: summary.movedToIntroAd,
      adFileAction,
      deletedDirectly: summary.deletedDirectly,
      failedOperations: summary.failedOperations
    });

    return {
      rootPath: normalizedRootPath,
      dryRun,
      config: {
        includeSubdirectories,
        minSizeMB,
        suffixInput: suffixStrategy.raw,
        adFileAction,
        adDetectionEnabled,
        adModelType,
        adThreshold
      },
      expectedCodeCount: expectedCodeSets.codeSet.size,
      summary,
      paths: {
        waitingDir: paths.waitingDir,
        toDeleteDir: paths.toDeleteDir,
        introAdDir: paths.introAdDir,
        logsDir: paths.logsDir,
        reportsDir: paths.rootPath
      },
      reportMap: phaseReportResult.reportMap || {},
      reportFiles: phaseReportResult.reportFiles || [],
      preview: {
        renameRecords: phaseRenameResult.renameRecords.slice(0, 200),
        unmatchedRecords: phaseJudgeResult.unmatchedRecords.slice(0, 200),
        adRiskRecords: phaseIntroAdResult.adRiskRecords.slice(0, 200)
      },
      adRisk: {
        riskCodeCount: phaseReportResult.adRiskCodes.length,
        supplementMagnetCount: summary.supplementMagnetCount,
        riskCodes: phaseReportResult.adRiskCodes.slice(0, 500)
      },
      missingDownload: {
        missingCodeCount: summary.missingCodeCount,
        missingMagnetCount: summary.missingMagnetCount,
        missingCodes: phaseReportResult.missingCodes.slice(0, 500)
      }
    };

  }

  return {
    runOrganizer,
    resolveTargetPath,
    loadCrawlFilmCodes,
    resolveCrawlOutputPaths
  };
}

module.exports = {
  createOrganizerService
};
