(function initializeStateController(globalScope) {
  function createChip(text, className) {
    const chip = document.createElement('span');
    chip.className = className;
    chip.textContent = text;
    return chip;
  }

  function createEmptyChip(text) {
    return createChip(text, 'task-empty-chip');
  }

  function createStateController(options) {
    const {
      statusPill,
      stateMessage,
      startButton,
      stopButton,
      restartButton,
      statPage,
      statQueued,
      statAttempted,
      statCompleted,
      currentBox,
      currentItemsView,
      unfinishedBox,
      unfinishedItemsView,
      unfinishedTotalView,
      duplicateBox,
      duplicateItemsView,
      duplicateTotalView,
      pageGapBox,
      pageGapItemsView,
      failedBox,
      failedItemsView,
      statusLabels,
      defaultMessage,
      emptyTexts,
      maxPanelItems,
      renderInterval,
      failureCategoryLabels,
      stateTexts
    } = options;

    let pendingState = null;
    let stateFlushTimer = null;

    const lastRenderSignature = {
      status: '',
      stats: '',
      active: '',
      unfinished: '',
      duplicate: '',
      pageGap: '',
      failed: ''
    };

    function normalizeItems(items = [], limit = maxPanelItems) {
      const seen = new Set();
      const normalized = [];

      for (const rawItem of Array.isArray(items) ? items : []) {
        const item = String(rawItem || '').trim();
        if (!item || seen.has(item)) {
          continue;
        }

        seen.add(item);
        normalized.push(item);

        if (normalized.length >= limit) {
          break;
        }
      }

      return normalized;
    }

    function normalizeDateText(value) {
      if (!value) {
        return '';
      }

      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false });
    }

    function translateFailureCategory(category) {
      return failureCategoryLabels[String(category || '').toLowerCase()] || failureCategoryLabels.unknown || '未知异常';
    }

    function normalizeFailedDetails(items = []) {
      const unique = [];
      const seen = new Set();

      for (const item of Array.isArray(items) ? items : []) {
        if (!item) {
          continue;
        }

        const itemId = item.item || item.sourceLink || 'unknown';
        const reason = item.reason || '';
        const signature = `${itemId}::${reason}`;

        if (seen.has(signature)) {
          continue;
        }

        seen.add(signature);
        unique.push(item);

        if (unique.length >= maxPanelItems) {
          break;
        }
      }

      return unique;
    }

    function replaceChildren(container, nodes) {
      if (!container) {
        return;
      }

      container.replaceChildren(...nodes);
    }

    function buildChipNodes(values, chipClass, emptyText) {
      if (!values || values.length === 0) {
        return [createEmptyChip(emptyText)];
      }

      return values.map((item) => createChip(item, chipClass));
    }

    function setStatus(status, message = defaultMessage) {
      const nextStatus = String(status || 'idle');
      const nextMessage = message || defaultMessage;
      const signature = `${nextStatus}##${nextMessage}`;

      if (signature === lastRenderSignature.status) {
        return;
      }

      lastRenderSignature.status = signature;
      statusPill.className = `status-pill ${nextStatus}`;
      statusPill.textContent = statusLabels[nextStatus] || nextStatus;
      stateMessage.textContent = nextMessage;

      const isStartingOrStopping = ['starting', 'stopping'].includes(nextStatus);
      const isRunning = ['starting', 'running', 'stopping'].includes(nextStatus);

      startButton.disabled = isRunning;
      stopButton.disabled = !isRunning;
      restartButton.disabled = isStartingOrStopping;
    }

    function updateStats(stats = {}) {
      const nextPage = String(stats.pageIndex ?? 1);
      const nextQueued = String(stats.queued ?? 0);
      const nextAttempted = String(stats.attempted ?? 0);
      const nextCompleted = String(stats.completed ?? 0);
      const signature = `${nextPage}|${nextQueued}|${nextAttempted}|${nextCompleted}`;

      if (signature === lastRenderSignature.stats) {
        return;
      }

      lastRenderSignature.stats = signature;
      statPage.textContent = nextPage;
      statQueued.textContent = nextQueued;
      statAttempted.textContent = nextAttempted;
      statCompleted.textContent = nextCompleted;
    }

    function updateActiveItems(items = []) {
      const normalized = normalizeItems(items, 12);
      const signature = normalized.join('|');

      if (signature === lastRenderSignature.active) {
        return;
      }

      lastRenderSignature.active = signature;

      if (normalized.length === 0) {
        currentBox.classList.add('hidden');
        replaceChildren(currentItemsView, []);
        return;
      }

      currentBox.classList.remove('hidden');
      replaceChildren(currentItemsView, buildChipNodes(normalized, 'current-chip', emptyTexts.active));
    }

    function updateUnfinishedItems(items = [], totalCount = items.length) {
      const normalized = normalizeItems(items);
      const safeTotal = Number.isFinite(totalCount) ? totalCount : normalized.length;
      const signature = `${safeTotal}|${normalized.join('|')}`;

      if (signature === lastRenderSignature.unfinished) {
        return;
      }

      lastRenderSignature.unfinished = signature;
      unfinishedBox.classList.remove('hidden');
      unfinishedTotalView.textContent = String(safeTotal);
      replaceChildren(unfinishedItemsView, buildChipNodes(normalized, 'unfinished-chip', emptyTexts.unfinished));
    }

    function updateDuplicateItems(items = [], totalCount = items.length) {
      const normalized = normalizeItems(items);
      const safeTotal = Number.isFinite(totalCount) ? totalCount : normalized.length;
      const signature = `${safeTotal}|${normalized.join('|')}`;

      if (signature === lastRenderSignature.duplicate) {
        return;
      }

      lastRenderSignature.duplicate = signature;

      if (normalized.length === 0) {
        duplicateBox.classList.add('hidden');
        duplicateTotalView.textContent = '0';
        replaceChildren(duplicateItemsView, []);
        return;
      }

      duplicateBox.classList.remove('hidden');
      duplicateTotalView.textContent = String(safeTotal);
      replaceChildren(duplicateItemsView, buildChipNodes(normalized, 'duplicate-chip', emptyTexts.duplicate));
    }

    function updatePageGapItems(items = []) {
      const normalized = normalizeItems(items);
      const signature = normalized.join('|');

      if (signature === lastRenderSignature.pageGap) {
        return;
      }

      lastRenderSignature.pageGap = signature;

      if (normalized.length === 0) {
        pageGapBox.classList.add('hidden');
        replaceChildren(pageGapItemsView, []);
        return;
      }

      pageGapBox.classList.remove('hidden');
      replaceChildren(pageGapItemsView, buildChipNodes(normalized, 'page-gap-chip', emptyTexts.pageGap));
    }

    function updateFailedDetails(items = [], totalCount = items.length) {
      const visibleItems = normalizeFailedDetails(items);
      const safeTotal = Number.isFinite(totalCount) ? totalCount : visibleItems.length;
      const signature = [
        safeTotal,
        ...visibleItems.map((item) =>
          [
            item.item || item.sourceLink || '',
            item.reason || '',
            item.category || '',
            item.retryCount || 0,
            item.recoverable === false ? 'manual' : 'auto',
            item.retryAdvice || '',
            item.lastFailedAt || ''
          ].join('|')
        )
      ].join('##');

      if (signature === lastRenderSignature.failed) {
        return;
      }

      lastRenderSignature.failed = signature;

      if (visibleItems.length === 0) {
        failedBox.classList.add('hidden');
        replaceChildren(failedItemsView, []);
        return;
      }

      failedBox.classList.remove('hidden');
      const nodes = [];

      if (safeTotal > visibleItems.length) {
        const summary = document.createElement('article');
        summary.className = 'failed-summary';
        summary.textContent =
          `${stateTexts.failedSummaryPrefix}${safeTotal}${stateTexts.failedSummaryMiddle}${visibleItems.length}${stateTexts.failedSummarySuffix}`;
        nodes.push(summary);
      }

      visibleItems.forEach((item) => {
        const card = document.createElement('article');
        const title = document.createElement('strong');
        const reason = document.createElement('span');
        const meta = document.createElement('div');
        const badges = document.createElement('div');

        card.className = 'failed-card';
        title.textContent = item.item || item.sourceLink || stateTexts.unknownItem;
        title.title = item.sourceLink || item.item || '';
        reason.textContent = item.reason || stateTexts.defaultFailureReason;

        meta.className = 'failed-meta';
        badges.className = 'failed-badges';
        badges.appendChild(
          createChip(`${stateTexts.failureCategoryPrefix}${translateFailureCategory(item.category)}`, 'failed-badge')
        );
        badges.appendChild(
          createChip(`${stateTexts.failureRetryPrefix}${Math.max(1, Number(item.retryCount) || 1)}`, 'failed-badge')
        );

        if (item.recoverable === false) {
          badges.appendChild(createChip(stateTexts.failureManualReview, 'failed-badge is-warning'));
        }

        meta.appendChild(badges);

        if (item.retryAdvice) {
          const advice = document.createElement('span');
          advice.textContent = `${stateTexts.failureAdvicePrefix}${item.retryAdvice}`;
          meta.appendChild(advice);
        }

        if (item.lastFailedAt) {
          const failedAt = document.createElement('span');
          failedAt.className = 'failed-next-retry';
          failedAt.textContent = `${stateTexts.failureTimePrefix}${normalizeDateText(item.lastFailedAt)}`;
          meta.appendChild(failedAt);
        }

        card.appendChild(title);
        card.appendChild(reason);
        card.appendChild(meta);
        nodes.push(card);
      });

      replaceChildren(failedItemsView, nodes);
    }

    function flushPendingState() {
      if (stateFlushTimer) {
        clearTimeout(stateFlushTimer);
        stateFlushTimer = null;
      }

      if (!pendingState) {
        return;
      }

      const state = pendingState;
      pendingState = null;

      setStatus(state.status, state.message || defaultMessage);
      updateStats(state.stats);
      updateActiveItems(state.activeItems);
      updateDuplicateItems(state.duplicateItems, state.duplicateItemsTotal);
      updateUnfinishedItems(state.unfinishedItems, state.unfinishedItemsTotal);
      updatePageGapItems(state.pageGapItems);
      updateFailedDetails(state.failedDetails, state.failedDetailsTotal);
    }

    function enqueueState(state) {
      pendingState = state;

      const status = String(state && state.status ? state.status : '').toLowerCase();
      const isFinalState = ['completed', 'error', 'stopped', 'incomplete'].includes(status);

      if (isFinalState) {
        flushPendingState();
        return;
      }

      if (!stateFlushTimer) {
        stateFlushTimer = setTimeout(flushPendingState, renderInterval);
      }
    }

    return {
      enqueueState,
      setStatus
    };
  }

  globalScope.desktopStateController = {
    createStateController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
