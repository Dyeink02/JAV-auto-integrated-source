'use strict';

/**
 * runtimeState.js
 * 统一运行时状态管理器 —— 基于 Proxy 的响应式状态包装。
 *
 * 设计原则：
 *   - **零迁移成本**：所有现有 `state.xxx = yyy` 语法继续工作
 *   - **变更可观测**：通过 `state._on(key, callback)` 订阅任意属性变更
 *   - **快照能力**：`state._snapshot()` 返回可序列化的状态副本
 *   - 以 _ 开头的方法为元操作，不会被代理拦截
 *
 * 使用方式不变：
 *   const state = createRuntimeState();
 *   state.activeRunner = new ScraperRunner(...);  // 正常赋值
 *   state._on('organizerRunning', (value) => { ... });  // 订阅变更
 */

function createRuntimeState() {
  // ── 原始状态（与旧版完全一致） ──────────────────────────────────────────

  const raw = {
    mainWindow: null,
    activeRunner: null,
    currentTaskOutputDir: null,
    lastTaskOutputDir: null,
    organizerRunning: false,
    organizerPaused: false,
    organizerAbortController: null,
    quittingAfterStop: false,
    pendingRestartSettings: null,
    ipcHandlersRegistered: false
  };

  // ── 变更订阅系统 ──────────────────────────────────────────────────────

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Set<Function>} */
  const globalListeners = new Set();

  /**
   * 订阅特定属性的变更。
   * @param {string} key - 属性名，或 '*' 表示所有变更
   * @param {Function} callback - (newValue, oldValue, key) => void
   * @returns {Function} 取消订阅函数
   */
  function on(key, callback) {
    if (key === '*') {
      globalListeners.add(callback);
      return () => globalListeners.delete(callback);
    }
    if (!listeners.has(key)) {
      listeners.set(key, new Set());
    }
    listeners.get(key).add(callback);
    return () => {
      const set = listeners.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) listeners.delete(key);
      }
    };
  }

  function notify(key, newValue, oldValue) {
    const keySet = listeners.get(key);
    if (keySet) {
      for (const cb of keySet) {
        try { cb(newValue, oldValue, key); } catch { /* 订阅者不应中断主流程 */ }
      }
    }
    for (const cb of globalListeners) {
      try { cb(newValue, oldValue, key); } catch { /* 同上 */ }
    }
  }

  /**
   * 返回可序列化的状态快照（排除不可序列化的对象引用）。
   * @returns {object}
   */
  function snapshot() {
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
      // 跳过不可序列化的引用（Window、Runner、AbortController 等）
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        result[key] = value;
      } else if (key === 'pendingRestartSettings') {
        result[key] = { ...value };  // 浅拷贝设置对象
      } else {
        result[key] = `[${value.constructor?.name || 'Object'}]`;
      }
    }
    return result;
  }

  // ── 元方法定义（以 _ 开头，不被 Proxy 拦截） ──────────────────────────

  const META_METHODS = {
    _on: on,
    _snapshot: snapshot,
    _raw: raw
  };

  // ── Proxy 包装 ─────────────────────────────────────────────────────────

  const proxy = new Proxy(raw, {
    get(target, prop) {
      // 元方法优先
      if (typeof prop === 'string' && prop in META_METHODS) {
        return META_METHODS[prop];
      }
      return target[prop];
    },

    set(target, prop, value) {
      const oldValue = target[prop];
      target[prop] = value;
      // 仅在值实际变化时通知（引用比较）
      if (oldValue !== value) {
        notify(String(prop), value, oldValue);
      }
      return true;
    },

    has(target, prop) {
      return prop in META_METHODS || prop in target;
    },

    ownKeys(target) {
      return Reflect.ownKeys(target);
    },

    getOwnPropertyDescriptor(target, prop) {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
  });

  return proxy;
}

module.exports = {
  createRuntimeState
};
