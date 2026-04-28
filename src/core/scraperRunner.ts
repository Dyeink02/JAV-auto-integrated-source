// @ts-nocheck
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCrawler = runCrawler;
/**
 * ScraperRunner coordinates the end-to-end crawl lifecycle.
 * The heavy pure helpers are split into focused modules so this file stays orchestration-first.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const config_1 = __importDefault(require("./config"));
const logger_1 = __importStar(require("./logger"));
const queueManager_1 = __importStar(require("./queueManager"));
const parser_1 = __importDefault(require("./parser"));
const requestHandler_1 = __importDefault(require("./requestHandler"));
const runStateMachine_1 = __importDefault(require("./runStateMachine"));
const constants_1 = require("./constants");
const filmIdentity_1 = require("./filmIdentity");
const delayManager_1 = require("../utils/delayManager");
const systemProxy_1 = require("../utils/systemProxy");
const resultValidator_1 = __importDefault(require("./resultValidator"));
const taskStateManager_1 = __importDefault(require("./taskStateManager"));
const scraperRunnerIndexUtils_1 = require("./scraperRunnerIndexUtils");
const scraperRunnerRecoveryUtils_1 = require("./scraperRunnerRecoveryUtils");
const scraperRunnerQueueUtils_1 = require("./scraperRunnerQueueUtils");
const scraperRunnerSnapshotUtils_1 = require("./scraperRunnerSnapshotUtils");
const scraperRunnerStateUtils_1 = require("./scraperRunnerStateUtils");
const scraperRunnerFinalStateUtils_1 = require("./scraperRunnerFinalStateUtils");
const scraperRunnerPersistenceUtils_1 = require("./scraperRunnerPersistenceUtils");
const outputRuntimeUtils_1 = require("./outputRuntimeUtils");
const scraperRunnerRecoveryPipelineUtils_1 = require("./scraperRunnerRecoveryPipelineUtils");
const APP_VERSION = '0.23';
class ScraperRunner extends events_1.EventEmitter {
    constructor(options = {}) {
        super();
        this.config = null;
        this.pageIndex = 1;
        this.filmCount = 0;
        this.filmsQueued = 0;
        this.filmsAttempted = 0;
        this.expectedItemsPerPage = null;
        this.indexPageRetryLimit = 3;
        this.strictIndexPageRetryLimit = 5;
        this.detailRecoveryRetryLimit = 4;
        this.pageGapRecoveryRetryLimit = 2;
        this.detailQueueHighWaterMark = 40;
        this.detailQueueLowWaterMark = 16;
        this.detailQueueBatchSize = 12;
        this.multibar = null;
        this.progressBar = null;
        this.requestHandler = null;
        this.queueManager = null;
        this.isRunning = false;
        this.isStopping = false;
        this.unsubscribeLogger = null;
        this.signalHandlers = [];
        this.queuedDetailLinks = new Set();
        this.queuedFilmIds = new Set();
        this.expectedItemIds = new Set();
        this.queuedItemIds = new Set();
        this.attemptedItemIds = new Set();
        this.processedItemIds = new Set();
        this.persistedItemIds = new Set();
        this.skippedByPolicyItemIds = new Set();
        this.expectedItemLinkMap = new Map();
        this.expectedDetailLinks = new Set();
        this.expectedDetailLinkKeys = new Set();
        this.expectedItemVariantLinks = new Map();
        this.duplicateExpectedIds = new Set();
        this.attemptedDetailLinks = new Set();
        this.processedDetailLinks = new Set();
        this.persistedDetailLinks = new Set();
        this.persistedFilmIds = new Set();
        this.pageAudits = [];
        this.validationReport = null;
        this.taskStateManager = null;
        this.failedDetailMap = new Map();
        this.pendingRunningTaskMap = new Map();
        this.detailRecoveryAttemptMap = new Map();
        this.activeDetailItems = new Map();
        this.activeIndexItem = '';
        this.recentCompletedItems = [];
        this.recentQueuedItems = [];
        this.startedAt = '';
        this.executionStartTime = 0;
        this.stateMutationCount = 0;
        this.lastStateMessage = '';
        this.statePersistThreshold = 5;
        this.statePersistMinIntervalMs = 1500;
        this.lastStatePersistAt = 0;
        this.statePreviewLimit = 80;
        this.prefetchedIndexPage = null;
        this.shouldStopIndexing = false;
        this.indexPage404ConsecutiveCount = 0;
        this.indexPage404EarlyStopThreshold = 2;
        this.currentExecutionPhase = 'idle';
        this.indexDiscoverySummaryLogged = false;
        this.options = options;
    }
    /**
     * 单次完整运行入口。
     * 这里统一处理初始化、执行、异常收口与资源释放，避免桌面端重复拼装流程。
     */
    async run() {
        if (this.isRunning) {
            throw new Error('抓取任务已在运行中。');
        }
        this.resetRuntimeState();
        this.startedAt = new Date().toISOString();
        this.isRunning = true;
        this.emitState('starting', '正在准备抓取配置...');
        this.attachLogger();
        await this.initialize();
        this.loadPersistedOutputState();
        this.restoreTaskStateSnapshot();
        this.attachSignalHandlers();
        this.persistTaskState('初始化完成', 'starting', '正在准备抓取配置...');
        try {
            this.emitState('running', '抓取任务正在运行。');
            await this.mainExecution();
            if (this.isStopping) {
                const stoppedMessage = '抓取任务已终止。';
                this.logFailedDetailSummaryIfNeeded();
                this.finalizeOutputArtifacts('stopped', stoppedMessage);
                this.emitState('stopped', stoppedMessage, this.getStats());
                this.persistTaskState('任务已停止', 'stopped', stoppedMessage);
            }
            else {
                const finalState = this.getFinalStateAfterExecution();
                this.logFailedDetailSummaryIfNeeded();
                this.finalizeOutputArtifacts(finalState.status, finalState.message);
                this.emitState(finalState.status, finalState.message, this.getStats());
                this.persistTaskState(finalState.status === 'completed' ? '任务已完成' : '任务未完成', finalState.status, finalState.message);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.finalizeOutputArtifacts('error', message);
            this.emitState('error', message, this.getStats());
            this.persistTaskState('任务异常', 'error', message);
            throw error;
        }
        finally {
            await this.cleanup();
            this.detachSignalHandlers();
            this.detachLogger();
            this.isRunning = false;
            this.isStopping = false;
        }
    }
    async stop() {
        if (!this.isRunning || this.isStopping) {
            return;
        }
        this.isStopping = true;
        this.emitState('stopping', '正在终止任务并中断当前进度...', this.getStats());
        this.emitLog('warn', '已发送终止指令，正在中断队列与请求...');
        this.persistTaskState('用户主动终止', 'stopping', '正在终止任务并中断当前进度...');
        if (this.queueManager) {
            if (typeof this.queueManager.getRunningTaskSummaries === 'function') {
                this.capturePendingRunningTasks(this.queueManager.getRunningTaskSummaries());
            }
            await this.queueManager.shutdown();
        }
        if (this.requestHandler) {
            await this.requestHandler.close();
        }
    }
    getConfig() {
        return this.config;
    }
    static async updateAntiBlockUrls(options = {}) {
        const configManager = new config_1.default();
        await configManager.updateFromOptions(options);
        const config = configManager.getConfig();
        const systemProxy = await (0, systemProxy_1.getSystemProxy)();
        if (systemProxy.enabled && systemProxy.server) {
            config.proxy = (0, systemProxy_1.parseProxyServer)(systemProxy.server);
        }
        const requestHandler = new requestHandler_1.default(config);
        try {
            const pageData = await requestHandler.getPage(config.base || config.BASE_URL);
            const antiBlockUrls = parser_1.default.extractAntiBlockUrls(pageData?.body || '');
            const homeDir = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || process.cwd();
            const antiBlockFile = path_1.default.join(homeDir, '.jav-scrapy-antiblock-urls.json');
            let existingUrls = [];
            if (fs_1.default.existsSync(antiBlockFile)) {
                const data = JSON.parse(fs_1.default.readFileSync(antiBlockFile, 'utf8'));
                if (Array.isArray(data)) {
                    existingUrls = data.filter((item) => typeof item === 'string');
                }
            }
            const merged = Array.from(new Set([...existingUrls, ...antiBlockUrls]));
            fs_1.default.writeFileSync(antiBlockFile, JSON.stringify(merged, null, 2), 'utf8');
            return {
                antiBlockUrls: merged,
                filePath: antiBlockFile
            };
        }
        finally {
            await requestHandler.close();
        }
    }
    resetRuntimeState() {
        // 每次新任务都从干净状态启动，避免断点续爬与上一轮运行态交叉污染。
        delayManager_1.delayManager.reset();
        this.isStopping = false;
        this.pageIndex = 1;
        this.filmCount = 0;
        this.filmsQueued = 0;
        this.filmsAttempted = 0;
        this.expectedItemsPerPage = null;
        this.queuedDetailLinks.clear();
        this.queuedFilmIds.clear();
        this.expectedItemIds.clear();
        this.queuedItemIds.clear();
        this.attemptedItemIds.clear();
        this.processedItemIds.clear();
        this.persistedItemIds.clear();
        this.skippedByPolicyItemIds.clear();
        this.expectedItemLinkMap.clear();
        this.expectedDetailLinks.clear();
        this.expectedDetailLinkKeys.clear();
        this.expectedItemVariantLinks.clear();
        this.duplicateExpectedIds.clear();
        this.attemptedDetailLinks.clear();
        this.processedDetailLinks.clear();
        this.persistedDetailLinks.clear();
        this.persistedFilmIds.clear();
        this.pageAudits = [];
        this.validationReport = null;
        this.taskStateManager = null;
        this.failedDetailMap.clear();
        this.pendingRunningTaskMap.clear();
        this.detailRecoveryAttemptMap.clear();
        this.activeDetailItems.clear();
        this.activeIndexItem = '';
        this.recentCompletedItems = [];
        this.recentQueuedItems = [];
        this.executionStartTime = 0;
        this.stateMutationCount = 0;
        this.lastStateMessage = '';
        this.lastStatePersistAt = 0;
        this.prefetchedIndexPage = null;
        this.shouldStopIndexing = false;
        this.indexPage404ConsecutiveCount = 0;
        this.currentExecutionPhase = 'idle';
        this.indexDiscoverySummaryLogged = false;
    }
    async initialize() {
        const configManager = new config_1.default();
        await configManager.updateFromOptions(this.options);
        this.config = configManager.getConfig();
        if (!this.options.outputResolved) {
            const outputResolution = (0, outputRuntimeUtils_1.resolveRunOutputDirectory)({
                outputDir: this.config.output,
                resumeExisting: Boolean(this.options.resumeExisting)
            });
            this.config.output = outputResolution.outputDir;
            if (outputResolution.createdRunDir) {
                this.logInfo(`检测到输出目录已有历史结果，本次任务已自动切换到独立输出目录：${outputResolution.outputDir}`);
            }
        }
        this.requestHandler = new requestHandler_1.default(this.config);
        this.taskStateManager = new taskStateManager_1.default(this.config.output);
        this.expectedItemsPerPage =
            this.config.itemsPerPage && this.config.itemsPerPage > 0 ? this.config.itemsPerPage : null;
        this.detailQueueHighWaterMark = this.getDetailQueueHighWaterMark();
        this.detailQueueLowWaterMark = this.getDetailQueueLowWaterMark();
        this.detailQueueBatchSize = this.getDetailQueueBatchSize();
        this.statePersistThreshold = this.getStatePersistThreshold();
        this.statePersistMinIntervalMs = this.getStatePersistMinIntervalMs();
        if (this.options.useProgressBars && this.config.limit > 0) {
            const cliProgress = require('cli-progress');
            this.multibar = new cliProgress.MultiBar({
                format: 'Progress |{bar}| {percentage}% | {value}/{total}',
                barCompleteChar: '#',
                barIncompleteChar: '-',
                hideCursor: true
            }, cliProgress.Presets.shades_classic);
            this.progressBar = this.multibar.create(this.config.limit, 0);
        }
    }
    async mainExecution() {
        if (!this.config || !this.requestHandler) {
            throw new Error('抓取器尚未初始化完成。');
        }
        const stateMachine = new runStateMachine_1.default({
            initialState: 'boot',
            states: this.buildExecutionStates(),
            onTransition: async (transition) => this.handleExecutionPhaseTransition(transition),
            onFinished: async () => {
                this.currentExecutionPhase = 'finished';
            }
        });
        await stateMachine.run();
        if (!this.isStopping) {
            this.logExecutionCompletion();
        }
    }
    buildExecutionStates() {
        return [
            {
                key: 'boot',
                label: '启动抓取流程',
                execute: async () => this.runExecutionBootPhase(),
                next: 'queue_setup'
            },
            {
                key: 'queue_setup',
                label: '初始化任务队列',
                execute: async () => this.setupQueueManager(),
                next: 'resume_pending'
            },
            {
                key: 'resume_pending',
                label: '恢复未完成详情任务',
                execute: async () => this.resumePendingDetailLinks(this.getQueueManagerOrThrow()),
                shouldSkip: () => this.isStopping,
                next: 'index_discovery'
            },
            {
                key: 'index_discovery',
                label: '抓取索引页',
                execute: async () => this.runIndexDiscoveryLoop(this.getQueueManagerOrThrow()),
                shouldSkip: () => this.isStopping,
                next: 'queue_drain'
            },
            {
                key: 'queue_drain',
                label: '等待工作队列排空',
                execute: async () => this.waitForWorkQueuesToDrain(this.getQueueManagerOrThrow(), '索引页抓取结束，等待工作队列处理完成...'),
                next: () => this.resolveNextExecutionPhase('page_gap_recovery')
            },
            {
                key: 'page_gap_recovery',
                label: '分页缺口补查',
                execute: async () => this.recoverPageGaps(this.getQueueManagerOrThrow()),
                next: () => this.resolveNextExecutionPhase('queue_gap_recovery')
            },
            {
                key: 'queue_gap_recovery',
                label: '入队缺口补齐',
                execute: async () => this.recoverExpectedQueueGaps(this.getQueueManagerOrThrow()),
                next: () => this.resolveNextExecutionPhase('detail_recovery')
            },
            {
                key: 'detail_recovery',
                label: '失败详情补爬',
                execute: async () => this.recoverMissingDetailPages(this.getQueueManagerOrThrow()),
                next: () => this.resolveNextExecutionPhase('second_validation')
            },
            {
                key: 'second_validation',
                label: '结果二次校验',
                execute: async () => this.runSecondValidationIfNeeded(),
                shouldSkip: () => this.isStopping || !this.config?.secondValidation,
                next: 'final_drain'
            },
            {
                key: 'final_drain',
                label: '刷新收尾输出',
                execute: async () => this.runFinalDrain(this.getQueueManagerOrThrow()),
                next: null
            }
        ];
    }
    async handleExecutionPhaseTransition(transition) {
        if (transition.to === 'finished') {
            this.currentExecutionPhase = 'finished';
            return;
        }
        this.currentExecutionPhase = transition.to;
        if (transition.skipped) {
            this.logDebug(`运行阶段跳过：${transition.label}`);
            return;
        }
        this.logInfo(`运行阶段切换：${transition.label}`);
        this.emitState('running', `当前阶段：${transition.label}。`, this.getStats());
    }
    async runExecutionBootPhase() {
        this.executionStartTime = Date.now();
        this.shouldStopIndexing = false;
        this.logInfo('开始执行 JAV 抓取任务...');
        this.logInfo(`本次运行配置: ${JSON.stringify(this.config, null, 2)}`);
        this.logInfo(`当前运行方案：${this.getRuntimeSchemeLabel()}。索引页队列、快速 HTTP 磁力队列、Cloudflare 补抓队列已启用。`);
        if (this.isLargeTaskMode()) {
            this.logInfo(`已启用大任务稳态模式：详情队列阈值 ${this.detailQueueHighWaterMark}，批量入队 ${this.detailQueueBatchSize}，状态落盘阈值 ${this.statePersistThreshold}。`);
        }
    }
    async setupQueueManager() {
        if (!this.config) {
            throw new Error('配置尚未准备完成。');
        }
        const queueManager = new queueManager_1.default(this.config);
        this.queueManager = queueManager;
        queueManager.getFileHandler().cleanupLegacyOutputArtifacts();
        this.registerQueueManagerHandlers(queueManager);
        this.registerQueueErrorHandlers(queueManager);
    }
    registerQueueManagerHandlers(queueManager) {
        queueManager.on(queueManager_1.QueueEventType.DETAIL_PAGE_START, (event) => {
            if (!event.data || !('link' in event.data)) {
                return;
            }
            const item = this.extractFilmId(event.data.link) || event.data.link;
            this.activeDetailItems.set(event.data.link, item);
            this.attemptedDetailLinks.add(event.data.link);
            this.attemptedItemIds.add(this.getDetailItemId(event.data.link));
            this.filmsAttempted += 1;
            if (this.shouldLogProgressMilestone(this.filmsAttempted)) {
                this.logInfo(`详情抓取进度：已尝试 ${this.filmsAttempted} 条，已完成 ${this.filmCount} 条，当前处理 ${item}。`);
            }
            this.emitState('running', `正在抓取详情页：${item}，已尝试 ${this.filmsAttempted} 条。`, this.getStats());
            this.markStateDirty('详情页开始');
        });
        queueManager.on(queueManager_1.QueueEventType.DETAIL_PAGE_PROCESSED, (event) => {
            if (!this.config || !event.data || !('filmData' in event.data)) {
                return;
            }
            if ('sourceLink' in event.data && typeof event.data.sourceLink === 'string') {
                this.processedDetailLinks.add(event.data.sourceLink);
                this.processedItemIds.add(this.getDetailItemId(event.data.sourceLink));
                this.failedDetailMap.delete(event.data.sourceLink);
                this.activeDetailItems.delete(event.data.sourceLink);
            }
            const shouldPersist = this.shouldPersistFilm(event.data.filmData);
            if (!shouldPersist) {
                this.markItemSkippedByPolicy(event.data.sourceLink || event.data.filmData.sourceLink || event.data.filmData.title || '');
                this.logInfo(`已跳过无磁力影片: ${event.data.filmData.title}`);
                this.markStateDirty('跳过无磁力影片');
                return;
            }
            if ('metadata' in event.data) {
                queueManager.getFileWriteQueue().push(event.data.filmData);
                if (!this.config.nopic) {
                    queueManager.getImageDownloadQueue().push(event.data.metadata);
                }
            }
            this.emitState('running', '正在保存抓取结果。', this.getStats());
            this.markStateDirty('详情页已处理');
        });
        queueManager.on(queueManager_1.QueueEventType.DETAIL_PAGE_FAILED, (event) => {
            if (!event.data || typeof event.data.link !== 'string') {
                return;
            }
            const item = this.extractFilmId(event.data.link) || event.data.link;
            const failurePolicy = this.classifyDetailFailure(String(event.data.reason || '详情页处理失败'));
            const previousRecord = this.failedDetailMap.get(event.data.link);
            const retryCount = (previousRecord?.retryCount || 0) + 1;
            this.activeDetailItems.delete(event.data.link);
            this.failedDetailMap.set(event.data.link, {
                item,
                sourceLink: event.data.link,
                reason: `${failurePolicy.label} · 第 ${retryCount} 次失败 · ${String(event.data.reason || '详情页处理失败')}`,
                category: failurePolicy.label,
                retryCount,
                retryAdvice: failurePolicy.advice,
                recoverable: failurePolicy.maxRetries > retryCount,
                lastFailedAt: new Date().toISOString()
            });
            this.emitState('running', '存在详情页抓取失败项目，请查看失败原因面板。', this.getStats());
            this.markStateDirty('详情页失败');
        });
        queueManager.on(queueManager_1.QueueEventType.FILM_DATA_SAVED, (event) => {
            if (!event.data || !('filmData' in event.data)) {
                return;
            }
            this.updatePersistedFilmState(event.data.filmData);
            this.filmCount = Math.max(this.filmCount, this.persistedFilmIds.size || this.persistedDetailLinks.size);
            if (this.progressBar && this.config && this.config.limit > 0) {
                this.progressBar.update(Math.min(this.filmCount, this.config.limit));
            }
            if (this.config && this.config.limit > 0 && this.filmCount >= this.config.limit) {
                this.shouldStopIndexing = true;
                queueManager.getIndexPageQueue().kill();
            }
            if (this.shouldEmitProgressState(this.filmCount)) {
                this.emitState('running', `结果已写入，当前已完成 ${this.filmCount} 条。`, this.getStats());
            }
            this.markStateDirty('结果已写入');
        });
    }
    registerQueueErrorHandlers(queueManager) {
        queueManager.getDetailPageQueue().error(queueManager_1.default.createErrorHandler('detailPageQueue'));
        queueManager.getFileWriteQueue().error(queueManager_1.default.createErrorHandler('fileWriteQueue'));
        queueManager.getImageDownloadQueue().error(queueManager_1.default.createErrorHandler('imageDownloadQueue'));
    }
    async runIndexDiscoveryLoop(queueManager) {
        while (!this.shouldStopIndexing && !this.isStopping) {
            try {
                const currentUrl = this.getIndexPageUrl(this.pageIndex);
                const inferredTotalPages = this.getInferredTotalPages();
                const targetTotalPages = (this.config?.totalPages && this.config.totalPages > 0 ? this.config.totalPages : inferredTotalPages) || 0;
                const isLastTargetPage = targetTotalPages > 0 && this.pageIndex >= targetTotalPages;
                const expectedCount = this.getExpectedItemCountForPage(this.pageIndex, targetTotalPages);
                this.activeIndexItem = `索引页第 ${this.pageIndex} 页`;
                this.logInfo(`正在抓取索引页 ${this.pageIndex}: ${currentUrl}`);
                this.emitState('running', `正在抓取第 ${this.pageIndex} 页。`, this.getStats());
                const pageResult = await this.getIndexPageResult(queueManager, currentUrl, this.pageIndex, expectedCount, isLastTargetPage, 'initial');
                const links = pageResult.links;
                const trackedLinks = this.getTrackedPageLinks(links);
                this.updatePageAudit(pageResult.audit);
                this.recordExpectedPageLinks(this.pageIndex, trackedLinks);
                this.activeIndexItem = '';
                this.indexPage404ConsecutiveCount = 0;
                this.logInfo(`第 ${this.pageIndex} 页解析到 ${links.length} 个影片链接。`);
                if (pageResult.audit.confidence === 'low') {
                    this.logInfo(`第 ${this.pageIndex} 页分页可信度较低：${pageResult.audit.reason}`);
                }
                if (links.length === 0) {
                    const canContinueAfterGap = expectedCount !== null && targetTotalPages > 0 && this.pageIndex < targetTotalPages;
                    if (canContinueAfterGap) {
                        this.logInfo(`第 ${this.pageIndex} 页当前未解析到影片链接，但目标共 ${targetTotalPages} 页。已记录为分页缺口，继续尝试后续页面。`);
                        this.pageIndex += 1;
                        this.persistTaskState('索引页存在分页缺口', 'running', `第 ${this.pageIndex - 1} 页当前未解析到影片链接，继续尝试后续页面。`);
                        continue;
                    }
                    this.shouldStopIndexing = true;
                    this.logInfo(`第 ${this.pageIndex} 页为空，停止继续抓取索引页。`);
                    this.persistTaskState('索引页为空，停止继续抓取', 'running', `第 ${this.pageIndex} 页为空，停止继续抓取索引页。`);
                    continue;
                }
                if (this.expectedItemsPerPage === null) {
                    this.expectedItemsPerPage = links.length;
                }
                const newLinks = trackedLinks.filter((link) => !this.isAlreadyPersisted(link) && !this.queuedDetailLinks.has(link));
                const skippedPersistedCount = trackedLinks.length - newLinks.length;
                if (skippedPersistedCount > 0) {
                    this.logInfo(`已跳过 ${skippedPersistedCount} 个已完成影片，仅补抓未完成内容。`);
                }
                if (trackedLinks.length > 0 && trackedLinks.length < links.length) {
                    this.logInfo(`当前为限量模式，本页仅追踪前 ${trackedLinks.length} 个链接，剩余 ${links.length - trackedLinks.length} 个链接不计入本次任务。`);
                }
                if (newLinks.length === 0) {
                    if (this.options.resumeExisting) {
                        this.logInfo(`第 ${this.pageIndex} 页均为已完成内容，继续检查后续页面是否存在漏抓项目。`);
                        this.pageIndex += 1;
                        this.persistTaskState('恢复模式继续检查下一页', 'running', '当前页均为已完成内容。');
                        continue;
                    }
                    this.logInfo(`第 ${this.pageIndex} 页没有新链接，停止继续抓取索引页。`);
                    this.shouldStopIndexing = true;
                    this.persistTaskState('索引页无新链接', 'running', `第 ${this.pageIndex} 页没有新链接。`);
                    continue;
                }
                if (this.config && this.config.limit > 0) {
                    const remaining = this.config.limit - this.filmsQueued;
                    if (remaining <= 0) {
                        this.shouldStopIndexing = true;
                        continue;
                    }
                    await this.enqueueDetailLinksInBatches(queueManager, newLinks.slice(0, remaining), true);
                }
                else {
                    await this.enqueueDetailLinksInBatches(queueManager, newLinks, true);
                }
                this.emitState('running', '详情页已加入处理队列。', this.getStats());
                if (this.config && this.config.limit > 0 && this.filmsQueued >= this.config.limit) {
                    this.shouldStopIndexing = true;
                }
                if (targetTotalPages > 0 && this.pageIndex >= targetTotalPages) {
                    this.shouldStopIndexing = true;
                    this.logInfo(`已到达配置或推算的最后一页：${targetTotalPages}。`);
                }
                if (!this.shouldStopIndexing && !this.isStopping) {
                    this.prefetchNextIndexPage(queueManager, this.pageIndex + 1, targetTotalPages, 'initial');
                }
                if (!this.shouldStopIndexing &&
                    this.expectedItemsPerPage !== null &&
                    !isLastTargetPage &&
                    links.length < this.expectedItemsPerPage) {
                    this.logInfo(`第 ${this.pageIndex} 页条数偏低（${links.length}/${this.expectedItemsPerPage}）。当前为普通模式，仅记录异常并继续尝试后续页面。`);
                }
                this.pageIndex += 1;
                this.persistTaskState('索引页处理完成', 'running', `第 ${this.pageIndex - 1} 页已处理完成。`);
                const randomDelayMs = this.getNextIndexPageDelayMs(queueManager);
                this.logInfo(`下一页抓取前等待 ${Math.round(randomDelayMs / 1000)} 秒...`);
                await new Promise((resolve) => setTimeout(resolve, randomDelayMs));
            }
            catch (error) {
                this.activeIndexItem = '';
                if (this.isStopping) {
                    break;
                }
                const message = error instanceof Error ? error.message : String(error);
                this.logInfo(`第 ${this.pageIndex} 页抓取失败: ${message}`);
                this.persistTaskState('索引页抓取失败', 'running', `第 ${this.pageIndex} 页抓取失败: ${message}`);
                if (message.includes('404')) {
                    this.indexPage404ConsecutiveCount += 1;
                    if (this.indexPage404ConsecutiveCount >= this.indexPage404EarlyStopThreshold) {
                        this.logInfo(`索引页第 ${this.pageIndex} 页连续 ${this.indexPage404ConsecutiveCount} 次返回 404（页面不存在），停止继续抓取索引页。`);
                        this.shouldStopIndexing = true;
                        this.persistTaskState('索引页404早停', 'running', `第 ${this.pageIndex} 页确认不存在，已自动停止。`);
                        continue;
                    }
                    const errorDelay = (0, constants_1.getRandomDelay)(5, 10);
                    await new Promise((resolve) => setTimeout(resolve, errorDelay));
                }
                else if (message.includes('ECONNRESET') || message.includes('ETIMEDOUT') || message.includes('ENOTFOUND')) {
                    this.indexPage404ConsecutiveCount = 0;
                    const backoffDelay = (0, constants_1.getExponentialBackoffDelay)(10000, 1, 30000);
                    this.logInfo(`检测到网络异常，将在 ${Math.round(backoffDelay / 1000)} 秒后重试...`);
                    await new Promise((resolve) => setTimeout(resolve, backoffDelay));
                }
                else {
                    this.indexPage404ConsecutiveCount = 0;
                    const errorDelay = (0, constants_1.getRandomDelay)(5, 10);
                    await new Promise((resolve) => setTimeout(resolve, errorDelay));
                }
            }
        }
        if (!this.isStopping) {
            this.logIndexDiscoverySummary();
        }
    }
    async waitForWorkQueuesToDrain(queueManager, message) {
        this.logInfo(message);
        while (!queueManager.areWorkQueuesFinished() && !this.isStopping) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await queueManager.flushOutputs();
    }
    async runFinalDrain(queueManager) {
        await queueManager.waitForDelays();
        await queueManager.flushOutputs();
    }
    resolveNextExecutionPhase(nextPhase) {
        return this.isStopping ? 'final_drain' : nextPhase;
    }
    getQueueManagerOrThrow() {
        if (!this.queueManager) {
            throw new Error('任务队列尚未初始化。');
        }
        return this.queueManager;
    }
    logExecutionCompletion() {
        const totalExecutionTime = Math.round((Date.now() - this.executionStartTime) / 1000);
        this.logInfo(`抓取任务完成，总耗时 ${totalExecutionTime} 秒。`);
    }
    getIndexPageUrl(pageNumber) {
        if (!this.config) {
            throw new Error('配置尚未准备完成。');
        }
        return (0, scraperRunnerIndexUtils_1.buildIndexPageUrl)(this.config, pageNumber);
    }
    async getIndexPageResult(queueManager, url, pageNumber, expectedCount, isLastTargetPage, phase) {
        if (this.prefetchedIndexPage &&
            this.prefetchedIndexPage.pageNumber === pageNumber &&
            this.prefetchedIndexPage.url === url &&
            this.prefetchedIndexPage.expectedCount === expectedCount &&
            this.prefetchedIndexPage.isLastTargetPage === isLastTargetPage &&
            this.prefetchedIndexPage.phase === phase) {
            const prefetched = this.prefetchedIndexPage;
            this.prefetchedIndexPage = null;
            return prefetched.promise;
        }
        return this.fetchValidatedPageLinks(queueManager, url, pageNumber, expectedCount, isLastTargetPage, phase);
    }
    prefetchNextIndexPage(queueManager, pageNumber, targetTotalPages, phase) {
        if (this.isStopping) {
            return;
        }
        if (targetTotalPages > 0 && pageNumber > targetTotalPages) {
            return;
        }
        const url = this.getIndexPageUrl(pageNumber);
        const expectedCount = this.getExpectedItemCountForPage(pageNumber, targetTotalPages);
        const isLastTargetPage = targetTotalPages > 0 && pageNumber >= targetTotalPages;
        if (this.prefetchedIndexPage &&
            this.prefetchedIndexPage.pageNumber === pageNumber &&
            this.prefetchedIndexPage.url === url &&
            this.prefetchedIndexPage.expectedCount === expectedCount &&
            this.prefetchedIndexPage.isLastTargetPage === isLastTargetPage &&
            this.prefetchedIndexPage.phase === phase) {
            return;
        }
        const promise = this.fetchValidatedPageLinks(queueManager, url, pageNumber, expectedCount, isLastTargetPage, phase)
            .catch((error) => {
            if (this.prefetchedIndexPage &&
                this.prefetchedIndexPage.pageNumber === pageNumber &&
                this.prefetchedIndexPage.url === url) {
                this.prefetchedIndexPage = null;
            }
            throw error;
        });
        this.prefetchedIndexPage = {
            pageNumber,
            url,
            expectedCount,
            isLastTargetPage,
            phase,
            promise
        };
    }
    async fetchValidatedPageLinks(queueManager, url, pageNumber, expectedCount, isLastTargetPage, phase = 'initial') {
        let bestLinks = [];
        let attemptsUsed = 0;
        let stoppedEarly = false;
        let bestDiagnosticReason = '';
        let retryTracker = (0, scraperRunnerRecoveryPipelineUtils_1.createPageLockRetryTracker)();
        const strictPageLock = this.shouldEnforceExactPageValidation(expectedCount);
        const maxAttempts = strictPageLock
            ? this.getStrictIndexPageRetryLimit(phase)
            : this.indexPageRetryLimit;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            attemptsUsed = attempt;
            const links = await queueManager.fetchIndexPageLinks(url);
            const previousBestCount = bestLinks.length;
            const mergedLinks = this.mergePageLinks(bestLinks, links);
            const diagnosticReason = this.buildPageLinkDiagnosticReason(links, mergedLinks);
            if (mergedLinks.length > bestLinks.length) {
                bestLinks = mergedLinks;
                if (diagnosticReason) {
                    bestDiagnosticReason = diagnosticReason;
                }
            }
            else if (!bestDiagnosticReason && diagnosticReason) {
                bestDiagnosticReason = diagnosticReason;
            }
            const meetsExpectation = expectedCount === null ||
                (!strictPageLock && isLastTargetPage) ||
                bestLinks.length >= expectedCount;
            if (meetsExpectation) {
                return {
                    links: bestLinks,
                    audit: this.createPageAudit(pageNumber, url, expectedCount, bestLinks.length, attempt, true, isLastTargetPage, bestDiagnosticReason || diagnosticReason),
                    diagnosticReason: bestDiagnosticReason || diagnosticReason
                };
            }
            const retryEvaluation = (0, scraperRunnerRecoveryPipelineUtils_1.evaluatePageValidationRetry)({
                tracker: retryTracker,
                strictPageLock,
                expectedCount,
                pageNumber,
                attempt,
                maxAttempts,
                sampleCount: links.length,
                mergedCount: bestLinks.length,
                previousBestCount
            });
            retryTracker = retryEvaluation.tracker;
            this.logInfo(retryEvaluation.logMessage);
            if (retryEvaluation.shouldStopEarly) {
                stoppedEarly = true;
                this.logInfo(retryEvaluation.earlyStopMessage);
                break;
            }
            if (attempt < maxAttempts) {
                const retryDelay = strictPageLock
                    ? this.getStrictIndexPageRetryDelayMs(attempt, phase)
                    : 1500;
                await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
        }
        const exhaustedMessage = (0, scraperRunnerRecoveryPipelineUtils_1.buildPageValidationExhaustedMessage)({
            strictPageLock,
            expectedCount,
            pageNumber,
            attemptsUsed,
            maxAttempts,
            bestCount: bestLinks.length,
            stoppedEarly
        });
        if (exhaustedMessage) {
            this.logInfo(exhaustedMessage);
        }
        this.logInfo(`\u7B2C ${pageNumber} \u9875\u91CD\u8BD5\u540E\u4ECD\u672A\u8FBE\u5230\u9884\u671F\u6761\u6570\uFF0C\u4F7F\u7528\u672C\u8F6E\u6700\u4F73\u7ED3\u679C ${bestLinks.length} \u6761\u3002`);
        return {
            links: bestLinks,
            audit: this.createPageAudit(pageNumber, url, expectedCount, bestLinks.length, attemptsUsed, false, isLastTargetPage, bestDiagnosticReason),
            diagnosticReason: bestDiagnosticReason
        };
    }
    shouldEnforceExactPageValidation(expectedCount) {
        return Boolean(this.config && this.config.limit > 0 && expectedCount !== null && expectedCount > 0);
    }
    getStrictIndexPageRetryLimit(phase) {
        if (phase === 'initial') {
            return Math.min(this.strictIndexPageRetryLimit, this.isLargeTaskMode() ? 2 : 3);
        }
        return Math.min(this.strictIndexPageRetryLimit, this.isLargeTaskMode() ? 3 : 4);
    }
    getStrictIndexPageRetryDelayMs(attempt, phase) {
        if (phase === 'initial') {
            return Math.min(2200, 600 + attempt * 450);
        }
        return Math.min(4200, 1200 + attempt * 700);
    }
    mergePageLinks(existingLinks, incomingLinks) {
        return (0, scraperRunnerIndexUtils_1.mergePageLinks)(existingLinks, incomingLinks, (link) => this.getPageLinkIdentity(link));
    }
    getPageLinkIdentity(link) {
        return this.getDetailItemId(link);
    }
    buildPageLinkDiagnosticReason(links, mergedLinks) {
        const analysis = (0, scraperRunnerIndexUtils_1.analyzePageLinkDuplicates)(links, (link) => this.getPageLinkIdentity(link));
        if (analysis.duplicateIds.length === 0) {
            return '';
        }
        const preview = analysis.duplicateIds.slice(0, 6).join('、');
        return `本次页面样本共 ${links.length} 条，按番号去重后为 ${analysis.uniqueCount} 条；疑似重复番号：${preview}${analysis.duplicateIds.length > 6 ? ' 等' : ''}。当前合并后共 ${mergedLinks.length} 条。`;
    }
    appendPageAuditReason(baseReason, diagnosticReason) {
        const normalizedDiagnostic = String(diagnosticReason || '').trim();
        if (!normalizedDiagnostic) {
            return baseReason;
        }
        return `${baseReason} ${normalizedDiagnostic}`;
    }
    normalizeDetailLink(link) {
        return (0, scraperRunnerIndexUtils_1.normalizeDetailLink)(link);
    }
    getDetailItemId(value) {
        return (0, scraperRunnerIndexUtils_1.getDetailItemId)(value, (candidate) => this.extractFilmId(candidate));
    }
    rememberExpectedDetailLink(link) {
        const rawLink = String(link || '').trim();
        if (!rawLink) {
            return;
        }
        const normalizedLink = this.normalizeDetailLink(rawLink);
        if (normalizedLink && !this.expectedDetailLinkKeys.has(normalizedLink)) {
            this.expectedDetailLinkKeys.add(normalizedLink);
            this.expectedDetailLinks.add(rawLink);
        }
        const itemId = this.getDetailItemId(rawLink);
        const variants = this.expectedItemVariantLinks.get(itemId) || new Set();
        variants.add(rawLink);
        this.expectedItemVariantLinks.set(itemId, variants);
    }
    recordExpectedPageLinks(pageNumber, links) {
        if (links.length === 0) {
            return;
        }
        const duplicateIds = [];
        for (const link of links) {
            this.rememberExpectedDetailLink(link);
            const itemId = this.getDetailItemId(link);
            if (this.expectedItemIds.has(itemId)) {
                this.duplicateExpectedIds.add(itemId);
                duplicateIds.push(itemId);
                continue;
            }
            this.expectedItemIds.add(itemId);
            this.expectedItemLinkMap.set(itemId, link);
        }
        if (duplicateIds.length > 0) {
            const duplicatePreview = Array.from(new Set(duplicateIds))
                .sort((left, right) => left.localeCompare(right, 'zh-CN'))
                .slice(0, 6)
                .join('、');
            this.logInfo(`第 ${pageNumber} 页发现 ${duplicateIds.length} 个重复编号${duplicatePreview ? `：${duplicatePreview}` : ''}，已自动合并到全量对账集合。`);
        }
    }
    getExpectedEntryCount() {
        return this.expectedDetailLinks.size > 0 ? this.expectedDetailLinks.size : this.expectedItemIds.size;
    }
    getRawDuplicateGroups() {
        return Array.from(this.expectedItemVariantLinks.entries())
            .map(([itemId, links]) => ({
            itemId,
            links: Array.from(links).sort((left, right) => left.localeCompare(right, 'zh-CN'))
        }))
            .filter((group) => group.links.length > 1)
            .sort((left, right) => left.itemId.localeCompare(right.itemId, 'zh-CN'));
    }
    getRawDuplicateEntryCount() {
        return this.getRawDuplicateGroups().reduce((total, group) => total + group.links.length - 1, 0);
    }
    buildRawDuplicateSummary(groups, limit = 4) {
        return (0, scraperRunnerStateUtils_1.buildRawDuplicateSummary)(groups, limit);
    }
    buildRawDuplicateReportLines(groups) {
        return (0, scraperRunnerStateUtils_1.buildRawDuplicateReportLines)(groups);
    }
    getDuplicateItemIds() {
        return (0, scraperRunnerStateUtils_1.buildRawDuplicateItemIds)(this.getRawDuplicateGroups());
    }
    getDuplicateItemIdsPreview(limit = this.statePreviewLimit) {
        return this.getDuplicateItemIds().slice(0, limit);
    }
    buildDuplicateItemSummary(limit = 6) {
        return this.buildRawDuplicateSummary(this.getRawDuplicateGroups(), limit);
    }
    classifyDetailFailure(reason) {
        return (0, scraperRunnerRecoveryUtils_1.classifyDetailFailure)(reason);
    }
    getRecoverableMissingDetailLinks(links) {
        return (0, scraperRunnerRecoveryUtils_1.getRecoverableMissingDetailLinks)({
            links,
            failedDetailMap: this.failedDetailMap,
            detailRecoveryAttemptMap: this.detailRecoveryAttemptMap,
            getPolicy: (reason) => this.classifyDetailFailure(reason),
            getRecoveryBudget: (policy) => this.getDetailRecoveryBudget(policy)
        });
    }
    getDetailRecoveryBudget(policy) {
        return (0, scraperRunnerRecoveryUtils_1.getDetailRecoveryBudget)(policy, this.isLargeTaskMode());
    }
    buildRecoveryCategorySummary(links) {
        return (0, scraperRunnerRecoveryUtils_1.buildRecoveryCategorySummary)(links, (link) => this.failedDetailMap.get(link)?.reason || '');
    }
    getConfiguredTargetEntryCount() {
        if (!this.config) {
            return 0;
        }
        if (this.config.limit > 0) {
            return this.config.limit;
        }
        return 0;
    }
    // Limit mode should reconcile only the records that belong to this run's target window.
    getTrackedPageLinks(links) {
        return (0, scraperRunnerIndexUtils_1.getTrackedPageLinks)(links, this.config?.limit || 0, this.expectedItemIds.size);
    }
    getExpectedButNotQueuedIds() {
        return (0, scraperRunnerQueueUtils_1.getExpectedButNotQueuedIds)({
            expectedItemIds: this.expectedItemIds,
            queuedItemIds: this.queuedItemIds,
            persistedItemIds: this.persistedItemIds
        });
    }
    getExpectedButNotQueuedLinks() {
        return (0, scraperRunnerQueueUtils_1.getExpectedButNotQueuedLinks)({
            expectedItemIds: this.expectedItemIds,
            queuedItemIds: this.queuedItemIds,
            persistedItemIds: this.persistedItemIds,
            expectedItemLinkMap: this.expectedItemLinkMap
        });
    }
    getExpectedButNotPersistedIds() {
        return (0, scraperRunnerQueueUtils_1.getExpectedButNotPersistedIds)({
            expectedItemIds: this.expectedItemIds,
            queuedItemIds: this.queuedItemIds,
            persistedItemIds: this.persistedItemIds,
            skippedItemIds: this.skippedByPolicyItemIds
        });
    }
    getProcessedButNotPersistedIds() {
        return (0, scraperRunnerQueueUtils_1.getProcessedButNotPersistedIds)({
            processedItemIds: this.processedItemIds,
            persistedItemIds: this.persistedItemIds,
            skippedItemIds: this.skippedByPolicyItemIds
        });
    }
    buildReconciliation() {
        return (0, scraperRunnerQueueUtils_1.buildReconciliation)({
            expectedItemIds: this.expectedItemIds,
            queuedItemIds: this.queuedItemIds,
            processedItemIds: this.processedItemIds,
            persistedItemIds: this.persistedItemIds,
            skippedItemIds: this.skippedByPolicyItemIds,
            duplicateExpectedIds: this.duplicateExpectedIds,
            expectedEntryCount: this.getExpectedEntryCount(),
            rawDuplicateEntryCount: this.getRawDuplicateEntryCount(),
            rawDuplicateGroups: this.getRawDuplicateGroups()
        });
    }
    createPageAudit(pageNumber, url, expectedCount, actualCount, retryCount, validationPassed, isLastTargetPage, diagnosticReason = '') {
        let confidence = 'high';
        let confidenceScore = 100;
        let reason = '分页数量正常。';
        if (expectedCount === null) {
            confidenceScore = actualCount > 0 ? 88 : 18;
            reason = actualCount > 0 ? '首个样本页已成功解析。' : '页面未解析到有效影片链接。';
        }
        else {
            const ratio = expectedCount > 0 ? actualCount / expectedCount : 0;
            confidenceScore = Math.round(Math.max(0, Math.min(100, ratio * 100)));
            if (isLastTargetPage && actualCount > 0 && actualCount < expectedCount) {
                confidenceScore = Math.max(confidenceScore, 72);
            }
            if (!validationPassed && !isLastTargetPage) {
                confidenceScore -= 12;
            }
            if (retryCount > 1) {
                confidenceScore -= Math.min(20, (retryCount - 1) * 5);
            }
            confidenceScore = Math.max(0, Math.min(100, confidenceScore));
            if (validationPassed) {
                reason = actualCount >= expectedCount ? '达到预期条数。' : '作为最后一页接受当前条数。';
            }
            else if (isLastTargetPage && actualCount > 0) {
                reason = '最后一页条数偏少，但允许作为尾页结果。';
            }
            else if (expectedCount > 0 && actualCount >= Math.ceil(expectedCount * 0.7)) {
                reason = '条数略低于预期，已记录为中等可信度。';
            }
            else {
                reason = '条数明显偏低，疑似封控或页面未完整加载。';
            }
        }
        if (confidenceScore >= 85) {
            confidence = 'high';
        }
        else if (confidenceScore >= 60) {
            confidence = 'medium';
        }
        else {
            confidence = 'low';
        }
        return {
            pageNumber,
            url,
            expectedCount,
            actualCount,
            retryCount,
            validationPassed,
            confidenceScore,
            confidence,
            reason: this.appendPageAuditReason(`${reason} \u5206\u9875\u53ef\u4fe1\u5ea6 ${confidenceScore} \u5206\u3002`, diagnosticReason),
            updatedAt: new Date().toISOString()
        };
    }
    logIndexDiscoverySummary() {
        if (this.indexDiscoverySummaryLogged) {
            return;
        }
        const configuredTargetCount = this.getConfiguredTargetEntryCount();
        const rawEntryCount = this.getExpectedEntryCount();
        const rawDuplicateEntryCount = this.getRawDuplicateEntryCount();
        const expectedUniqueCount = this.expectedItemIds.size;
        const pageGapCount = this.getRecoverablePageAudits().length;
        const messages = [`索引页对账完成：站点原始条目 ${rawEntryCount} 条，唯一番号 ${expectedUniqueCount} 条`];
        if (configuredTargetCount > 0) {
            const rawShortfall = Math.max(configuredTargetCount - rawEntryCount, 0);
            const uniqueShortfall = Math.max(configuredTargetCount - expectedUniqueCount, 0);
            if (rawShortfall > 0) {
                messages.push(`当前站点原始分页较目标 ${configuredTargetCount} 条少 ${rawShortfall} 条`);
            }
            else if (uniqueShortfall > 0) {
                messages.push(`扣除重复番号后，当前唯一番号较目标 ${configuredTargetCount} 条少 ${uniqueShortfall} 条`);
            }
            else {
                messages.push(`当前索引页已覆盖目标 ${configuredTargetCount} 条`);
            }
        }
        if (rawDuplicateEntryCount > 0) {
            messages.push(`检测到重复番号 ${rawDuplicateEntryCount} 条（${this.buildDuplicateItemSummary(4)}）`);
        }
        if (pageGapCount > 0) {
            messages.push(`仍有 ${pageGapCount} 个分页缺口待补查`);
        }
        const summary = `${messages.join('，')}。`;
        this.logInfo(summary);
        this.persistTaskState('索引页对账完成', 'running', summary, false, 'light');
        this.indexDiscoverySummaryLogged = true;
    }
    updatePageAudit(audit) {
        const existingIndex = this.pageAudits.findIndex((item) => item.pageNumber === audit.pageNumber);
        if (existingIndex === -1) {
            this.pageAudits.push(audit);
        }
        else {
            this.pageAudits[existingIndex] = audit;
        }
    }
    getRecoverablePageAudits() {
        return (0, scraperRunnerRecoveryUtils_1.getRecoverablePageAudits)(this.pageAudits);
    }
    getInferredTotalPages() {
        if (!this.config || !this.expectedItemsPerPage || this.expectedItemsPerPage <= 0) {
            return 0;
        }
        if (this.config.limit > 0) {
            return Math.ceil(this.config.limit / this.expectedItemsPerPage);
        }
        return 0;
    }
    getExpectedItemCountForPage(currentPage, targetTotalPages) {
        return (0, scraperRunnerIndexUtils_1.getExpectedItemCountForPage)({
            currentPage,
            targetTotalPages,
            filmLimit: this.config?.limit || 0,
            expectedItemsPerPage: this.expectedItemsPerPage
        });
    }
    enqueueDetailLinks(queueManager, links, countAsQueued) {
        const tasks = [];
        for (const link of links) {
            const filmId = this.extractFilmId(link);
            const itemId = this.getDetailItemId(link);
            if (countAsQueued) {
                if (this.queuedItemIds.has(itemId)) {
                    continue;
                }
                this.queuedDetailLinks.add(link);
                this.queuedItemIds.add(itemId);
                if (filmId) {
                    this.queuedFilmIds.add(filmId);
                }
                this.pushPreviewItem(this.recentQueuedItems, itemId);
                this.filmsQueued += 1;
            }
            tasks.push({ link });
        }
        if (tasks.length > 0) {
            queueManager.getDetailPageQueue().push(tasks);
        }
    }
    async enqueueDetailLinksInBatches(queueManager, links, countAsQueued) {
        if (links.length === 0 || this.isStopping) {
            return;
        }
        let cursor = 0;
        let lastLoggedCursor = 0;
        const progressLogStep = this.getBatchProgressLogStep();
        while (cursor < links.length && !this.isStopping) {
            await this.waitForDetailQueueCapacity(queueManager, this.detailQueueHighWaterMark, this.detailQueueLowWaterMark);
            const stats = queueManager.getQueueStats();
            const currentBacklog = stats.detailPageQueue.waiting + stats.detailPageQueue.running;
            const availableCapacity = Math.max(this.detailQueueHighWaterMark - currentBacklog, 1);
            const nextBatchSize = Math.max(1, Math.min(this.detailQueueBatchSize, availableCapacity, links.length - cursor));
            const batch = links.slice(cursor, cursor + nextBatchSize);
            this.enqueueDetailLinks(queueManager, batch, countAsQueued);
            cursor += batch.length;
            if (links.length > this.detailQueueBatchSize &&
                (cursor === links.length || cursor - lastLoggedCursor >= progressLogStep)) {
                this.logInfo(`大任务分批入队中：已加入 ${cursor}/${links.length} 个详情页，当前队列阈值 ${this.detailQueueHighWaterMark}。`);
                lastLoggedCursor = cursor;
            }
        }
    }
    async waitForDetailQueueCapacity(queueManager, threshold, resumeThreshold = threshold) {
        while (!this.isStopping) {
            const stats = queueManager.getQueueStats();
            const backlog = stats.detailPageQueue.waiting + stats.detailPageQueue.running;
            if (backlog < threshold) {
                return;
            }
            this.emitState('running', '大任务抓取中，正在等待详情队列回落后继续入队。', this.getStats());
            while (!this.isStopping) {
                const nextStats = queueManager.getQueueStats();
                const nextBacklog = nextStats.detailPageQueue.waiting + nextStats.detailPageQueue.running;
                if (nextBacklog <= resumeThreshold) {
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
        }
    }
    getDetailQueueHighWaterMark() {
        const parallel = Math.max(this.config?.parallel || 1, 1);
        const multiplier = this.isLargeTaskMode() ? 18 : 12;
        const maxThreshold = this.isLargeTaskMode() ? 160 : 90;
        return Math.max(24, Math.min(maxThreshold, parallel * multiplier));
    }
    getDetailQueueLowWaterMark() {
        return Math.max(8, Math.floor(this.detailQueueHighWaterMark * (this.isLargeTaskMode() ? 0.55 : 0.4)));
    }
    getDetailQueueBatchSize() {
        const parallel = Math.max(this.config?.parallel || 1, 1);
        const multiplier = this.isLargeTaskMode() ? 6 : 4;
        const maxBatch = this.isLargeTaskMode() ? 48 : 24;
        const minBatch = this.isLargeTaskMode() ? 12 : 8;
        return Math.max(minBatch, Math.min(maxBatch, parallel * multiplier));
    }
    getStatePersistThreshold() {
        if (this.isLargeTaskMode()) {
            return 12;
        }
        const parallel = Math.max(this.config?.parallel || 1, 1);
        return Math.max(5, Math.min(8, parallel * 2));
    }
    getStatePersistMinIntervalMs() {
        return this.isLargeTaskMode() ? 3000 : 1500;
    }
    isLargeTaskMode() {
        const limit = this.config?.limit || 0;
        const totalPages = this.config?.totalPages || 0;
        return limit >= 180 || totalPages >= 8;
    }
    getProgressLogStep() {
        if (this.isLargeTaskMode()) {
            return 20;
        }
        const limit = this.config?.limit || 0;
        if (limit > 0 && limit <= 40) {
            return 5;
        }
        return 10;
    }
    shouldEmitProgressState(count) {
        if (count <= 3) {
            return true;
        }
        if (this.isLargeTaskMode()) {
            return count % 10 === 0;
        }
        return count % 5 === 0;
    }
    shouldLogProgressMilestone(count) {
        const step = this.getProgressLogStep();
        return count > 0 && (count === 1 || count % step === 0);
    }
    getBatchProgressLogStep() {
        return this.isLargeTaskMode()
            ? Math.max(this.detailQueueBatchSize * 3, 36)
            : Math.max(this.detailQueueBatchSize * 2, 16);
    }
    getNextIndexPageDelayMs(queueManager) {
        const baseDelaySeconds = this.config?.delay || 2;
        const baseDelayMs = (0, constants_1.getRandomDelay)(baseDelaySeconds, baseDelaySeconds + 2);
        const stats = queueManager.getQueueStats();
        const backlog = stats.detailPageQueue.waiting + stats.detailPageQueue.running;
        if (backlog >= this.detailQueueLowWaterMark) {
            return Math.max(0, Math.round(baseDelayMs * (this.isLargeTaskMode() ? 0.35 : 0.6)));
        }
        return baseDelayMs;
    }
    getMissingDetailLinks() {
        return Array.from(this.queuedDetailLinks).filter((link) => {
            const itemId = this.getDetailItemId(link);
            return !this.persistedItemIds.has(itemId);
        });
    }
    getMissingDetailItems() {
        return this.getMissingDetailLinks().map((link) => this.extractFilmId(link) || link);
    }
    getActiveDetailItemSet() {
        return new Set(this.activeDetailItems.values());
    }
    pushPreviewItem(target, item, limit = 160) {
        (0, scraperRunnerStateUtils_1.pushPreviewItem)(target, item, limit);
    }
    getRecentPreview(source, predicate, limit = this.statePreviewLimit) {
        return (0, scraperRunnerStateUtils_1.getRecentPreview)(source, predicate, limit);
    }
    getAttemptedButUnfinishedItems() {
        const activeItems = this.getActiveDetailItemSet();
        return Array.from(this.attemptedItemIds)
            .filter((itemId) => !this.persistedItemIds.has(itemId) && !activeItems.has(itemId))
            .sort((left, right) => left.localeCompare(right, 'zh-CN'));
    }
    collectUncapturedItems() {
        const items = new Set();
        const activeItems = this.getActiveDetailItemSet();
        for (const detail of this.failedDetailMap.values()) {
            if (detail.item) {
                items.add(detail.item);
            }
        }
        for (const itemId of this.attemptedItemIds) {
            if (!this.persistedItemIds.has(itemId) && !activeItems.has(itemId)) {
                items.add(itemId);
            }
        }
        if (!this.queueManager || this.queueManager.areWorkQueuesFinished() || this.isStopping) {
            for (const item of this.getExpectedButNotPersistedIds()) {
                items.add(item);
            }
        }
        return items;
    }
    getUncapturedItems() {
        return Array.from(this.collectUncapturedItems()).sort((left, right) => left.localeCompare(right, 'zh-CN'));
    }
    getUncapturedItemsPreview(limit = this.statePreviewLimit) {
        const preview = [];
        const seen = new Set();
        const pushItem = (item) => {
            const normalizedItem = String(item || '').trim();
            if (!normalizedItem || seen.has(normalizedItem) || preview.length >= limit) {
                return;
            }
            seen.add(normalizedItem);
            preview.push(normalizedItem);
        };
        const activeItems = this.getActiveDetailItemSet();
        for (const detail of Array.from(this.failedDetailMap.values()).reverse()) {
            pushItem(detail.item);
        }
        for (const item of this.getRecentPreview(this.recentQueuedItems, (itemId) => !this.persistedItemIds.has(itemId) && !activeItems.has(itemId), limit)) {
            pushItem(item);
        }
        if (!this.queueManager || this.queueManager.areWorkQueuesFinished() || this.isStopping) {
            for (const item of this.getExpectedButNotPersistedIds()) {
                pushItem(item);
            }
        }
        return preview;
    }
    getUncapturedItemsTotal() {
        return this.collectUncapturedItems().size;
    }
    getActiveItems() {
        const items = this.activeIndexItem ? [this.activeIndexItem] : [];
        items.push(...Array.from(this.activeDetailItems.values()));
        return Array.from(new Set(items));
    }
    getActiveItemsPreview(limit = 12) {
        return this.getActiveItems().slice(0, limit);
    }
    getCompletedItemsPreview(limit = this.statePreviewLimit) {
        const preview = this.getRecentPreview(this.recentCompletedItems, (itemId) => this.persistedItemIds.has(itemId) || this.persistedFilmIds.has(itemId), limit);
        if (preview.length >= limit) {
            return preview;
        }
        const seen = new Set(preview);
        for (const itemId of this.persistedFilmIds) {
            if (preview.length >= limit) {
                break;
            }
            if (seen.has(itemId)) {
                continue;
            }
            seen.add(itemId);
            preview.push(itemId);
        }
        return preview;
    }
    getCompletedItemsTotal() {
        return this.filmCount;
    }
    getPendingItemsPreview(limit = this.statePreviewLimit) {
        const activeItems = this.getActiveDetailItemSet();
        const preview = [];
        const seen = new Set();
        for (const itemId of this.queuedItemIds) {
            if (preview.length >= limit) {
                break;
            }
            if (seen.has(itemId) || this.persistedItemIds.has(itemId) || activeItems.has(itemId)) {
                continue;
            }
            seen.add(itemId);
            preview.push(itemId);
        }
        return preview;
    }
    getPendingItemsTotal() {
        const activeItems = this.getActiveDetailItemSet();
        let total = 0;
        for (const itemId of this.queuedItemIds) {
            if (!this.persistedItemIds.has(itemId) && !activeItems.has(itemId)) {
                total += 1;
            }
        }
        return total;
    }
    getPageGapItems() {
        return (0, scraperRunnerStateUtils_1.buildPageGapItems)(this.getRecoverablePageAudits());
    }
    getPageGapItemsPreview(limit = 40) {
        return this.getPageGapItems().slice(0, limit);
    }
    async recoverExpectedQueueGaps(queueManager) {
        const queueGapLinks = this.getExpectedButNotQueuedLinks();
        if (queueGapLinks.length === 0 || this.isStopping) {
            return;
        }
        const recoveryMessages = (0, scraperRunnerRecoveryPipelineUtils_1.buildQueueGapRecoveryMessages)(queueGapLinks.length);
        this.logInfo(recoveryMessages.logMessage);
        this.emitState('running', recoveryMessages.stateMessage, this.getStats());
        this.persistTaskState(recoveryMessages.stateReason, 'running', recoveryMessages.stateMessage);
        await this.enqueueDetailLinksInBatches(queueManager, queueGapLinks, true);
        await (0, scraperRunnerRecoveryPipelineUtils_1.waitForRecoveryQueueDrain)({
            target: queueManager,
            shouldStop: () => this.isStopping
        });
        const remainingQueueGapIds = this.getExpectedButNotQueuedIds();
        if (remainingQueueGapIds.length > 0) {
            const remainingMessage = (0, scraperRunnerRecoveryPipelineUtils_1.buildQueueGapRemainingMessage)(remainingQueueGapIds.length);
            this.logInfo(remainingMessage);
            this.persistTaskState('\u5165\u961F\u7F3A\u53E3\u8865\u9F50\u540E\u4ECD\u6709\u7F3A\u5931', 'running', remainingMessage);
        }
        else {
            this.logInfo('\u5206\u9875\u89E3\u6790\u7ED3\u679C\u4E0E\u6700\u7EC8\u5165\u961F\u7F16\u53F7\u5DF2\u5B8C\u6210\u5BF9\u8D26\uFF0C\u5F53\u524D\u65E0\u5165\u961F\u7F3A\u53E3\u3002');
        }
    }
    async recoverPageGaps(queueManager) {
        for (let pass = 1; pass <= this.pageGapRecoveryRetryLimit && !this.isStopping; pass += 1) {
            const pendingAudits = this.getRecoverablePageAudits();
            if (pendingAudits.length === 0) {
                if (pass > 1) {
                    this.logInfo('\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u5B8C\u6210\uFF0C\u6240\u6709\u5DF2\u77E5\u9875\u9762\u5747\u8FBE\u5230\u9884\u671F\u6761\u6570\u3002');
                }
                return;
            }
            let recoveredCount = 0;
            const recoveryMessages = (0, scraperRunnerRecoveryPipelineUtils_1.buildPageGapRecoveryMessages)({
                pendingCount: pendingAudits.length,
                pass,
                totalPasses: this.pageGapRecoveryRetryLimit
            });
            this.logInfo(recoveryMessages.logMessage);
            this.emitState('running', recoveryMessages.stateMessage, this.getStats());
            this.persistTaskState(recoveryMessages.stateReason, 'running', recoveryMessages.stateMessage);
            for (const audit of pendingAudits) {
                if (this.isStopping || !this.config) {
                    break;
                }
                const expectedCount = audit.expectedCount;
                if (!expectedCount || expectedCount <= 0) {
                    continue;
                }
                const inferredTotalPages = this.getInferredTotalPages();
                const targetTotalPages = (this.config.totalPages && this.config.totalPages > 0 ? this.config.totalPages : inferredTotalPages) || 0;
                const isLastTargetPage = targetTotalPages > 0 && audit.pageNumber >= targetTotalPages;
                this.activeIndexItem = (0, scraperRunnerRecoveryPipelineUtils_1.buildPageGapActiveLabel)(audit);
                this.logInfo(`\u5F00\u59CB\u8865\u67E5\u7B2C ${audit.pageNumber} \u9875\u5206\u9875\u7F3A\u53E3\uFF08\u5F53\u524D ${audit.actualCount}/${expectedCount}\uFF09\u3002`);
                this.emitState('running', (0, scraperRunnerRecoveryPipelineUtils_1.buildPageGapActiveStateMessage)(audit.pageNumber), this.getStats());
                try {
                    const pageResult = await this.fetchValidatedPageLinks(queueManager, audit.url, audit.pageNumber, expectedCount, isLastTargetPage, 'recovery');
                    const trackedLinks = this.getTrackedPageLinks(pageResult.links);
                    const newLinks = trackedLinks.filter((link) => !this.isAlreadyPersisted(link) && !this.queuedDetailLinks.has(link));
                    const mergeResult = (0, scraperRunnerRecoveryPipelineUtils_1.mergePageGapRecoveryResult)({
                        expectedCount,
                        currentActualCount: audit.actualCount,
                        fetchedActualCount: pageResult.audit.actualCount,
                        newLinksCount: newLinks.length
                    });
                    const mergedAudit = this.createPageAudit(audit.pageNumber, audit.url, expectedCount, mergeResult.mergedActualCount, pageResult.audit.retryCount, mergeResult.validationPassed, isLastTargetPage);
                    mergedAudit.reason = this.appendPageAuditReason(mergeResult.reason, pageResult.diagnosticReason || '');
                    recoveredCount += mergeResult.recoveredCount;
                    this.updatePageAudit(mergedAudit);
                    this.emitState('running', (0, scraperRunnerRecoveryPipelineUtils_1.buildPageGapActiveStateMessage)(audit.pageNumber), this.getStats());
                    if (newLinks.length > 0) {
                        this.logInfo(`\u7B2C ${audit.pageNumber} \u9875\u8865\u67E5\u65B0\u589E ${newLinks.length} \u4E2A\u5F71\u7247\u94FE\u63A5\uFF0C\u5DF2\u52A0\u5165\u8BE6\u60C5\u961F\u5217\u3002`);
                        await this.enqueueDetailLinksInBatches(queueManager, newLinks, true);
                    }
                    else if (mergeResult.validationPassed) {
                        this.logInfo(`\u7B2C ${audit.pageNumber} \u9875\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u901A\u8FC7\u3002`);
                    }
                    else {
                        this.logInfo(`\u7B2C ${audit.pageNumber} \u9875\u8865\u67E5\u540E\u4ECD\u4E3A ${mergeResult.mergedActualCount}/${expectedCount}\u3002`);
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.logInfo(`\u7B2C ${audit.pageNumber} \u9875\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u5931\u8D25\uFF1A${message}`);
                }
                finally {
                    this.activeIndexItem = '';
                }
            }
            await (0, scraperRunnerRecoveryPipelineUtils_1.waitForRecoveryQueueDrain)({
                target: queueManager,
                shouldStop: () => this.isStopping
            });
            const remainingAudits = this.getRecoverablePageAudits();
            if (remainingAudits.length === 0) {
                this.logInfo('\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u5DF2\u5B8C\u6210\uFF0C\u5F53\u524D\u6240\u6709\u76EE\u6807\u9875\u9762\u5747\u8FBE\u5230\u9884\u671F\u6761\u6570\u3002');
                return;
            }
            if (recoveredCount <= 0) {
                this.logInfo('\u672C\u8F6E\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u672A\u63D0\u5347\u7ED3\u679C\uFF0C\u505C\u6B62\u7EE7\u7EED\u91CD\u590D\u8865\u67E5\uFF0C\u907F\u514D\u5F71\u54CD\u6293\u53D6\u4F53\u9A8C\u3002');
                break;
            }
        }
        const remainingAudits = this.getRecoverablePageAudits();
        if (remainingAudits.length > 0) {
            const remainingMessage = (0, scraperRunnerRecoveryPipelineUtils_1.buildPageGapRemainingMessage)(remainingAudits.length);
            this.logInfo(remainingMessage);
            this.persistTaskState('\u5206\u9875\u7F3A\u53E3\u8865\u67E5\u540E\u4ECD\u6709\u7F3A\u5931', 'running', remainingMessage);
        }
    }
    async recoverMissingDetailPages(queueManager) {
        for (let pass = 1; pass <= this.detailRecoveryRetryLimit && !this.isStopping; pass += 1) {
            const missingLinks = this.getMissingDetailLinks().filter((link) => !this.isAlreadyPersisted(link));
            const recoverableLinks = this.getRecoverableMissingDetailLinks(missingLinks);
            if (missingLinks.length === 0) {
                if (pass > 1) {
                    this.logInfo('\u8865\u722C\u6821\u9A8C\u901A\u8FC7\uFF0C\u6240\u6709\u5DF2\u5165\u961F\u5F71\u7247\u5747\u5DF2\u5904\u7406\u5B8C\u6210\u3002');
                }
                return;
            }
            if (recoverableLinks.length === 0) {
                const budgetExhaustedCount = missingLinks.filter((link) => {
                    const record = this.failedDetailMap.get(link);
                    const policy = this.classifyDetailFailure(record?.reason || '');
                    return (this.detailRecoveryAttemptMap.get(link) || 0) >= this.getDetailRecoveryBudget(policy);
                }).length;
                for (const message of (0, scraperRunnerRecoveryPipelineUtils_1.buildDetailBudgetStopMessages)(budgetExhaustedCount)) {
                    this.logInfo(message);
                }
                break;
            }
            const recoverySummary = this.buildRecoveryCategorySummary(recoverableLinks);
            const recoveryMessages = (0, scraperRunnerRecoveryPipelineUtils_1.buildDetailRecoveryMessages)({
                missingCount: missingLinks.length,
                pass,
                totalPasses: this.detailRecoveryRetryLimit,
                summary: recoverySummary
            });
            this.logInfo(recoveryMessages.logMessage);
            this.emitState('running', recoveryMessages.stateMessage, this.getStats());
            this.persistTaskState(recoveryMessages.stateReason, 'running', recoveryMessages.stateMessage);
            recoverableLinks.forEach((link) => {
                this.detailRecoveryAttemptMap.set(link, (this.detailRecoveryAttemptMap.get(link) || 0) + 1);
            });
            await this.enqueueDetailLinksInBatches(queueManager, recoverableLinks, false);
            await (0, scraperRunnerRecoveryPipelineUtils_1.waitForRecoveryQueueDrain)({
                target: queueManager,
                shouldStop: () => this.isStopping
            });
            const remainingAfterPass = this.getMissingDetailLinks().filter((link) => !this.isAlreadyPersisted(link));
            if (remainingAfterPass.length === 0) {
                return;
            }
            if (remainingAfterPass.length >= missingLinks.length) {
                const nextRecoverableLinks = this.getRecoverableMissingDetailLinks(remainingAfterPass);
                if (nextRecoverableLinks.length === 0) {
                    this.logInfo('\u5F53\u524D\u672A\u5B8C\u6210\u5F71\u7247\u5DF2\u5168\u90E8\u8017\u5C3D\u91CD\u8BD5\u9884\u7B97\uFF0C\u505C\u6B62\u7EE7\u7EED\u8865\u722C\u3002');
                    break;
                }
                this.logInfo(`\u7B2C ${pass} \u8F6E\u8865\u722C\u540E\u672A\u5B8C\u6210\u6570\u91CF\u6CA1\u6709\u4E0B\u964D\uFF0C\u4F46\u4ECD\u5B58\u5728\u53EF\u6062\u590D\u5931\u8D25\u9879\uFF0C\u4E0B\u4E00\u8F6E\u5C06\u4EC5\u91CD\u8BD5\u9AD8\u4F18\u5148\u7EA7\u5931\u8D25\u8BE6\u60C5\u9875\u3002`);
            }
        }
        const remainingMissingLinks = this.getMissingDetailLinks().filter((link) => !this.isAlreadyPersisted(link));
        if (remainingMissingLinks.length > 0) {
            const remainingMessage = (0, scraperRunnerRecoveryPipelineUtils_1.buildDetailRecoveryRemainingMessage)(remainingMissingLinks.length);
            this.logInfo(remainingMessage);
            this.persistTaskState('\u8865\u722C\u540E\u4ECD\u6709\u672A\u5B8C\u6210\u9879\u76EE', 'running', remainingMessage);
        }
    }
    async runSecondValidationIfNeeded() {
        if (!this.config?.secondValidation || !this.taskStateManager) {
            return;
        }
        this.emitState('running', '正在进行结果二次校验。', this.getStats());
        this.persistTaskState('开始结果二次校验', 'running', '正在进行结果二次校验。');
        const snapshot = this.buildTaskSnapshot('running', '正在进行结果二次校验。');
        this.validationReport = resultValidator_1.default.validateOutput(this.config.output, snapshot);
        this.taskStateManager.saveValidationReport(this.validationReport);
        this.logInfo(this.validationReport.summary);
        this.emitState('running', '已二次校验完成。', this.getStats());
        this.persistTaskState('结果二次校验完成', 'running', '已二次校验完成。');
    }
    loadPersistedOutputState() {
        if (!this.options.resumeExisting || !this.config) {
            return;
        }
        const outputFile = path_1.default.join(this.config.output, 'filmData.json');
        if (!fs_1.default.existsSync(outputFile)) {
            return;
        }
        try {
            const raw = JSON.parse(fs_1.default.readFileSync(outputFile, 'utf8'));
            const records = Array.isArray(raw) ? raw : [];
            for (const item of records) {
                this.updatePersistedFilmState(item);
            }
            this.filmCount = Math.max(this.filmCount, this.persistedFilmIds.size || records.length);
            this.logInfo(`恢复抓取模式已启用，已识别 ${records.length} 条历史记录，将自动跳过已完成内容。`);
        }
        catch (error) {
            this.logInfo(`恢复抓取模式读取历史记录失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    restoreTaskStateSnapshot() {
        if (!this.options.resumeExisting || !this.taskStateManager) {
            return;
        }
        const snapshot = this.taskStateManager.loadSnapshot();
        if (!snapshot || snapshot.status === 'completed') {
            return;
        }
        this.pageIndex = Math.max(1, snapshot.progress?.nextPageIndex || this.pageIndex);
        this.expectedItemsPerPage =
            snapshot.progress?.expectedItemsPerPage ?? this.expectedItemsPerPage ?? null;
        this.filmsQueued = Math.max(snapshot.progress?.queued || 0, this.filmsQueued);
        this.filmsAttempted = Math.max(snapshot.progress?.attempted || 0, this.filmsAttempted);
        this.filmCount = Math.max(snapshot.progress?.completed || 0, this.filmCount);
        this.pageAudits = Array.isArray(snapshot.pageAudits) ? snapshot.pageAudits : [];
        this.validationReport = snapshot.validationReport || null;
        this.failedDetailMap = new Map((snapshot.failedDetails || []).map((item) => [item.sourceLink, item]));
        for (const link of snapshot.links?.expected || snapshot.links?.queued || []) {
            this.rememberExpectedDetailLink(link);
            const itemId = this.getDetailItemId(link);
            this.expectedItemIds.add(itemId);
            this.expectedItemLinkMap.set(itemId, link);
        }
        for (const itemId of snapshot.links?.expectedIds || []) {
            this.expectedItemIds.add(itemId);
        }
        for (const link of snapshot.links?.queued || []) {
            this.queuedDetailLinks.add(link);
            this.queuedItemIds.add(this.getDetailItemId(link));
            const filmId = this.extractFilmId(link);
            if (filmId) {
                this.queuedFilmIds.add(filmId);
            }
        }
        for (const itemId of snapshot.links?.queuedIds || []) {
            this.queuedItemIds.add(itemId);
        }
        for (const link of snapshot.links?.processed || []) {
            this.processedDetailLinks.add(link);
            this.processedItemIds.add(this.getDetailItemId(link));
        }
        for (const itemId of snapshot.links?.processedIds || []) {
            this.processedItemIds.add(itemId);
        }
        for (const link of snapshot.links?.persisted || []) {
            this.persistedDetailLinks.add(link);
            this.persistedItemIds.add(this.getDetailItemId(link));
        }
        for (const itemId of snapshot.links?.persistedIds || []) {
            this.persistedItemIds.add(itemId);
        }
        for (const filmId of snapshot.links?.persistedFilmIds || []) {
            this.persistedFilmIds.add(filmId);
            this.persistedItemIds.add(filmId);
        }
        for (const itemId of snapshot.links?.skippedIds || []) {
            this.skippedByPolicyItemIds.add(itemId);
        }
        for (const itemId of snapshot.reconciliation?.duplicateExpectedIds || []) {
            this.duplicateExpectedIds.add(itemId);
        }
        this.logInfo(`已从任务状态文件恢复：页码 ${this.pageIndex}，待补任务 ${this.getMissingDetailLinks().length} 条。`);
    }
    async resumePendingDetailLinks(queueManager) {
        if (!this.options.resumeExisting) {
            return;
        }
        const pendingLinks = this.getMissingDetailLinks();
        if (pendingLinks.length === 0) {
            return;
        }
        this.logInfo(`已恢复 ${pendingLinks.length} 个未完成详情任务，优先继续补爬。`);
        await this.enqueueDetailLinksInBatches(queueManager, pendingLinks, false);
        this.persistTaskState('恢复未完成详情任务', 'running', `已恢复 ${pendingLinks.length} 个未完成详情任务。`);
    }
    updatePersistedFilmState(filmData) {
        const detailIdentity = this.getDetailItemId(filmData.sourceLink || filmData.title || '');
        const rawSourceLink = String(filmData.sourceLink || '').trim();
        const rawTitle = String(filmData.title || '').trim();
        if (filmData.sourceLink) {
            this.persistedDetailLinks.add(filmData.sourceLink);
        }
        if (rawSourceLink) {
            this.skippedByPolicyItemIds.delete(rawSourceLink);
        }
        if (rawTitle) {
            this.skippedByPolicyItemIds.delete(rawTitle);
        }
        if (detailIdentity) {
            this.persistedItemIds.add(detailIdentity);
            this.skippedByPolicyItemIds.delete(detailIdentity);
        }
        const filmId = this.extractFilmId(filmData.sourceLink || filmData.title || '');
        if (filmId) {
            this.persistedFilmIds.add(filmId);
            this.persistedItemIds.add(filmId);
            this.skippedByPolicyItemIds.delete(filmId);
        }
        this.pushPreviewItem(this.recentCompletedItems, filmId || detailIdentity);
    }
    markItemSkippedByPolicy(value) {
        const detailIdentity = this.getDetailItemId(value);
        if (detailIdentity) {
            this.skippedByPolicyItemIds.add(detailIdentity);
        }
        const filmId = this.extractFilmId(value);
        if (filmId) {
            this.skippedByPolicyItemIds.add(filmId);
        }
    }
    isAlreadyPersisted(link) {
        if (!this.options.resumeExisting) {
            return false;
        }
        const itemId = this.getDetailItemId(link);
        if (this.persistedDetailLinks.has(link) || this.persistedItemIds.has(itemId)) {
            return true;
        }
        const filmId = this.extractFilmId(link);
        return Boolean(filmId && this.persistedFilmIds.has(filmId));
    }
    extractFilmId(value) {
        return (0, filmIdentity_1.extractFilmId)(value);
    }
    shouldPersistFilm(filmData) {
        if (!this.config?.nomag) {
            return true;
        }
        return Boolean(filmData.magnetLinks && filmData.magnetLinks.length > 0);
    }
    capturePendingRunningTasks(taskSummaries = []) {
        this.pendingRunningTaskMap.clear();
        for (const summary of Array.isArray(taskSummaries) ? taskSummaries : []) {
            const item = String(summary?.item || '').trim();
            if (!item) {
                continue;
            }
            this.pendingRunningTaskMap.set(item, {
                ...summary
            });
        }
    }
    buildInferredFailedDetails() {
        const reconciliation = this.buildReconciliation();
        const expectedButNotQueued = new Set(reconciliation.expectedButNotQueuedIds || []);
        const explicitItems = new Set(Array.from(this.failedDetailMap.values()).map((detail) => detail.item));
        const inferredDetails = [];
        for (const item of this.getUncapturedItems()) {
            if (!item || explicitItems.has(item)) {
                continue;
            }
            const pendingTask = this.pendingRunningTaskMap.get(item);
            let category = '未完成';
            let reason = '任务结束时该番号仍未完成，请结合分页缺口与失败面板继续补抓。';
            let retryAdvice = '建议使用重新爬取，仅补抓未完成番号。';
            if (pendingTask) {
                category = '终止中断';
                reason = `任务终止时仍停留在${pendingTask.stage}，已运行 ${pendingTask.runtimeSeconds} 秒，结果尚未写入。`;
                retryAdvice = '建议重新爬取该番号，优先补全终止前仍在运行的任务。';
            }
            else if (this.attemptedItemIds.has(item)) {
                category = '结果未落盘';
                reason = '该番号已尝试抓取，但结果尚未写入输出文件，可能在磁力补抓或收尾阶段中断。';
                retryAdvice = '建议重新爬取该番号，并优先检查磁力补抓链路。';
            }
            else if (this.queuedItemIds.has(item)) {
                category = '排队未执行';
                reason = '该番号已进入详情队列，但在任务结束前尚未处理到。';
                retryAdvice = '建议重新爬取，让队列继续补全剩余项目。';
            }
            else if (expectedButNotQueued.has(item)) {
                category = '入队缺口';
                reason = '索引页已识别到该番号，但未成功进入详情队列，请优先复查分页缺口与站点条数。';
                retryAdvice = '建议结合分页缺口提示，重新抓取缺失页后再补爬。';
            }
            inferredDetails.push({
                item,
                sourceLink: this.expectedItemLinkMap.get(item) || pendingTask?.rawValue || '',
                reason,
                category,
                retryCount: 0,
                retryAdvice,
                recoverable: true,
                lastFailedAt: new Date().toISOString()
            });
        }
        return inferredDetails.sort((left, right) => left.item.localeCompare(right.item, 'zh-CN'));
    }
    getFailedDetails(includeInferred = false) {
        const explicitDetails = Array.from(this.failedDetailMap.values()).sort((left, right) => left.item.localeCompare(right.item, 'zh-CN'));
        if (!includeInferred) {
            return explicitDetails;
        }
        return explicitDetails.concat(this.buildInferredFailedDetails());
    }
    buildFailedDetailSummary() {
        const categoryCounts = new Map();
        for (const detail of this.getFailedDetails(true)) {
            const category = String(detail.category || '其他失败').trim() || '其他失败';
            categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        }
        return Array.from(categoryCounts.entries())
            .sort((left, right) => {
            if (right[1] !== left[1]) {
                return right[1] - left[1];
            }
            return left[0].localeCompare(right[0], 'zh-CN');
        })
            .map(([category, count]) => `${category} ${count} 条`)
            .join('，');
    }
    logFailedDetailSummaryIfNeeded() {
        if (this.getFailedDetails(true).length === 0) {
            return;
        }
        const summary = this.buildFailedDetailSummary();
        if (!summary) {
            return;
        }
        this.logInfo(`失败原因汇总：${summary}。详细条目已写入未完成番号.txt。`);
    }
    getFailedDetailsPreview(limit = 80) {
        return this.getFailedDetails(limit > 0 && this.isStopping).slice(0, limit);
    }
    attachLogger() {
        this.unsubscribeLogger = (0, logger_1.subscribeToLogs)((entry) => {
            const level = String(entry.level || '').toLowerCase();
            if (!['info', 'warn', 'error'].includes(level)) {
                return;
            }
            this.emit('log', entry);
        });
    }
    detachLogger() {
        if (this.unsubscribeLogger) {
            this.unsubscribeLogger();
            this.unsubscribeLogger = null;
        }
    }
    attachSignalHandlers() {
        if (!this.options.handleSignals) {
            return;
        }
        const register = (signal) => {
            const handler = () => {
                void this.stop();
            };
            process.on(signal, handler);
            this.signalHandlers.push({ signal, handler });
        };
        register('SIGINT');
        register('SIGTERM');
    }
    detachSignalHandlers() {
        for (const { signal, handler } of this.signalHandlers) {
            process.off(signal, handler);
        }
        this.signalHandlers = [];
    }
    emitLog(level, message) {
        this.emit('log', {
            level,
            message,
            timestamp: new Date().toISOString()
        });
    }
    emitState(status, message, stats = this.getStats()) {
        this.lastStateMessage = message;
        const isFinalState = ['completed', 'incomplete', 'stopped', 'error'].includes(status);
        const activeItems = this.getActiveItemsPreview();
        const unfinishedItems = isFinalState ? this.getUncapturedItems() : this.getUncapturedItemsPreview();
        const duplicateItems = isFinalState ? this.getDuplicateItemIds() : this.getDuplicateItemIdsPreview();
        const pageGapItems = this.getPageGapItemsPreview();
        const allFailedDetails = isFinalState ? this.getFailedDetails(true) : this.getFailedDetails();
        const failedDetails = allFailedDetails.slice(0, 80);
        this.emit('state', {
            status,
            message,
            activeItems,
            activeItemsTotal: this.getActiveItems().length,
            completedItems: [],
            completedItemsTotal: this.getCompletedItemsTotal(),
            pendingItems: [],
            pendingItemsTotal: 0,
            duplicateItems,
            duplicateItemsTotal: this.getDuplicateItemIds().length,
            unfinishedItems,
            unfinishedItemsTotal: this.getUncapturedItemsTotal(),
            missingItems: unfinishedItems,
            missingItemsTotal: this.getUncapturedItemsTotal(),
            pageGapItems,
            pageGapItemsTotal: this.getRecoverablePageAudits().length,
            failedDetails,
            failedDetailsTotal: allFailedDetails.length,
            stats
        });
    }
    getStats() {
        return {
            queued: this.filmsQueued,
            attempted: this.filmsAttempted,
            completed: this.filmCount,
            pageIndex: this.pageIndex
        };
    }
    buildTaskSnapshot(status, message, mode = 'full') {
        const reconciliation = this.buildReconciliation();
        return (0, scraperRunnerSnapshotUtils_1.buildTaskSnapshot)({
            appVersion: APP_VERSION,
            status,
            message,
            startedAt: this.startedAt,
            config: this.config,
            pageIndex: this.pageIndex,
            expectedItemsPerPage: this.expectedItemsPerPage,
            filmsQueued: this.filmsQueued,
            filmsAttempted: this.filmsAttempted,
            filmCount: this.filmCount,
            expectedDetailLinks: this.expectedDetailLinks,
            queuedDetailLinks: this.queuedDetailLinks,
            processedDetailLinks: this.processedDetailLinks,
            persistedDetailLinks: this.persistedDetailLinks,
            persistedFilmIds: this.persistedFilmIds,
            skippedItemIds: this.skippedByPolicyItemIds,
            reconciliation,
            missingItems: this.getUncapturedItems(),
            failedDetails: this.getFailedDetails(true),
            pageAudits: this.pageAudits,
            validationReport: this.validationReport,
            mode
        });
    }
    getRuntimeSchemeLabel() {
        if (!this.config) {
            return 'BASE';
        }
        const label = String(this.config.demoLabel || '').trim();
        const mode = String(this.config.demoMode || 'base').trim().toUpperCase();
        return label || mode || 'BASE';
    }
    getFinalStateAfterExecution() {
        const reconciliation = this.buildReconciliation();
        const rawDuplicateGroups = reconciliation.rawDuplicateGroups || this.getRawDuplicateGroups();
        const allFailedDetails = this.getFailedDetails(true);
        return (0, scraperRunnerFinalStateUtils_1.buildFinalRunnerState)({
            unresolvedCount: reconciliation.expectedButNotPersistedIds.length,
            queueGapCount: reconciliation.expectedButNotQueuedIds.length,
            processedGapCount: reconciliation.processedButNotPersistedIds.length,
            failedCount: allFailedDetails.length,
            lowConfidencePageCount: this.getRecoverablePageAudits().length,
            duplicateExpectedCount: reconciliation.duplicateExpectedIds.length,
            duplicateItemIds: this.getDuplicateItemIds(),
            duplicateItemSummary: this.buildDuplicateItemSummary(),
            unfinishedItems: this.getUncapturedItems(),
            expectedEntryCount: reconciliation.expectedEntryCount || this.getExpectedEntryCount(),
            rawDuplicateEntryCount: reconciliation.rawDuplicateEntryCount || this.getRawDuplicateEntryCount(),
            duplicateSummary: this.buildRawDuplicateSummary(rawDuplicateGroups),
            configuredTargetCount: this.getConfiguredTargetEntryCount(),
            validationPassed: this.validationReport ? this.validationReport.passed : true,
            secondValidationEnabled: Boolean(this.config?.secondValidation),
            completedCount: this.filmCount,
            skippedByPolicyCount: this.skippedByPolicyItemIds.size,
            expectedUniqueCount: reconciliation.expectedIds.length
        });
    }
    getUnfinishedReportLines(status, message) {
        return (0, scraperRunnerStateUtils_1.buildUnfinishedReportLines)({
            status,
            message,
            filmCount: this.filmCount,
            configuredTargetCount: this.getConfiguredTargetEntryCount(),
            expectedEntryCount: this.getExpectedEntryCount(),
            rawDuplicateGroups: this.getRawDuplicateGroups(),
            rawDuplicateEntryCount: this.getRawDuplicateEntryCount(),
            unfinishedItems: this.getUncapturedItems(),
            pageGapLines: this.getPageGapItems(),
            failedDetails: this.getFailedDetails(true),
            skippedByPolicyCount: this.skippedByPolicyItemIds.size
        });
    }
    finalizeOutputArtifacts(status, message) {
        (0, scraperRunnerPersistenceUtils_1.finalizeRunnerOutputArtifacts)({
            hasConfig: Boolean(this.config),
            status,
            message,
            fileHandler: this.queueManager?.getFileHandler(),
            uncapturedItemsTotal: this.getUncapturedItemsTotal(),
            recoverablePageAuditCount: this.getRecoverablePageAudits().length,
            buildUnfinishedReportLines: (nextStatus, nextMessage) => this.getUnfinishedReportLines(nextStatus, nextMessage),
            cleanupRuntimeState: () => this.taskStateManager?.cleanupRuntimeState(),
            onError: (errorMessage) => this.logInfo(errorMessage)
        });
    }
    persistTaskState(reason, status = 'running', message = this.lastStateMessage || '任务状态已更新。', force = true, snapshotMode) {
        (0, scraperRunnerPersistenceUtils_1.persistRunnerTaskState)({
            taskStateManager: this.taskStateManager,
            reason,
            status,
            message,
            force,
            snapshotMode,
            lastStatePersistAt: this.lastStatePersistAt,
            statePersistMinIntervalMs: this.statePersistMinIntervalMs,
            buildTaskSnapshot: (nextStatus, nextMessage, mode) => this.buildTaskSnapshot(nextStatus, nextMessage, mode),
            onMutationReset: () => {
                this.stateMutationCount = 0;
            },
            onPersisted: (persistedAt) => {
                this.lastStatePersistAt = persistedAt;
            },
            onDebug: (debugMessage) => this.logDebug(debugMessage),
            onWarn: (warnMessage) => logger_1.default.warn(warnMessage)
        });
    }
    markStateDirty(reason) {
        this.stateMutationCount += 1;
        if (this.stateMutationCount >= this.statePersistThreshold) {
            this.persistTaskState(reason, 'running', this.lastStateMessage || '任务状态已更新。', false, 'light');
        }
    }
    logInfo(message) {
        if (this.multibar) {
            this.multibar.log(message + '\n');
        }
        else if (this.options.handleSignals) {
            console.log(message);
        }
        this.emitLog('info', message);
    }
    logDebug(message) {
        this.emitLog('debug', message);
    }
    async cleanup() {
        if (this.progressBar) {
            this.progressBar.stop();
            this.progressBar = null;
        }
        if (this.multibar) {
            this.multibar.stop();
            this.multibar = null;
        }
        if (this.requestHandler) {
            try {
                await this.requestHandler.close();
            }
            catch (error) {
                logger_1.default.warn(`Failed to close request handler: ${error instanceof Error ? error.message : String(error)}`);
            }
            finally {
                this.requestHandler = null;
            }
        }
        if (this.queueManager) {
            try {
                await this.queueManager.flushOutputs();
            }
            catch (error) {
                logger_1.default.warn(`Failed to flush output files: ${error instanceof Error ? error.message : String(error)}`);
            }
            this.queueManager.interruptAllDelays();
            this.queueManager = null;
        }
    }
}
async function runCrawler(options = {}) {
    const runner = new ScraperRunner(options);
    await runner.run();
}
exports.default = ScraperRunner;
export { ScraperRunner as default, runCrawler };
//# sourceMappingURL=scraperRunner.js.map
