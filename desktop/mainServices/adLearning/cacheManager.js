'use strict';

const { normalizeFrameSeconds } = require('./hashCalculator');
const { HASH_CACHE_VERSION, HASH_CACHE_MAX_ITEMS, HASH_CACHE_DIRTY_FLUSH_THRESHOLD, CACHE_TRIM_UPPER_RATIO, CACHE_TRIM_TARGET_RATIO } = require('./constants');

/**
 * Creates the hash cache manager with dirty-flag batch write optimization.
 * Writes to disk at most once per HASH_CACHE_DIRTY_FLUSH_THRESHOLD calls,
 * and always on explicit flushHashCache() (e.g. app exit).
 *
 * @param {{ app: object, fs: object, path: object }} deps
 * @returns {{ buildVideoHashCacheKey: Function, getCachedVideoHashes: Function, setCachedVideoHashes: Function, flushHashCache: Function }}
 */
function createCacheManager({ app, fs, path }) {
  /** @type {object|null} In-memory cache object */
  let hashCache = null;
  /** @type {boolean} True when in-memory cache has unsaved changes */
  let hashCacheDirty = false;
  /** @type {number} Number of dirty writes since last flush */
  let hashCacheDirtyCount = 0;

  function getHashCachePath() {
    return path.join(app.getPath('userData'), 'ad-learning-hash-cache.json');
  }

  function ensureParentDir(filePath) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch {
      // Ignore
    }
  }

  function loadHashCache() {
    if (hashCache !== null) return hashCache;
    const cachePath = getHashCachePath();
    if (!fs.existsSync(cachePath)) {
      hashCache = { version: HASH_CACHE_VERSION, updatedAt: '', items: {} };
      return hashCache;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      hashCache = {
        version: HASH_CACHE_VERSION,
        updatedAt: String(parsed.updatedAt || ''),
        items: parsed && parsed.items && typeof parsed.items === 'object' ? parsed.items : {}
      };
    } catch {
      hashCache = { version: HASH_CACHE_VERSION, updatedAt: '', items: {} };
    }
    return hashCache;
  }

  function trimHashCache(cache) {
    if (!cache || !cache.items || typeof cache.items !== 'object') return;
    const entries = Object.entries(cache.items);
    // Hysteresis: only trim when exceeding 110% of max, trim down to 90% of max
    const trimThreshold = Math.ceil(HASH_CACHE_MAX_ITEMS * CACHE_TRIM_UPPER_RATIO);
    const trimTarget = Math.floor(HASH_CACHE_MAX_ITEMS * CACHE_TRIM_TARGET_RATIO);
    if (entries.length <= trimThreshold) return;
    entries.sort((l, r) => {
      const lt = Number(l[1] && l[1].updatedAtMs ? l[1].updatedAtMs : 0);
      const rt = Number(r[1] && r[1].updatedAtMs ? r[1].updatedAtMs : 0);
      return lt - rt;
    });
    const removeCount = entries.length - trimTarget;
    for (let i = 0; i < removeCount; i++) delete cache.items[entries[i][0]];
  }

  function saveHashCache(cache) {
    const nextCache = cache || loadHashCache();
    nextCache.updatedAt = new Date().toISOString();
    trimHashCache(nextCache);
    const cachePath = getHashCachePath();
    ensureParentDir(cachePath);
    // Atomic write
    const tempPath = cachePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(nextCache, null, 2), 'utf8');
    try { fs.renameSync(tempPath, cachePath); } catch { fs.writeFileSync(cachePath, JSON.stringify(nextCache, null, 2), 'utf8'); }
    return nextCache;
  }

  /**
   * Builds a stable cache key from video path, file stat, and frame seconds.
   * @param {string} videoPath
   * @param {object} stat - fs.Stats object
   * @param {number[]} frameSeconds
   * @returns {string}
   */
  function buildVideoHashCacheKey(videoPath, stat, frameSeconds) {
    // Escape pipe chars in path to prevent cache key collision
    const normalizedPath = path.resolve(String(videoPath || '')).toLowerCase().replace(/\|/g, '%7C');
    const size = Number(stat && Number.isFinite(stat.size) ? stat.size : 0);
    const mtimeMs = Number(stat && Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0);
    const frameKey = normalizeFrameSeconds(frameSeconds).join(',');
    return `${normalizedPath}|${size}|${mtimeMs}|${frameKey}`;
  }

  /**
   * Returns cached hashes for a given cache key, or empty object on miss.
   * Backward compatible: old cache entries only have `hashes` (aHash strings).
   * @param {string} cacheKey
   * @returns {{ aHashes: string[], dHashes: string[] }}
   */
  function getCachedVideoHashes(cacheKey) {
    if (!cacheKey) return { aHashes: [], dHashes: [] };
    const cache = loadHashCache();
    const record = cache.items && cache.items[cacheKey];
    if (!record) return { aHashes: [], dHashes: [] };
    const aHashes = Array.isArray(record.hashes) ? record.hashes.map((h) => String(h || '').trim()).filter(Boolean) : [];
    const dHashes = Array.isArray(record.dHashes) ? record.dHashes.map((h) => String(h || '').trim()) : [];
    return { aHashes, dHashes };
  }

  /**
   * Stores hashes in the in-memory cache and marks dirty.
   * Auto-flushes to disk every HASH_CACHE_DIRTY_FLUSH_THRESHOLD writes
   * instead of writing on every call (Task 2: batch write optimization).
   * @param {string} cacheKey
   * @param {string[]} hashes - aHash strings
   * @param {string[]} [dHashList] - dHash strings
   */
  function setCachedVideoHashes(cacheKey, hashes, dHashList) {
    if (!cacheKey || !Array.isArray(hashes) || hashes.length === 0) return;
    const cache = loadHashCache();
    const entry = {
      updatedAtMs: Date.now(),
      hashes: hashes.map((h) => String(h || '').trim()).filter(Boolean).slice(0, 20)
    };
    if (Array.isArray(dHashList) && dHashList.length > 0) {
      entry.dHashes = dHashList.map((h) => String(h || '')).slice(0, 20);
    }
    cache.items[cacheKey] = entry;
    hashCacheDirty = true;
    hashCacheDirtyCount++;
    if (hashCacheDirtyCount >= HASH_CACHE_DIRTY_FLUSH_THRESHOLD) {
      saveHashCache(cache);
      hashCacheDirty = false;
      hashCacheDirtyCount = 0;
    }
  }

  /**
   * Persists any pending dirty cache entries to disk.
   * Should be called on app exit to avoid data loss.
   */
  function flushHashCache() {
    if (!hashCacheDirty) return;
    saveHashCache(hashCache);
    hashCacheDirty = false;
    hashCacheDirtyCount = 0;
  }

  return { buildVideoHashCacheKey, getCachedVideoHashes, setCachedVideoHashes, flushHashCache };
}

module.exports = { createCacheManager };
