'use strict';

/**
 * ONNX 模型练习/训练脚本
 *
 * 完整工作流：提取嵌入 → 构建参考库 → 推理测试
 *
 * ── 命令模式 ───────────────────────────────────────────────────
 *
 * 1. 初始化参考库
 *    node scripts/onnx-trainer.js init
 *    创建空的参考嵌入库文件 reference-embeddings.json
 *
 * 2. 训练：从单个视频提取嵌入并标记
 *    node scripts/onnx-trainer.js train --video "Z:\广告.mp4" --label ad
 *    node scripts/onnx-trainer.js train --video "Z:\正常.mp4" --label normal
 *
 * 3. 训练：批量处理目录（自动检测子目录名 ad/ 和 normal/）
 *    node scripts/onnx-trainer.js batch "Z:\训练样本\"
 *    约定：目录下 ad\ 子目录放广告视频，normal\ 子目录放正常视频
 *
 * 4. 测试：判断一个视频是否为广告
 *    node scripts/onnx-trainer.js test "Z:\未知.mp4"
 *
 * 5. 查看参考库摘要
 *    node scripts/onnx-trainer.js stats
 *
 * 6. 重置参考库
 *    node scripts/onnx-trainer.js reset
 */

const ort = require('onnxruntime-node');
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const MODEL_FILE = 'mobile-net-v3-small.onnx';
const INPUT_SIZE = 224;
const REFERENCE_DB = path.join(__dirname, '..', 'reference-embeddings.json');

// ====================================================================
//  模型查找 & 加载
// ====================================================================

function findModel() {
  const candidates = [
    path.join(__dirname, '..', 'desktop', 'resources', 'models', MODEL_FILE),
    path.join(__dirname, '..', 'desktop', 'resources', MODEL_FILE),
    path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', MODEL_FILE),
    path.join(process.env.APPDATA || '', 'jav-auto-crawler-tool', MODEL_FILE),
    path.join(__dirname, MODEL_FILE)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let _session = null;
let _sessionPromise = null;

async function getSession() {
  if (_session) return _session;
  if (_sessionPromise) return _sessionPromise;
  const modelPath = findModel();
  if (!modelPath) throw new Error('找不到 ONNX 模型文件');
  _sessionPromise = ort.InferenceSession.create(modelPath, {
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true
  });
  _session = await _sessionPromise;
  return _session;
}

// ====================================================================
//  图像预处理
// ====================================================================

function rgbToTensor(rgbFlat) {
  const totalPixels = INPUT_SIZE * INPUT_SIZE;
  const channels = 3;
  const tensor = new Float32Array(1 * channels * INPUT_SIZE * INPUT_SIZE);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const pixelCount = Math.min(Math.floor(rgbFlat.length / channels), totalPixels);
  for (let i = 0; i < pixelCount; i++) {
    for (let c = 0; c < channels; c++) {
      const val = (rgbFlat[i * channels + c] || 0) / 255.0;
      tensor[c * totalPixels + i] = (val - mean[c]) / std[c];
    }
  }
  return tensor;
}

// ====================================================================
//  FFmpeg 帧提取
// ====================================================================

function extractFrameRgb(videoPath, second) {
  try {
    const result = spawnSync('ffmpeg', [
      '-ss', String(second),
      '-i', videoPath,
      '-vframes', '1',
      '-s', `${INPUT_SIZE}x${INPUT_SIZE}`,
      '-pix_fmt', 'rgb24',
      '-f', 'rawvideo',
      '-an', '-y',
      'pipe:1'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
      maxBuffer: 2 * 1024 * 1024
    });
    if (result.status !== 0 || !result.stdout || result.stdout.length < INPUT_SIZE * INPUT_SIZE * 3) {
      return null;
    }
    return Array.from(result.stdout.slice(0, INPUT_SIZE * INPUT_SIZE * 3));
  } catch (_) {
    return null;
  }
}

function extractFrames(videoPath, seconds = [1, 3, 5]) {
  const frames = [];
  for (const sec of seconds) {
    const rgb = extractFrameRgb(videoPath, sec);
    if (rgb) {
      frames.push({ second: sec, rgb });
    }
  }
  return frames;
}

// ====================================================================
//  ONNX 推理
// ====================================================================

async function getEmbedding(rgbData) {
  const session = await getSession();
  const tensor = rgbToTensor(rgbData);
  const dims = [1, 3, INPUT_SIZE, INPUT_SIZE];
  const ortTensor = new ort.Tensor('float32', Float32Array.from(tensor), dims);
  const feeds = {};
  feeds[session.inputNames[0]] = ortTensor;
  const results = await session.run(feeds);
  // output[0]=logits, output[1]=embedding
  const embeddingData = results[session.outputNames[1]]?.data;
  return embeddingData ? Array.from(embeddingData) : null;
}

function cosineSimilarity(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  let dot = 0, nA = 0, nB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += (a[i] || 0) * (b[i] || 0);
    nA += (a[i] || 0) ** 2;
    nB += (b[i] || 0) ** 2;
  }
  const denom = Math.sqrt(nA) * Math.sqrt(nB);
  return denom === 0 ? 0 : dot / denom;
}

// ====================================================================
//  参考库操作
// ====================================================================

function loadReferences() {
  if (!fs.existsSync(REFERENCE_DB)) {
    return { version: 1, samples: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(REFERENCE_DB, 'utf8'));
  } catch (_) {
    return { version: 1, samples: [] };
  }
}

function saveReferences(db) {
  fs.writeFileSync(REFERENCE_DB, JSON.stringify(db, null, 2), 'utf8');
}

// ====================================================================
//  命令实现
// ====================================================================

// ---- init ----
function cmdInit() {
  if (fs.existsSync(REFERENCE_DB)) {
    console.log('参考库已存在: ' + REFERENCE_DB);
    const db = loadReferences();
    console.log(`当前样本数: ${db.samples.length}`);
    return;
  }
  const db = { version: 1, samples: [], meta: { created: new Date().toISOString() } };
  saveReferences(db);
  console.log('✅ 参考库已创建: ' + REFERENCE_DB);
  console.log('   现在可以用 train 命令添加样本');
}

// ---- reset ----
function cmdReset() {
  if (!fs.existsSync(REFERENCE_DB)) {
    console.log('参考库不存在，无需重置。');
    return;
  }
  fs.unlinkSync(REFERENCE_DB);
  console.log('✅ 参考库已删除。');
}

// ---- stats ----
function cmdStats() {
  const db = loadReferences();
  const ads = db.samples.filter(s => s.label === 'ad');
  const normals = db.samples.filter(s => s.label === 'normal');
  console.log('═══════════════════════════════════════');
  console.log('  参考嵌入库摘要');
  console.log('═══════════════════════════════════════');
  console.log(`  文件: ${REFERENCE_DB}`);
  console.log(`  创建时间: ${db.meta?.created || '未知'}`);
  console.log(`  总样本: ${db.samples.length}`);
  console.log(`  广告样本: ${ads.length}`);
  console.log(`  正常样本: ${normals.length}`);
  if (ads.length > 0) {
    console.log('\n  广告样本列表:');
    ads.forEach(s => console.log(`    - ${s.sourceVideo || '未知'}  (帧数: ${s.embeddingCount || 1})`));
  }
  if (normals.length > 0) {
    console.log('\n  正常样本列表:');
    normals.forEach(s => console.log(`    - ${s.sourceVideo || '未知'}  (帧数: ${s.embeddingCount || 1})`));
  }
  console.log('═══════════════════════════════════════');
}

// ---- train ----
async function cmdTrain(videoPath, label) {
  if (!fs.existsSync(videoPath)) {
    console.error(`视频不存在: ${videoPath}`);
    process.exit(1);
  }
  if (label !== 'ad' && label !== 'normal') {
    console.error('label 必须是 ad 或 normal');
    process.exit(1);
  }

  const videoName = path.basename(videoPath);
  console.log(`\n🎯 训练: ${videoName} → ${label === 'ad' ? '🔴 广告' : '🟢 正常'}`);
  console.log(`   路径: ${videoPath}`);

  // 提取帧
  console.log('\n📸 提取帧...');
  const frames = extractFrames(videoPath, [1, 3, 5, 8]);
  if (frames.length === 0) {
    console.error('❌ 未能提取任何有效帧');
    process.exit(1);
  }

  // 提取嵌入
  const session = await getSession();
  const embeddingEntries = [];
  for (const f of frames) {
    process.stdout.write(`   第${f.second}s 帧 → 推理中... `);
    const emb = await getEmbedding(f.rgb);
    if (emb) {
      embeddingEntries.push({ second: f.second, embedding: emb });
      console.log(`✅ ${emb.length}维`);
    } else {
      console.log('❌ 失败');
    }
  }

  if (embeddingEntries.length === 0) {
    console.error('❌ 所有帧推理失败');
    process.exit(1);
  }

  // 保存到参考库
  const db = loadReferences();
  const sample = {
    id: `sample-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    sourceVideo: videoName,
    sourcePath: videoPath,
    embeddingCount: embeddingEntries.length,
    embeddings: embeddingEntries,
    addedAt: new Date().toISOString()
  };
  db.samples.push(sample);
  db.meta = { ...db.meta, updated: new Date().toISOString() };
  saveReferences(db);

  console.log(`\n✅ 已添加: ${videoName}`);
  console.log(`   标签: ${label === 'ad' ? '🔴 广告' : '🟢 正常'}`);
  console.log(`   帧数: ${embeddingEntries.length}`);
  console.log(`   库总量: ${db.samples.length}`);
}

// ---- batch ----
async function cmdBatch(rootDir) {
  if (!fs.existsSync(rootDir)) {
    console.error(`目录不存在: ${rootDir}`);
    process.exit(1);
  }

  const adDir = path.join(rootDir, 'ad');
  const normalDir = path.join(rootDir, 'normal');

  const tasks = [];

  // 扫描 ad 目录
  if (fs.existsSync(adDir)) {
    const files = fs.readdirSync(adDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v'].includes(ext);
    });
    files.forEach(f => tasks.push({ video: path.join(adDir, f), label: 'ad' }));
  }

  // 扫描 normal 目录
  if (fs.existsSync(normalDir)) {
    const files = fs.readdirSync(normalDir).filter(f => {
      const ext = path.extname(f).toLowerCase();
      return ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v'].includes(ext);
    });
    files.forEach(f => tasks.push({ video: path.join(normalDir, f), label: 'normal' }));
  }

  if (tasks.length === 0) {
    console.log('未找到视频。请在目录下创建 ad/ 和 normal/ 子目录并放入视频。');
    console.log(`  示例: ${rootDir}\\ad\\ ← 放广告视频`);
    console.log(`  示例: ${rootDir}\\normal\\ ← 放正常视频`);
    return;
  }

  console.log(`\n📦 批量训练: ${tasks.length} 个视频`);
  console.log(`   广告: ${tasks.filter(t => t.label === 'ad').length} 个`);
  console.log(`   正常: ${tasks.filter(t => t.label === 'normal').length} 个\n`);

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    console.log(`[${i + 1}/${tasks.length}] ${path.basename(t.video)} (${t.label})`);
    try {
      await cmdTrain(t.video, t.label);
    } catch (e) {
      console.error(`   ❌ 错误: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  cmdStats();
}

// ---- test ----
async function cmdTest(videoPath) {
  if (!fs.existsSync(videoPath)) {
    console.error(`视频不存在: ${videoPath}`);
    process.exit(1);
  }

  const db = loadReferences();
  if (db.samples.length === 0) {
    console.error('❌ 参考库为空，请先用 train 命令添加样本');
    process.exit(1);
  }

  // 构建参考嵌入列表
  const refList = [];
  db.samples.forEach(s => {
    (s.embeddings || []).forEach(e => {
      refList.push({ embedding: e.embedding, label: s.label, source: s.sourceVideo });
    });
  });

  console.log(`\n🔍 检测: ${path.basename(videoPath)}`);
  console.log(`   参考库: ${db.samples.length} 个视频, ${refList.length} 个嵌入\n`);

  // 提取帧
  const frames = extractFrames(videoPath, [1, 3, 5, 8]);
  if (frames.length === 0) {
    console.error('❌ 未能提取任何有效帧');
    process.exit(1);
  }

  const allMatches = [];
  for (const f of frames) {
    process.stdout.write(`   第${f.second}s 帧 → `);
    const emb = await getEmbedding(f.rgb);
    if (!emb) {
      console.log('❌');
      continue;
    }

    // 计算与所有参考嵌入的相似度
    const sims = refList.map((ref, idx) => ({
      idx,
      label: ref.label,
      source: ref.source,
      similarity: cosineSimilarity(emb, ref.embedding)
    }));
    sims.sort((a, b) => b.similarity - a.similarity);

    const top = sims[0];
    const adVotes = sims.filter(s => s.label === 'ad').reduce((sum, s) => sum + s.similarity, 0);
    const normalVotes = sims.filter(s => s.label === 'normal').reduce((sum, s) => sum + s.similarity, 0);

    console.log(`最似: ${top.source} (${top.label}, ${top.similarity.toFixed(3)})`);
    allMatches.push({
      second: f.second,
      topMatch: { source: top.source, label: top.label, similarity: top.similarity },
      adTotalSim: adVotes,
      normalTotalSim: normalVotes
    });
  }

  // 汇总投票
  const adScoreSum = allMatches.reduce((s, m) => s + m.adTotalSim, 0);
  const normalScoreSum = allMatches.reduce((s, m) => s + m.normalTotalSim, 0);
  const adVoteCount = allMatches.filter(m => m.topMatch.label === 'ad').length;
  const normalVoteCount = allMatches.filter(m => m.topMatch.label === 'normal').length;

  console.log('\n═══════════════════════════════════════');
  console.log('  检测结果');
  console.log('═══════════════════════════════════════');
  console.log(`  广告总相似度:  ${adScoreSum.toFixed(3)}`);
  console.log(`  正常总相似度:  ${normalScoreSum.toFixed(3)}`);
  console.log(`  广告帧投票:    ${adVoteCount}/${allMatches.length}`);
  console.log(`  正常帧投票:    ${normalVoteCount}/${allMatches.length}`);

  const isAd = adScoreSum > normalScoreSum;
  const confidence = Math.abs(adScoreSum - normalScoreSum) / Math.max(adScoreSum + normalScoreSum, 0.001);
  console.log(`\n  🏷 判定: ${isAd ? '🔴 广告' : '🟢 正常'} (置信度: ${(confidence * 100).toFixed(1)}%)`);
  console.log('═══════════════════════════════════════');
}

// ====================================================================
//  主入口
// ====================================================================

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.log(`
ONNX 模型练习/训练工具
═══════════════════════════════════════════════════════

用法:
  node scripts/onnx-trainer.js <命令> [参数]

命令:
  init                  初始化参考嵌入库
  stats                 查看参考库摘要
  train  --video 路径 --label ad|normal   训练单个视频
  batch  目录路径       批量训练（目录下须有 ad/ normal/ 子目录）
  test   视频路径       测试视频是否为广告
  reset                 重置（清空）参考库

  `);
    return;
  }

  switch (cmd) {
    case 'init':
      cmdInit();
      break;
    case 'stats':
      cmdStats();
      break;
    case 'reset':
      cmdReset();
      break;
    case 'train': {
      const videoIdx = args.indexOf('--video');
      const labelIdx = args.indexOf('--label');
      if (videoIdx === -1 || labelIdx === -1) {
        console.error('用法: node scripts/onnx-trainer.js train --video <路径> --label ad|normal');
        process.exit(1);
      }
      await cmdTrain(args[videoIdx + 1], args[labelIdx + 1]);
      break;
    }
    case 'batch':
      if (!args[1]) {
        console.error('用法: node scripts/onnx-trainer.js batch <目录路径>');
        process.exit(1);
      }
      await cmdBatch(args[1]);
      break;
    case 'test':
      if (!args[1]) {
        console.error('用法: node scripts/onnx-trainer.js test <视频路径>');
        process.exit(1);
      }
      await cmdTest(args[1]);
      break;
    default:
      console.error(`未知命令: ${cmd}`);
      process.exit(1);
  }
}

main().catch(err => {
  console.error('[致命错误]', err.message || err);
  process.exit(1);
});
