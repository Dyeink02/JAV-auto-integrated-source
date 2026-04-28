(function initializeDesktopUiText(globalScope) {
  const sharedText = globalScope.desktopAppText || {};
  const appInfo = sharedText.APP_INFO || {};
  const versionHistory = Array.isArray(sharedText.VERSION_HISTORY) ? sharedText.VERSION_HISTORY : [];
  const urlSuggestions = Array.isArray(sharedText.URL_SUGGESTIONS) ? sharedText.URL_SUGGESTIONS : [];
  const taskTemplates = sharedText.TASK_TEMPLATES || {};
  const statusLabels = sharedText.STATUS_LABELS || {};
  const failureCategoryLabels = sharedText.FAILURE_CATEGORY_LABELS || {};
  const uiTextSource = sharedText.UI_TEXT_SOURCE || {};

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  const UI_TEXT = Object.assign(
    {
      appTitle: appInfo.title || 'JAV\u81ea\u52a8\u5316\u722c\u866b\u5de5\u5177',
      version: appInfo.version || '0.23',
      source: {
        href: appInfo.sourceUrl || 'https://github.com/raawaa/jav-scrapy',
        name: appInfo.sourceName || 'raawaa/jav-scrapy'
      }
    },
    deepClone(uiTextSource)
  );

  UI_TEXT.hero = Object.assign(
    {
      versionTitle: '\u7248\u672c\u66f4\u65b0',
      connectionTip:
        '\u5efa\u8bae\u5168\u7a0b\u5f00\u542f\u7a33\u5b9a\u7684 VPN / \u4ee3\u7406\u73af\u5883\uff0c\u53ef\u6709\u6548\u63d0\u5347\u6293\u53d6\u901f\u5ea6\u3001\u7a33\u5b9a\u6027\u4e0e\u5f02\u5e38\u6062\u590d\u6210\u529f\u7387\u3002'
    },
    UI_TEXT.hero || {}
  );

  UI_TEXT.ranking = Object.assign(
    {
      channelLabel: '\u4fe1\u606f\u6e20\u9053',
      officialProxyTip:
        '\u82e5\u9700\u7a33\u5b9a\u8bbf\u95ee\u5b98\u65b9\u699c\u5355\uff0c\u5efa\u8bae\u5f00\u542f\u65e5\u672c\u5730\u533a\u4ee3\u7406 / VPN\uff0c\u4ee5\u83b7\u5f97\u66f4\u597d\u7684\u52a0\u8f7d\u6210\u529f\u7387\u4e0e\u6570\u636e\u5b8c\u6574\u6027\u3002'
    },
    UI_TEXT.ranking || {}
  );

  function getValueByPath(source, valuePath) {
    return String(valuePath || '')
      .split('.')
      .filter(Boolean)
      .reduce((currentValue, currentKey) => (currentValue == null ? undefined : currentValue[currentKey]), source);
  }

  function clearChildren(container) {
    while (container && container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  function applyDatasetText(root) {
    root.querySelectorAll('[data-ui-text]').forEach((node) => {
      const value = getValueByPath(UI_TEXT, node.dataset.uiText);
      if (typeof value === 'string') {
        node.textContent = value;
      }
    });

    root.querySelectorAll('[data-ui-placeholder]').forEach((node) => {
      const value = getValueByPath(UI_TEXT, node.dataset.uiPlaceholder);
      if (typeof value === 'string') {
        node.setAttribute('placeholder', value);
      }
    });
  }

  function renderTaskTemplateOptions(selectElement) {
    if (!selectElement) {
      return;
    }

    clearChildren(selectElement);

    Object.entries(taskTemplates).forEach(([value, template]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = template.label;
      selectElement.appendChild(option);
    });
  }

  function renderVersionHistory(listElement) {
    if (!listElement) {
      return;
    }

    clearChildren(listElement);

    versionHistory.forEach((item) => {
      const entry = document.createElement('li');
      const version = document.createElement('strong');

      version.textContent = item.version;
      entry.appendChild(version);
      entry.appendChild(document.createTextNode(item.summary));
      listElement.appendChild(entry);
    });

    const scrollContainer = listElement.parentElement;
    if (scrollContainer) {
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
    }
  }

  function renderBaseUrlChips(container) {
    if (!container) {
      return;
    }

    clearChildren(container);

    urlSuggestions.forEach((url) => {
      const button = document.createElement('button');
      button.className = 'base-url-chip';
      button.type = 'button';
      button.dataset.url = url;
      button.textContent = url;
      container.appendChild(button);
    });
  }

  function applyStaticText(root = document) {
    document.title = UI_TEXT.appTitle;
    applyDatasetText(root);

    const versionBadge = root.getElementById('version-badge');
    if (versionBadge) {
      versionBadge.textContent = `v${UI_TEXT.version}`;
    }

    const sourceLink = root.getElementById('source-link');
    if (sourceLink) {
      sourceLink.textContent = UI_TEXT.source.name;
      sourceLink.href = UI_TEXT.source.href;
    }

    const statusPill = root.getElementById('status-pill');
    if (statusPill) {
      statusPill.textContent = statusLabels.idle || '\u5f85\u547d';
    }

    const stateMessage = root.getElementById('state-message');
    if (stateMessage) {
      stateMessage.textContent = UI_TEXT.state.defaultMessage;
    }

    const totalPagesAdvice = root.getElementById('total-pages-advice');
    if (totalPagesAdvice) {
      totalPagesAdvice.textContent = UI_TEXT.advice.defaultPrimary;
    }

    const totalPagesMeta = root.getElementById('total-pages-meta');
    if (totalPagesMeta) {
      totalPagesMeta.textContent = `${UI_TEXT.advice.defaultSecondaryPrefix}${UI_TEXT.limits.defaultItemsPerPage}${UI_TEXT.advice.defaultSecondarySuffix}`;
    }

    const logFilePath = root.getElementById('log-file-path');
    if (logFilePath) {
      logFilePath.textContent = UI_TEXT.log.initialPathHint;
    }

    renderTaskTemplateOptions(root.getElementById('taskTemplate'));
    renderVersionHistory(root.getElementById('version-history-list'));
    renderBaseUrlChips(root.getElementById('base-url-hints'));
  }

  globalScope.desktopUiText = {
    UI_TEXT,
    STATUS_LABELS: statusLabels,
    TASK_TEMPLATES: taskTemplates,
    FAILURE_CATEGORY_LABELS: failureCategoryLabels,
    applyStaticText,
    renderTaskTemplateOptions,
    renderVersionHistory,
    renderBaseUrlChips
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
