/**
 * 输出文件处理层：
 * - 维护 filmData.json 的增量写入与稳健去重
 * - 维护只含纯 magnet 链接的 magnet-links.txt
 * - 仅在运行态目录写入内部备份，不污染用户输出目录
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FilmData, MagnetLink } from '../types/interfaces';
import {
  createFilmIdentityKey,
  extractFilmId,
  normalizeSourceLink,
  normalizeTitle,
  serializeMagnetLinks
} from './filmIdentity';
import logger from './logger';

class FileHandler {
  private outputDir: string;
  private jsonFilename: string;
  private magnetFilename: string;
  private unfinishedFilename: string;
  private backupDir: string;
  private recordsCache: FilmData[] = [];
  private recordIndexByFilmId = new Map<string, number>();
  private recordIndexBySourceLink = new Map<string, number>();
  private cacheLoaded = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private dirty = false;
  private bufferedChanges = 0;
  private readonly flushThreshold = 12;
  private readonly flushDelayMs = 1200;

  constructor(outputDir: string) {
    if (typeof outputDir !== 'string' || outputDir.trim() === '') {
      throw new Error(`Invalid output directory provided: "${outputDir}".`);
    }

    this.outputDir = outputDir;
    this.jsonFilename = 'filmData.json';
    this.magnetFilename = 'magnet-links.txt';
    this.unfinishedFilename = '未完成番号.txt';
    this.backupDir = this.resolveBackupDir(outputDir);
    void this.ensureOutputDirExists();
  }

  private async ensureOutputDirExists(): Promise<void> {
    await fs.promises.mkdir(this.outputDir, { recursive: true });
    await fs.promises.mkdir(this.backupDir, { recursive: true });
  }

  public syncUnfinishedItemsReport(lines: string[]): void {
    const filePath = path.join(this.outputDir, this.unfinishedFilename);
    const normalizedLines = Array.from(
      new Set(
        (Array.isArray(lines) ? lines : [])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );

    if (normalizedLines.length === 0) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      return;
    }

    fs.writeFileSync(filePath, normalizedLines.join('\r\n'), 'utf8');
    logger.info(`FileHandler: 未完成番号文本已生成: ${filePath}`);
  }

  public cleanupLegacyOutputArtifacts(): void {
    const legacyTargets = [
      path.join(this.outputDir, 'task-state.json'),
      path.join(this.outputDir, 'validation-report.json'),
      path.join(this.outputDir, 'backups')
    ];

    for (const target of legacyTargets) {
      if (!fs.existsSync(target)) {
        continue;
      }

      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  public async writeFilmDataToFile(data: FilmData): Promise<void> {
    if (typeof data !== 'object' || data === null) {
      throw new Error(`Invalid data provided: "${data}".`);
    }

    logger.debug(`FileHandler: start writing film data, title: ${data.title}`);

    try {
      this.loadCacheIfNeeded();
      const normalizedIncoming = this.normalizeFilmData(data);
      const duplicateIndex = this.findDuplicateIndex(this.recordsCache, normalizedIncoming);

      if (duplicateIndex === -1) {
        this.recordsCache.push(normalizedIncoming);
        this.indexRecord(normalizedIncoming, this.recordsCache.length - 1);
        logger.info(`FileHandler: appended new film data: ${data.title}`);
      } else {
        const mergedRecord = this.mergeFilmData(this.recordsCache[duplicateIndex], normalizedIncoming);
        if (this.isSameFilmData(this.recordsCache[duplicateIndex], mergedRecord)) {
          logger.debug(`FileHandler: duplicate film data unchanged, skipped flush: ${data.title}`);
          return;
        }

        this.recordsCache[duplicateIndex] = mergedRecord;
        this.rebuildIndexes(this.recordsCache);
        logger.info(`FileHandler: merged duplicate film data: ${data.title}`);
      }

      this.dirty = true;
      this.bufferedChanges += 1;

      if (this.bufferedChanges >= this.flushThreshold) {
        await this.flush(true);
      } else {
        this.scheduleDeferredFlush();
      }
    } catch (error) {
      logger.error(
        `FileHandler: failed to write film data: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error(`FileHandler: error details: ${error instanceof Error ? error.stack : String(error)}`);
      throw error;
    }
  }

  public async flush(force = false): Promise<void> {
    if (!this.dirty && !force) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.flushInFlight) {
      await this.flushInFlight;
      if (!this.dirty || !force) {
        return;
      }
    }

    this.flushInFlight = this.flushToDisk();

    try {
      await this.flushInFlight;
    } finally {
      this.flushInFlight = null;
    }
  }

  public async close(): Promise<void> {
    await this.flush(true);
  }

  public getFilmDataSnapshot(): FilmData[] {
    this.loadCacheIfNeeded();
    return this.recordsCache.map((item) => ({
      ...item,
      category: [...(item.category || [])],
      actress: [...(item.actress || [])],
      magnetLinks: this.mergeMagnetLinks(item.magnetLinks || [], []),
      backupMagnetLinks: this.mergeMagnetLinks(item.backupMagnetLinks || [], [])
    }));
  }

  private loadExistingData(filePath: string): FilmData[] {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => this.normalizeFilmData(item));
      }

      return parsed ? [this.normalizeFilmData(parsed)] : [];
    } catch {
      logger.warn(`FileHandler: invalid JSON format in ${filePath}, resetting to empty array`);
      return [];
    }
  }

  private loadCacheIfNeeded(): void {
    if (this.cacheLoaded) {
      return;
    }

    const jsonPath = path.join(this.outputDir, this.jsonFilename);
    this.recordsCache = this.compactRecords(this.loadExistingData(jsonPath));
    this.rebuildIndexes(this.recordsCache);
    this.cacheLoaded = true;
  }

  private scheduleDeferredFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
  }

  private async flushToDisk(): Promise<void> {
    if (!this.dirty) {
      return;
    }

    await this.ensureOutputDirExists();

    const jsonPath = path.join(this.outputDir, this.jsonFilename);
    const compactedData = this.compactRecords(this.recordsCache);
    this.recordsCache = compactedData;
    this.rebuildIndexes(this.recordsCache);
    this.writeJsonOutput(jsonPath, compactedData);
    this.writeMagnetTextOutput(compactedData);
    this.dirty = false;
    this.bufferedChanges = 0;
    logger.info(`FileHandler: flushed ${compactedData.length} film records to disk`);
  }

  private writeJsonOutput(filePath: string, data: FilmData[]): void {
    const hadExistingFile = fs.existsSync(filePath);
    this.createLatestBackup(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    if (!hadExistingFile) {
      this.createLatestBackup(filePath);
    }
    logger.info(`FileHandler: film data saved to ${filePath}`);
  }

  private writeMagnetTextOutput(data: FilmData[]): void {
    // 这里故意只输出纯 magnet 链接，便于用户直接导入下载工具。
    const magnetPath = path.join(this.outputDir, this.magnetFilename);
    const hadExistingFile = fs.existsSync(magnetPath);
    const uniqueMagnets = Array.from(
      new Set(
        data.flatMap((film) =>
          (film.magnetLinks || [])
            .map((magnet) => magnet.link?.trim())
            .filter((link): link is string => Boolean(link))
        )
      )
    );

    this.createLatestBackup(magnetPath);
    fs.writeFileSync(magnetPath, uniqueMagnets.join('\n'), 'utf8');
    if (!hadExistingFile) {
      this.createLatestBackup(magnetPath);
    }
    logger.info(`FileHandler: pure magnet text saved to ${magnetPath}`);
  }

  private createLatestBackup(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }

    fs.mkdirSync(this.backupDir, { recursive: true });
    const backupPath = path.join(this.backupDir, `${path.basename(filePath)}.bak`);
    fs.copyFileSync(filePath, backupPath);
  }

  private rebuildIndexes(records: FilmData[]): void {
    this.recordIndexByFilmId.clear();
    this.recordIndexBySourceLink.clear();
    records.forEach((record, index) => this.indexRecord(record, index));
  }

  private indexRecord(record: FilmData, index: number): void {
    const filmId = extractFilmId(record.sourceLink || record.title || serializeMagnetLinks(record.magnetLinks));
    if (filmId) {
      this.recordIndexByFilmId.set(filmId, index);
    }

    const sourceLink = normalizeSourceLink(record.sourceLink);
    if (sourceLink) {
      this.recordIndexBySourceLink.set(sourceLink, index);
    }
  }

  private resolveBackupDir(outputDir: string): string {
    const homeDir =
      (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || process.cwd();
    const runtimeRoot = process.env.JAV_SCRAPY_FILE_BACKUP_DIR || path.join(homeDir, '.jav-scrapy', 'file-backups');
    const normalizedOutput = path.resolve(outputDir || process.cwd()).toLowerCase();
    const stateId = crypto.createHash('sha1').update(normalizedOutput).digest('hex').slice(0, 16);
    return path.join(runtimeRoot, stateId);
  }

  private findDuplicateIndex(existingData: FilmData[], incomingData: FilmData): number {
    const incomingSourceLink = normalizeSourceLink(incomingData.sourceLink);
    const incomingFilmId = extractFilmId(
      incomingData.sourceLink || incomingData.title || serializeMagnetLinks(incomingData.magnetLinks)
    );

    if (incomingFilmId) {
      const filmIdIndex =
        existingData === this.recordsCache
          ? this.recordIndexByFilmId.get(incomingFilmId) ?? -1
          : existingData.findIndex(
              (item) =>
                extractFilmId(item.sourceLink || item.title || serializeMagnetLinks(item.magnetLinks)) ===
                incomingFilmId
            );
      if (filmIdIndex !== -1) {
        return filmIdIndex;
      }
    }

    if (incomingSourceLink) {
      const sourceLinkIndex =
        existingData === this.recordsCache
          ? this.recordIndexBySourceLink.get(incomingSourceLink) ?? -1
          : existingData.findIndex((item) => normalizeSourceLink(item.sourceLink) === incomingSourceLink);
      if (sourceLinkIndex !== -1) {
        return sourceLinkIndex;
      }
    }

    const incomingMagnets = new Set(serializeMagnetLinks(incomingData.magnetLinks).split('|').filter(Boolean));
    if (incomingMagnets.size > 0) {
      const magnetIndex = existingData.findIndex((item) => {
        const existingMagnets = serializeMagnetLinks(item.magnetLinks).split('|').filter(Boolean);
        return existingMagnets.some((link) => incomingMagnets.has(link));
      });

      if (magnetIndex !== -1) {
        return magnetIndex;
      }
    }

    const normalizedIncomingTitle = normalizeTitle(incomingData.title);
    if (normalizedIncomingTitle.length > 0) {
      const titleIndex = existingData.findIndex((item) => {
        const normalizedExistingTitle = normalizeTitle(item.title);
        return normalizedIncomingTitle === normalizedExistingTitle;
      });

      if (titleIndex !== -1) {
        return titleIndex;
      }
    }

    return -1;
  }

  private mergeFilmData(existingItem: FilmData, incomingData: FilmData): FilmData {
    const normalizedExisting = this.normalizeFilmData(existingItem);
    const normalizedIncoming = this.normalizeFilmData(incomingData);

    return {
      title:
        normalizedIncoming.title.length >= normalizedExisting.title.length
          ? normalizedIncoming.title
          : normalizedExisting.title,
      sourceLink: normalizedExisting.sourceLink || normalizedIncoming.sourceLink,
      coverImage: this.pickPreferredCoverImage(
        normalizedExisting.coverImage,
        normalizedIncoming.coverImage
      ),
      category: this.mergeUniqueText(normalizedExisting.category, normalizedIncoming.category),
      actress: this.mergeUniqueText(normalizedExisting.actress, normalizedIncoming.actress),
      magnetLinks: this.mergeMagnetLinks(normalizedExisting.magnetLinks, normalizedIncoming.magnetLinks),
      backupMagnetLinks: this.mergeMagnetLinks(
        normalizedExisting.backupMagnetLinks || normalizedExisting.magnetLinks,
        normalizedIncoming.backupMagnetLinks || normalizedIncoming.magnetLinks
      )
    };
  }

  private compactRecords(records: FilmData[]): FilmData[] {
    const compacted: FilmData[] = [];

    for (const record of records.map((item) => this.normalizeFilmData(item))) {
      const duplicateIndex = this.findDuplicateIndex(compacted, record);
      if (duplicateIndex === -1) {
        compacted.push(record);
      } else {
        compacted[duplicateIndex] = this.mergeFilmData(compacted[duplicateIndex], record);
      }
    }

    return compacted;
  }

  private normalizeFilmData(data: Partial<FilmData>): FilmData {
    return {
      title: (data.title || '').trim(),
      sourceLink: data.sourceLink?.trim(),
      coverImage: data.coverImage?.trim() || undefined,
      category: this.mergeUniqueText(data.category || [], []),
      actress: this.mergeUniqueText(data.actress || [], []),
      magnetLinks: this.mergeMagnetLinks(data.magnetLinks || [], []),
      backupMagnetLinks: this.mergeMagnetLinks(
        data.backupMagnetLinks || data.magnetLinks || [],
        []
      )
    };
  }

  private pickPreferredCoverImage(
    existingCoverImage?: string,
    incomingCoverImage?: string
  ): string | undefined {
    const normalizedExisting = String(existingCoverImage || '').trim();
    const normalizedIncoming = String(incomingCoverImage || '').trim();

    if (!normalizedExisting) {
      return normalizedIncoming || undefined;
    }

    if (!normalizedIncoming) {
      return normalizedExisting;
    }

    const existingIsAbsolute = /^https?:\/\//i.test(normalizedExisting);
    const incomingIsAbsolute = /^https?:\/\//i.test(normalizedIncoming);

    if (incomingIsAbsolute && !existingIsAbsolute) {
      return normalizedIncoming;
    }

    if (existingIsAbsolute && !incomingIsAbsolute) {
      return normalizedExisting;
    }

    return normalizedIncoming.length >= normalizedExisting.length
      ? normalizedIncoming
      : normalizedExisting;
  }

  private mergeUniqueText(primary: string[], secondary: string[]): string[] {
    return Array.from(
      new Set(
        [...primary, ...secondary]
          .map((item) => String(item || '').trim())
          .filter(Boolean)
      )
    );
  }

  private mergeMagnetLinks(
    primary: MagnetLink[] = [],
    secondary: MagnetLink[] = []
  ): MagnetLink[] {
    const map = new Map<string, MagnetLink>();

    for (const item of [...primary, ...secondary]) {
      const link = item?.link?.trim();
      if (!link) {
        continue;
      }

      map.set(link, {
        link,
        size: String(item.size || '').trim()
      });
    }

    return Array.from(map.values());
  }

  private isSameFilmData(left: FilmData, right: FilmData): boolean {
    return JSON.stringify(this.normalizeFilmData(left)) === JSON.stringify(this.normalizeFilmData(right));
  }
}

export default FileHandler;
