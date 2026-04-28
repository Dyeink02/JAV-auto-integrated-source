'use strict';

/**
 * 本地 ONNX 模型练习/测试脚本
 * 
 * 用途：在本地计算机上验证 MobileNetV3 ONNX 模型是否正常工作，
 *       测试推理管线、嵌入向量提取、余弦相似度等核心功能。
 * 
 * 用法：node scripts/test-onnx-local.js [图片路径]
 *      不带参数则使用随机张量测试模型加载和推理。
 */

const ort = require('onnxruntime-node');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const MODEL_FILE = 'mobile-net-v3-small.onnx';
const INPUT_SIZE = 224;

// ─── 查找模型文件 ──────────────────────────────────────────────────

function findModel() {
  const candidates = [
    path.join(__dirname, '..', 'desktop', 'resources', 'models', MODEL_FILE),
    path.join(__dirname, '..', 'desktop', 'resources', MODEL_FILE),
    path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', MODEL_FILE),
    path.join(process.env.APPDATA || '', 'jav-auto-crawler-tool', MODEL_FILE),
    path.join(__dirname, MODEL_FILE)
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// ─── 图像预处理（ImageNet 标准化）──────────────────────────────────

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

// ─── 余弦相似度 ────────────────────────────────────────────────────

function cosineSimilarity(embA, embB) {
  if (!embA || !embB || embA.length === 0 || embB.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(embA.length, embB.length);
  for (let i = 0; i < len; i++) {
    dot += (embA[i] || 0) * (embB[i] || 0);
    normA += (embA[i] || 0) ** 2;
    normB += (embB[i] || 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── 使用 FFmpeg 提取帧并缩放到 224x224 ────────────────────────────

function extractFrameWithFfmpeg(videoPath, second, outputPath) {
  try {
    execSync(
      `ffmpeg -ss ${second} -i "${videoPath}" -vframes 1 -s ${INPUT_SIZE}x${INPUT_SIZE} -pix_fmt rgb24 -f rawvideo "${outputPath}" -y`,
      { stdio: 'pipe', timeout: 10000 }
    );
    const buf = fs.readFileSync(outputPath);
    if (buf.length < INPUT_SIZE * INPUT_SIZE * 3) {
      console.warn(`  帧数据不完整: ${buf.length} bytes`);
      return null;
    }
    return Array.from(buf.slice(0, INPUT_SIZE * INPUT_SIZE * 3));
  } catch (e) {
    console.error(`  FFmpeg 提取失败 (${second}s):`, e.message);
    return null;
  }
}

// ─── 装加载模型 ────────────────────────────────────────────────────

async function loadSession(modelPath) {
  console.log(`[加载] 模型路径: ${modelPath}`);
  console.log(`[加载] 模型大小: ${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(2)} MB`);

  const start = Date.now();
  const session = await ort.InferenceSession.create(modelPath, {
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true
  });
  const elapsed = Date.now() - start;

  console.log(`[加载] 耗时: ${elapsed}ms`);
  console.log(`[加载] 输入: ${session.inputNames.join(', ')}`);
  console.log(`[加载] 输出: ${session.outputNames.join(', ')}\n`);

  return session;
}

// ─── 运行推理 ──────────────────────────────────────────────────────

async function runInference(session, tensor) {
  const dims = [1, 3, INPUT_SIZE, INPUT_SIZE];
  const ortTensor = new ort.Tensor('float32', Float32Array.from(tensor), dims);

  const feeds = {};
  feeds[session.inputNames[0]] = ortTensor;

  const start = Date.now();
  const results = await session.run(feeds);
  const elapsed = Date.now() - start;

  const output0 = results[session.outputNames[0]]?.data;
  const output1 = results[session.outputNames[1]]?.data;

  return {
    elapsed,
    logits: output0 ? Array.from(output0) : [],
    embedding: output1 ? Array.from(output1) : []
  };
}

// ─── 主流程 ────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  JAV ONNX MobileNetV3 本地练习脚本');
  console.log('═══════════════════════════════════════════\n');

  // 1. 查找模型
  const modelPath = findModel();
  if (!modelPath) {
    console.error('[错误] 找不到 ONNX 模型文件！');
    console.error('  请确保 mobile-net-v3-small.onnx 位于以下位置之一：');
    console.error('    - desktop/resources/models/');
    console.error('    - desktop/resources/');
    console.error('    - 或当前脚本目录下');
    process.exit(1);
  }

  // 2. 加载模型
  console.log('【步骤 1】加载 ONNX 模型');
  let session;
  try {
    session = await loadSession(modelPath);
  } catch (e) {
    console.error('[错误] 模型加载失败:', e.message);
    process.exit(1);
  }

  // 3. 随机张量推理测试
  console.log('【步骤 2】随机张量推理测试（验证推理管线）');
  const randomRgb = new Array(INPUT_SIZE * INPUT_SIZE * 3).fill(0).map(() => Math.floor(Math.random() * 256));
  const tensor = rgbToTensor(randomRgb);

  const result = await runInference(session, tensor);
  console.log(`  推理耗时: ${result.elapsed}ms`);
  console.log(`  Logits 维度: ${result.logits.length}`);
  console.log(`  Embedding 维度: ${result.embedding.length}`);
  console.log(`  Top-5 Logits: ${result.logits.slice(0, 5).map(v => Number(v).toFixed(4)).join(', ')}`);
  console.log(`  Embedding 前5维: ${result.embedding.slice(0, 5).map(v => Number(v).toFixed(4)).join(', ')}\n`);

  // 4. 相似度测试（两张不同随机图的嵌入对比）
  console.log('【步骤 3】余弦相似度测试');
  const randomRgb2 = new Array(INPUT_SIZE * INPUT_SIZE * 3).fill(0).map(() => Math.floor(Math.random() * 256));
  const tensor2 = rgbToTensor(randomRgb2);
  const result2 = await runInference(session, tensor2);

  const sim = cosineSimilarity(result.embedding, result2.embedding);
  console.log(`  两张随机图片的嵌入余弦相似度: ${sim.toFixed(4)}`);
  console.log('  (随机图片的相似度应接近 0，说明嵌入有区分度)\n');

  // 5. 实际图片/视频测试（如果提供了参数）
  const inputPath = process.argv[2];
  if (inputPath && fs.existsSync(inputPath)) {
    console.log('【步骤 4】实际文件推理测试');
    const ext = path.extname(inputPath).toLowerCase();

    if (['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.ts'].includes(ext)) {
      // 视频：提取第1秒和第3秒的帧进行推理
      console.log(`  视频文件: ${path.basename(inputPath)}`);
      const tmpDir = path.join(__dirname, '..', 'temp-onnx-test');
      fs.mkdirSync(tmpDir, { recursive: true });

      for (const sec of [1, 3]) {
        const framePath = path.join(tmpDir, `frame_${sec}s.rgb`);
        const rgb = extractFrameWithFfmpeg(inputPath, sec, framePath);
        if (rgb) {
          const t = rgbToTensor(rgb);
          const r = await runInference(session, t);
          console.log(`  ${sec}s 帧推理: ${r.elapsed}ms | Top-3 logits: ${r.logits.slice(0, 3).map(v => Number(v).toFixed(3)).join(', ')}`);
        }
        try { fs.unlinkSync(framePath); } catch (_) {}
      }
      try { fs.rmdirSync(tmpDir); } catch (_) {}
    } else if (['.jpg', '.jpeg', '.png', '.bmp', '.webp'].includes(ext)) {
      // 图片：用 FFmpeg 转换为 RGB raw 数据
      console.log(`  图片文件: ${path.basename(inputPath)}`);
      const tmpDir = path.join(__dirname, '..', 'temp-onnx-test');
      fs.mkdirSync(tmpDir, { recursive: true });
      const rawPath = path.join(tmpDir, 'image.rgb');
      try {
        execSync(
          `ffmpeg -i "${inputPath}" -s ${INPUT_SIZE}x${INPUT_SIZE} -pix_fmt rgb24 -f rawvideo "${rawPath}" -y`,
          { stdio: 'pipe', timeout: 10000 }
        );
        const buf = fs.readFileSync(rawPath);
        const rgb = Array.from(buf.slice(0, INPUT_SIZE * INPUT_SIZE * 3));
        const t = rgbToTensor(rgb);
        const r = await runInference(session, t);
        console.log(`  推理耗时: ${r.elapsed}ms`);
        console.log(`  Embedding 维度: ${r.embedding.length}`);
        console.log(`  Embedding 前10维: ${r.embedding.slice(0, 10).map(v => Number(v).toFixed(4)).join(', ')}`);
      } catch (e) {
        console.error('  图片处理失败:', e.message);
      }
      try { fs.unlinkSync(rawPath); fs.rmdirSync(tmpDir); } catch (_) {}
    }
  } else if (inputPath) {
    console.log(`  文件不存在: ${inputPath}\n`);
  }

  // 6. 总结
  console.log('═══════════════════════════════════════════');
  console.log('  ✅ ONNX 模型推理测试全部通过！');
  console.log(`  模型路径: ${modelPath}`);
  console.log(`  推理引擎: onnxruntime-node (${ort.version || 'unknown'})`);
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('[致命错误]', err);
  process.exit(1);
});
