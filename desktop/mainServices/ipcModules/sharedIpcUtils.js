'use strict';

const { PUSH } = require('../../common/ipcChannels');

/**
 * Shared utility functions used across IPC handler modules.
 *
 * Eliminates duplication of normalizeKeywordList, normalizeFilmCode,
 * normalizeCodeList, normalizeAdModelType, and renderer messaging helpers.
 */

function normalizeKeywordList(rawValue) {
  const rawText = String(rawValue || '').trim();
  if (!rawText) return [];
  return Array.from(
    new Set(
      rawText
        .split(/[\r\n,\uff0c\u3001;；\uff1b]+/)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function normalizeFilmCode(rawValue) {
  const compactValue = String(rawValue || '')
    .toUpperCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-');
  const match = compactValue.match(/^([A-Z]{2,12})-?(\d{2,8})([A-Z]*)$/);
  if (!match) return compactValue;
  const [, prefix, digits, suffix] = match;
  return `${prefix}-${digits}${suffix}`.replace(/-+/g, '-');
}

function normalizeCodeList(rawValue) {
  const rawText = Array.isArray(rawValue) ? rawValue.join('\n') : String(rawValue || '');
  return Array.from(
    new Set(
      rawText
        .split(/[\r\n,\uff0c\u3001;；\uff1b\s]+/)
        .map((item) => normalizeFilmCode(item))
        .filter(Boolean)
    )
  );
}

function normalizeAdModelType(_rawValue) {
  // Only one model now: ONNX MobileNetV3
  return 'mobile-net-v3-onnx';
}

function createRendererMessenger(windowService) {
  function sendOrganizerLog(entry = {}) {
    const mainWindow = windowService.getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const payload = {
      level: entry.level || 'info',
      message: String(entry.message || ''),
      timestamp: entry.timestamp || new Date().toISOString()
    };
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(PUSH.ORGANIZER_LOG, payload);
    }
  }

  function sendOrganizerState(payload = {}) {
    const mainWindow = windowService.getWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(PUSH.ORGANIZER_STATE, payload);
    }
  }

  return { sendOrganizerLog, sendOrganizerState };
}

module.exports = {
  normalizeKeywordList,
  normalizeFilmCode,
  normalizeCodeList,
  normalizeAdModelType,
  createRendererMessenger
};
