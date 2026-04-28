import type { RuntimeOptions } from '../types/interfaces';
import type { FailedDetailRecord, PageAuditRecord } from './taskStateManager';

export interface ScraperRunnerOptions extends Partial<RuntimeOptions> {
  useProgressBars?: boolean;
  handleSignals?: boolean;
  resumeExisting?: boolean;
  outputResolved?: boolean;
}

export interface RunnerStatePayload {
  status:
    | 'idle'
    | 'starting'
    | 'running'
    | 'stopping'
    | 'completed'
    | 'stopped'
    | 'error'
    | 'incomplete';
  message: string;
  activeItems?: string[];
  activeItemsTotal?: number;
  completedItems?: string[];
  completedItemsTotal?: number;
  pendingItems?: string[];
  pendingItemsTotal?: number;
  duplicateItems?: string[];
  duplicateItemsTotal?: number;
  unfinishedItems?: string[];
  unfinishedItemsTotal?: number;
  missingItems?: string[];
  missingItemsTotal?: number;
  pageGapItems?: string[];
  pageGapItemsTotal?: number;
  failedDetails?: FailedDetailRecord[];
  failedDetailsTotal?: number;
  stats?: {
    queued: number;
    attempted: number;
    completed: number;
    pageIndex: number;
  };
}

export type RunnerStatus = RunnerStatePayload['status'];

export interface UpdateAntiBlockResult {
  antiBlockUrls: string[];
  filePath: string;
}

export interface PageFetchResult {
  links: string[];
  audit: PageAuditRecord;
  diagnosticReason?: string;
}

export interface PrefetchedIndexPage {
  pageNumber: number;
  url: string;
  expectedCount: number | null;
  isLastTargetPage: boolean;
  phase: 'initial' | 'recovery';
  promise: Promise<PageFetchResult>;
}

export interface DetailFailurePolicy {
  key: 'blocked' | 'network' | 'empty' | 'parse' | 'unknown' | 'stopped';
  label: string;
  maxRetries: number;
  priority: number;
  advice: string;
}

export type TaskSnapshotMode = 'light' | 'full';

export type RunnerExecutionPhase =
  | 'boot'
  | 'queue_setup'
  | 'resume_pending'
  | 'index_discovery'
  | 'queue_drain'
  | 'page_gap_recovery'
  | 'queue_gap_recovery'
  | 'detail_recovery'
  | 'second_validation'
  | 'final_drain';
