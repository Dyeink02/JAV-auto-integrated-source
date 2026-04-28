#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const ROOT_DIR = process.cwd();
const decoder = new TextDecoder('utf-8', { fatal: true });

const SKIP_DIRS = new Set([
  '.git',
  '.husky/_',
  'node_modules',
  'dist',
  'release',
  'build',
  '.idea',
  '.vscode',
  '.claude'
]);

const CHECK_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.less',
  '.yml',
  '.yaml',
  '.txt',
  '.xml',
  '.ini',
  '.nsh'
]);

const CHECK_FILENAMES = new Set(['.editorconfig', '.gitignore', '.npmignore', 'LICENSE']);

function shouldSkipDirectory(relativeDir) {
  const normalized = relativeDir.replace(/\\/g, '/');
  if (!normalized) {
    return false;
  }
  return Array.from(SKIP_DIRS).some((segment) => normalized === segment || normalized.startsWith(`${segment}/`));
}

function shouldCheckFile(filePath) {
  const basename = path.basename(filePath);
  if (CHECK_FILENAMES.has(basename)) {
    return true;
  }
  return CHECK_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walk(dirPath, relativeDir = '') {
  const output = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  entries.forEach((entry) => {
    const absolutePath = path.join(dirPath, entry.name);
    const relativePath = path.join(relativeDir, entry.name);

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(relativePath)) {
        return;
      }
      output.push(...walk(absolutePath, relativePath));
      return;
    }

    if (entry.isFile() && shouldCheckFile(absolutePath)) {
      output.push(absolutePath);
    }
  });

  return output;
}

function isUtf8(buffer) {
  try {
    decoder.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function main() {
  const files = walk(ROOT_DIR);
  const failures = [];

  files.forEach((filePath) => {
    try {
      const buffer = fs.readFileSync(filePath);
      if (!isUtf8(buffer)) {
        failures.push(path.relative(ROOT_DIR, filePath));
      }
    } catch (error) {
      failures.push(`${path.relative(ROOT_DIR, filePath)} (read failed: ${error.message})`);
    }
  });

  if (failures.length > 0) {
    console.error('[encoding-check] Found non-UTF8 files:');
    failures.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
  }

  console.log(`[encoding-check] OK (${files.length} files checked as UTF-8).`);
}

main();
