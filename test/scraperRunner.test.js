const assert = require('assert');

const ScraperRunner = require('../dist/core/scraperRunner').default;

describe('ScraperRunner limit tracking', () => {
  it('tracks only the remaining links inside the configured limit window', () => {
    const runner = new ScraperRunner();
    runner.config = { limit: 3 };
    runner.expectedItemIds = new Set(['ABP-001']);

    const trackedLinks = runner.getTrackedPageLinks([
      'https://www.javbus.com/ABP-002',
      'https://www.javbus.com/ABP-003',
      'https://www.javbus.com/ABP-004'
    ]);

    assert.deepStrictEqual(trackedLinks, [
      'https://www.javbus.com/ABP-002',
      'https://www.javbus.com/ABP-003'
    ]);
  });

  it('does not leave overflow links in the expected reconciliation set', () => {
    const runner = new ScraperRunner();
    runner.config = { limit: 1 };

    const trackedLinks = runner.getTrackedPageLinks([
      'https://www.javbus.com/ABP-001',
      'https://www.javbus.com/ABP-002',
      'https://www.javbus.com/ABP-003'
    ]);

    runner.recordExpectedPageLinks(1, trackedLinks);

    assert.deepStrictEqual(Array.from(runner.expectedItemIds), ['ABP-001']);
    assert.deepStrictEqual(runner.getExpectedButNotQueuedLinks(), ['https://www.javbus.com/ABP-001']);
  });

  it('writes light snapshots without heavy reconciliation payloads and keeps policy-skip ids', () => {
    const runner = new ScraperRunner();
    runner.config = {
      BASE_URL: 'https://www.javbus.com',
      base: 'https://www.javbus.com',
      output: 'C:/temp',
      limit: 10,
      totalPages: 1,
      parallel: 2,
      delay: 2,
      timeout: 30000,
      secondValidation: false,
      taskTemplate: 'balanced'
    };
    runner.expectedDetailLinks = new Set(['https://www.javbus.com/ABP-001']);
    runner.queuedDetailLinks = new Set(['https://www.javbus.com/ABP-001']);
    runner.processedDetailLinks = new Set(['https://www.javbus.com/ABP-001']);
    runner.persistedDetailLinks = new Set(['https://www.javbus.com/ABP-001']);
    runner.persistedFilmIds = new Set(['ABP-001']);
    runner.skippedByPolicyItemIds = new Set(['ABP-002']);

    const snapshot = runner.buildTaskSnapshot('running', 'testing', 'light');

    assert.deepStrictEqual(snapshot.links.expected, ['https://www.javbus.com/ABP-001']);
    assert.deepStrictEqual(snapshot.links.skippedIds, ['ABP-002']);
    assert.strictEqual(snapshot.progress.skipped, 1);
    assert.strictEqual(snapshot.links.expectedIds, undefined);
    assert.strictEqual(snapshot.reconciliation, undefined);
    assert.strictEqual(snapshot.validationReport, undefined);
  });

  it('explains duplicate source entries in the final state and unfinished report', () => {
    const runner = new ScraperRunner();
    runner.config = {
      limit: 10,
      secondValidation: true
    };
    runner.expectedItemIds = new Set(['AAA-001', 'AAA-002', 'AAA-003', 'AAA-004', 'AAA-005', 'AAA-006']);
    runner.expectedDetailLinks = new Set([
      'https://www.javbus.com/AAA-001',
      'https://www.javbus.com/AAA-002',
      'https://www.javbus.com/AAA-003',
      'https://www.javbus.com/AAA-004',
      'https://www.javbus.com/AAA-005',
      'https://www.javbus.com/AAA-006',
      'https://www.javbus.com/AAA-001?dup=1',
      'https://www.javbus.com/AAA-002?dup=1'
    ]);
    runner.expectedItemVariantLinks = new Map([
      ['AAA-001', new Set(['https://www.javbus.com/AAA-001', 'https://www.javbus.com/AAA-001?dup=1'])],
      ['AAA-002', new Set(['https://www.javbus.com/AAA-002', 'https://www.javbus.com/AAA-002?dup=1'])],
      ['AAA-003', new Set(['https://www.javbus.com/AAA-003'])],
      ['AAA-004', new Set(['https://www.javbus.com/AAA-004'])],
      ['AAA-005', new Set(['https://www.javbus.com/AAA-005'])],
      ['AAA-006', new Set(['https://www.javbus.com/AAA-006'])]
    ]);
    runner.duplicateExpectedIds = new Set(['AAA-001', 'AAA-002']);
    runner.persistedItemIds = new Set(['AAA-001', 'AAA-002', 'AAA-003', 'AAA-004', 'AAA-005', 'AAA-006']);
    runner.persistedFilmIds = new Set(['AAA-001', 'AAA-002', 'AAA-003', 'AAA-004', 'AAA-005', 'AAA-006']);
    runner.filmCount = 6;
    runner.validationReport = { passed: true };

    const finalState = runner.getFinalStateAfterExecution();
    const reportLines = runner.getUnfinishedReportLines(finalState.status, finalState.message);

    assert.strictEqual(finalState.status, 'incomplete');
    assert.ok(finalState.message.includes('输出结果已通过二次校验，但目标条数仍未补齐'));
    assert.ok(finalState.message.includes('站点原始分页仅解析到 8 条'));
    assert.ok(finalState.message.includes('发现 2 条重复番号（AAA-001、AAA-002）'));
    assert.ok(reportLines.includes('# 任务状态：未完成'));
    assert.ok(reportLines.includes('# 已定位重复番号'));
    assert.ok(reportLines.includes('# 已定位未完成番号'));
    assert.ok(reportLines.some((line) => line.includes('AAA-001 | 出现 2 次')));
  });

  it('treats no-magnet policy skips as resolved instead of unfinished items', () => {
    const runner = new ScraperRunner();
    runner.config = {
      limit: 1,
      nomag: true,
      secondValidation: false
    };
    runner.expectedItemIds = new Set(['ABF-001']);
    runner.queuedItemIds = new Set(['ABF-001']);
    runner.processedItemIds = new Set(['ABF-001']);
    runner.skippedByPolicyItemIds = new Set(['ABF-001']);

    const finalState = runner.getFinalStateAfterExecution();

    assert.strictEqual(finalState.status, 'completed');
    assert.ok(finalState.message.includes('按当前配置跳过无磁力影片 1 条'));
    assert.deepStrictEqual(runner.getUncapturedItems(), []);
    assert.deepStrictEqual(runner.getProcessedButNotPersistedIds(), []);
  });

  it('clears policy-skip markers once the same film is later persisted successfully', () => {
    const runner = new ScraperRunner();
    runner.skippedByPolicyItemIds = new Set(['ABF-001', 'https://www.javbus.com/ABF-001']);

    runner.updatePersistedFilmState({
      title: 'ABF-001 title',
      sourceLink: 'https://www.javbus.com/ABF-001'
    });

    assert.deepStrictEqual(Array.from(runner.skippedByPolicyItemIds), []);
    assert.ok(runner.persistedFilmIds.has('ABF-001'));
  });

  it('includes duplicate-id diagnostics when a page sample collapses after dedupe', () => {
    const runner = new ScraperRunner();

    const diagnostic = runner.buildPageLinkDiagnosticReason(
      [
        'https://www.javbus.com/ABF-001',
        'https://www.javbus.com/ABF-001?dup=1',
        'https://www.javbus.com/ABF-002'
      ],
      ['https://www.javbus.com/ABF-001', 'https://www.javbus.com/ABF-002']
    );

    assert.ok(diagnostic.includes('ABF-001'));
    assert.ok(diagnostic.includes('3'));
    assert.ok(diagnostic.includes('2'));
  });

  it('terminates queues and active requests when stop is called', async () => {
    const runner = new ScraperRunner();
    let queueShutdownCalled = false;
    let requestCloseCalled = false;

    runner.isRunning = true;
    runner.emitState = () => undefined;
    runner.emitLog = () => undefined;
    runner.persistTaskState = () => undefined;
    runner.queueManager = {
      shutdown: async () => {
        queueShutdownCalled = true;
      }
    };
    runner.requestHandler = {
      close: async () => {
        requestCloseCalled = true;
      }
    };

    await runner.stop();

    assert.strictEqual(runner.isStopping, true);
    assert.strictEqual(queueShutdownCalled, true);
    assert.strictEqual(requestCloseCalled, true);
  });

  it('marks the task completed after recovery fills all expected items', () => {
    const runner = new ScraperRunner();
    runner.config = {
      limit: 2,
      secondValidation: true,
      useCloudflareBypass: true
    };
    runner.expectedItemIds = new Set(['SONE-001', 'SONE-002']);
    runner.queuedItemIds = new Set(['SONE-001', 'SONE-002']);
    runner.processedItemIds = new Set(['SONE-001', 'SONE-002']);
    runner.persistedItemIds = new Set(['SONE-001', 'SONE-002']);
    runner.persistedFilmIds = new Set(['SONE-001', 'SONE-002']);
    runner.filmCount = 2;
    runner.validationReport = { passed: true };

    const finalState = runner.getFinalStateAfterExecution();

    assert.strictEqual(finalState.status, 'completed');
    assert.ok(finalState.message.includes('已二次校验完成'));
  });
});
