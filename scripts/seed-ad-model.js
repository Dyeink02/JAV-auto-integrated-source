'use strict';

/**
 * One-time seed script: extract frames from 14 known intro-ad videos
 * and inject them into the ad learning model as training samples.
 *
 * Usage:  node scripts/seed-ad-model.js [rootPath]
 *   rootPath defaults to Z:\涼森れむ\待整理
 *
 * This script directly instantiates adLearningService without Electron's app object,
 * using a minimal shim that provides getPath('userData') and getAppPath().
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Minimal Electron app shim ────────────────────────────────────────────────
const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'jav-auto-integrated');
if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

const appShim = {
  getPath(name) {
    if (name === 'userData') return userDataDir;
    return __dirname;
  },
  getAppPath() {
    return path.resolve(__dirname, '..');
  }
};

// ── Load service ─────────────────────────────────────────────────────────────
const { createAdLearningService } = require('../desktop/mainServices/adLearningService');
const service = createAdLearningService({ app: appShim, fs, path });

// ── Config ───────────────────────────────────────────────────────────────────
const ROOT_PATH = process.argv[2] || 'Z:\\涼森れむ\\待整理';
const KNOWN_AD_CODES = [
  'ABF-055', 'ABF-179', 'ABF-295',
  'ABP-889', 'ABP-901',
  'ABW-006', 'ABW-032', 'ABW-179', 'ABW-305',
  'BGN-054', 'HRV-061', 'PPT-116', 'REBD-457', 'TRE-141'
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== 广告模型种子学习 ===`);
  console.log(`根目录: ${ROOT_PATH}`);
  console.log(`番号数: ${KNOWN_AD_CODES.length}`);
  console.log(`模型文件: ${service.getModelPath()}\n`);

  const beforeSummary = service.getSummary();
  console.log(`学习前 — 广告样本: ${beforeSummary.adSampleCount}, 模板: ${beforeSummary.introTemplateCount}, 正常样本: ${beforeSummary.normalSampleCount}\n`);

  try {
    const result = await service.learnSamplesByCodes({
      label: 'ad',
      codes: KNOWN_AD_CODES,
      rootPath: ROOT_PATH,
      includeSubdirectories: false,
      onProgress(p) {
        if (p.phase === 'learning') {
          process.stdout.write(`\r  学习中: ${p.currentCode || '...'} (${p.processedVideos}/${p.totalVideos})  `);
        }
      }
    });

    console.log('\n');
    console.log(`匹配视频: ${result.matchedVideoCount}/${KNOWN_AD_CODES.length}`);
    console.log(`新增样本: ${result.sampleIncrement}`);
    console.log(`匹配番号: ${result.matchedCodes.join(', ')}`);
    if (result.missingCodes.length > 0) {
      console.log(`未找到: ${result.missingCodes.join(', ')}`);
    }
    console.log(`\n智能学习统计: 高置信=${result.smartLearningStats.highConfidence}, 低置信=${result.smartLearningStats.lowConfidence}, 跳过黑帧=${result.smartLearningStats.skippedBlack}`);

    const afterSummary = service.getSummary();
    console.log(`\n学习后 — 广告样本: ${afterSummary.adSampleCount}, 模板: ${afterSummary.introTemplateCount}, 正常样本: ${afterSummary.normalSampleCount}`);
    console.log(`\n模型已保存至: ${service.getModelPath()}`);
  } catch (err) {
    console.error(`\n种子学习失败: ${err.message}`);
    process.exit(1);
  }
}

main();
