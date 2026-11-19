import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  validateActivisionId,
  type CombatRecordStats,
  type JobErrorCode,
  type JobStatusResponse,
} from '@mw4trackstats/shared';
import type { AppConfig } from '../config.js';
import type { JobRecord, JobRepository, StatsRepository } from '../db/repository.js';
import type { SessionRepository } from '../db/sessionRepository.js';
import type { RateLimitDecision } from '../middleware/rateLimit.js';
import { ParseFailedError, type ImageParser } from '../providers/parser/index.js';
import {
  downloadTrustedXImage,
  saveLocalImage,
  XChallengeRequiredError,
  XProviderError,
  XRateLimitError,
  type XProvider,
  type XUserContext,
} from '../providers/x/index.js';
import { refreshOAuth2AccessToken } from '../providers/x/xOAuth2.js';

export type EnqueueOutcome =
  | {
      kind: 'cached';
      data: CombatRecordStats;
    }
  | {
      kind: 'queued';
      job: JobStatusResponse;
      deduplicated: boolean;
    }
  | {
      kind: 'invalid_id';
      reason: string;
    }
  | {
      kind: 'login_required';
      activisionId: string;
    }
  | {
      kind: 'rate_limited';
      retryAfterSeconds: number;
    };

class ImageDownloadError extends Error {
  readonly code = 'IMAGE_DOWNLOAD_FAILED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ImageDownloadError';
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SAFE_LOCAL_IMAGE_REGEX = /^\/api\/images\/([a-f0-9-]+\.(?:png|jpg|jpeg|webp))$/i;

export class JobQueueService {
  private static readonly MAX_CONCURRENT_BUCKETS = 4;
  private static readonly MAX_TRACKED_BUCKETS = 500;
  private readonly emitter = new EventEmitter();
  private readonly activeBuckets = new Set<string>();
  private readonly activeWorkerPromises = new Set<Promise<void>>();
  private stopped = false;
  private readonly lastDispatchByBucket = new Map<string, number>();
  private readonly pausedByBucket = new Map<
    string,
    { untilMs: number; code: JobErrorCode; message: string }
  >();

  private pruneBucketMaps(nowMs = Date.now()): void {
    if (this.pausedByBucket.size > JobQueueService.MAX_TRACKED_BUCKETS) {
      for (const [key, entry] of this.pausedByBucket.entries()) {
        if (entry.untilMs <= nowMs) {
          this.pausedByBucket.delete(key);
        }
      }
    }
    if (this.lastDispatchByBucket.size > JobQueueService.MAX_TRACKED_BUCKETS) {
      const ttlMs = Math.max(this.deps.config.xCooldownMs * 2, 10 * 60_000);
      for (const [key, ts] of this.lastDispatchByBucket.entries()) {
        if (nowMs - ts >= ttlMs) {
          this.lastDispatchByBucket.delete(key);
        }
      }
    }
  }

  private async removeReplacedImage(
    previousImagePath: string | null | undefined,
    newFilename: string,
  ): Promise<void> {
    if (!previousImagePath) {
      return;
    }
    const match = SAFE_LOCAL_IMAGE_REGEX.exec(previousImagePath);
    const oldFilename = match?.[1];
    if (!oldFilename || oldFilename === newFilename) {
      return;
    }
    const baseDir = path.resolve(this.deps.config.imagesDir);
    const targetPath = path.resolve(baseDir, oldFilename);
    if (!targetPath.startsWith(baseDir + path.sep)) {
      return;
    }
    try {
      await fs.unlink(targetPath);
    } catch {
      // Ignore if already deleted
    }
  }

  constructor(
    private readonly deps: {
      statsRepo: StatsRepository;
      jobRepo: JobRepository;
      sessionRepo?: SessionRepository;
      xProvider: XProvider;
      imageParser: ImageParser;
      config: AppConfig;
      fetchImpl?: typeof fetch;
    },
  ) {
    this.emitter.setMaxListeners(200);
  }

  start(): void {
    this.stopped = false;
    const recovered = this.deps.jobRepo.recoverInterruptedJobs();
    if (recovered > 0) {
      console.log(`[queue] Recovered ${recovered} interrupted job(s) back to queued state`);
    }
    this.kickWorker();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.emitter.removeAllListeners();
    if (this.activeWorkerPromises.size > 0) {
      await Promise.allSettled([...this.activeWorkerPromises]);
    }
  }

  lookupOrEnqueue(options: {
    rawActivisionId: unknown;
    forceRefresh?: boolean;
    xSessionId?: string | null;
    consumeUncachedQuota: () => RateLimitDecision;
  }): EnqueueOutcome {
    const validation = validateActivisionId(options.rawActivisionId);
    if (!validation.valid) {
      return { kind: 'invalid_id', reason: validation.reason };
    }

    const { canonical, normalized } = validation;

    if (!options.forceRefresh) {
      const fresh = this.deps.statsRepo.getFresh(normalized);
      if (fresh) {
        return { kind: 'cached', data: fresh };
      }
    }

    const existingActive = this.deps.jobRepo.findActiveByNormalizedId(normalized);
    if (existingActive) {
      return {
        kind: 'queued',
        job: this.toJobStatusResponse(existingActive, true),
        deduplicated: true,
      };
    }

    const requiresUserOAuth =
      this.deps.config.xProvider === 'api' && this.deps.config.oauth2Configured;
    let validSessionId: string | null = null;
    if (options.xSessionId && this.deps.sessionRepo) {
      const found = this.deps.sessionRepo.findSessionById(options.xSessionId);
      validSessionId = found ? found.id : null;
    }

    if (requiresUserOAuth && !validSessionId) {
      return {
        kind: 'login_required',
        activisionId: canonical,
      };
    }

    const quota = options.consumeUncachedQuota();
    if (!quota.allowed) {
      return {
        kind: 'rate_limited',
        retryAfterSeconds: quota.retryAfterSeconds,
      };
    }

    const created = this.deps.jobRepo.create({
      id: crypto.randomUUID(),
      normalizedId: normalized,
      activisionId: canonical,
      xSessionId: validSessionId,
    });

    this.kickWorker();

    return {
      kind: 'queued',
      job: this.toJobStatusResponse(created, false),
      deduplicated: false,
    };
  }

  getJobStatus(jobId: string): JobStatusResponse | null {
    const record = this.deps.jobRepo.findById(jobId);
    if (!record) {
      return null;
    }
    return this.toJobStatusResponse(record);
  }

  subscribe(jobId: string, listener: (status: JobStatusResponse) => void): () => void {
    const eventName = `job:${jobId}`;
    this.emitter.on(eventName, listener);
    return () => {
      this.emitter.off(eventName, listener);
    };
  }

  private toJobStatusResponse(record: JobRecord, deduplicated?: boolean): JobStatusResponse {
    const staleData =
      record.state === 'completed' ? null : this.deps.statsRepo.getLatest(record.normalizedId);
    const queuePosition = this.deps.jobRepo.getQueuePosition(record.id);

    return {
      jobId: record.id,
      activisionId: record.activisionId,
      normalizedId: record.normalizedId,
      state: record.state,
      step: record.step,
      queuePosition,
      ...(deduplicated !== undefined ? { deduplicated } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      result: record.result,
      staleData,
      error:
        record.errorCode && record.errorMessage
          ? { code: record.errorCode, message: record.errorMessage }
          : null,
    };
  }

  private emitJobUpdate(record: JobRecord | null): void {
    if (!record) {
      return;
    }
    const payload = this.toJobStatusResponse(record);
    this.emitter.emit(`job:${record.id}`, payload);
  }

  private kickWorker(): void {
    if (this.stopped) {
      return;
    }

    while (
      !this.stopped &&
      this.activeBuckets.size < JobQueueService.MAX_CONCURRENT_BUCKETS
    ) {
      const nextJob = this.deps.jobRepo.findNextQueued(this.activeBuckets);
      if (!nextJob) {
        return;
      }

      const bucketKey = nextJob.xSessionId ?? 'server';
      this.activeBuckets.add(bucketKey);

      const workerPromise = this.runBucketWorker(bucketKey, nextJob).finally(() => {
        this.activeBuckets.delete(bucketKey);
        this.activeWorkerPromises.delete(workerPromise);
        if (!this.stopped) {
          this.kickWorker();
        }
      });
      this.activeWorkerPromises.add(workerPromise);
    }
  }

  private async runBucketWorker(bucketKey: string, initialJob: JobRecord): Promise<void> {
    let currentJob: JobRecord | null = initialJob;

    while (!this.stopped && currentJob) {
      const pause = this.pausedByBucket.get(bucketKey);
      if (pause && pause.untilMs > Date.now()) {
        const failed = this.deps.jobRepo.fail(currentJob.id, pause.code, pause.message);
        this.emitJobUpdate(failed);
      } else {
        if (pause && pause.untilMs <= Date.now()) {
          this.pausedByBucket.delete(bucketKey);
        }

        const lastDispatchAt = this.lastDispatchByBucket.get(bucketKey) ?? 0;
        const elapsedSinceLastX = Date.now() - lastDispatchAt;
        if (lastDispatchAt > 0 && elapsedSinceLastX < this.deps.config.xCooldownMs) {
          await sleep(this.deps.config.xCooldownMs - elapsedSinceLastX);
        }
        if (this.stopped) {
          return;
        }

        await this.executeJob(currentJob, bucketKey);
      }

      if (this.stopped) {
        return;
      }

      const otherActiveBuckets = new Set(this.activeBuckets);
      otherActiveBuckets.delete(bucketKey);
      const candidate = this.deps.jobRepo.findNextQueued(otherActiveBuckets);
      if (candidate && (candidate.xSessionId ?? 'server') === bucketKey) {
        currentJob = candidate;
      } else {
        currentJob = null;
      }
    }
  }

  private async resolveUserContext(job: JobRecord): Promise<XUserContext | undefined> {
    if (!job.xSessionId || !this.deps.sessionRepo) {
      return undefined;
    }

    let session = this.deps.sessionRepo.findSessionById(job.xSessionId);
    if (!session) {
      throw new XProviderError(
        'USER_X_LOGIN_REQUIRED',
        'X login session no longer exists. Sign in with X again',
      );
    }

    const expiresAtMs = Date.parse(session.tokenExpiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + 60_000) {
      if (!session.refreshToken) {
        this.deps.sessionRepo.deleteSession(session.id);
        throw new XProviderError(
          'USER_X_LOGIN_REQUIRED',
          'X login token expired. Sign in with X again',
        );
      }

      try {
        const refreshed = await refreshOAuth2AccessToken({
          clientId: this.deps.config.xOAuth2ClientId,
          clientSecret: this.deps.config.xOAuth2ClientSecret,
          refreshToken: session.refreshToken,
          fetchImpl: this.deps.fetchImpl,
        });
        session =
          this.deps.sessionRepo.updateSessionTokens(session.id, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresInSeconds: refreshed.expiresIn,
          }) ?? session;
      } catch {
        this.deps.sessionRepo.deleteSession(session.id);
        throw new XProviderError(
          'USER_X_LOGIN_REQUIRED',
          'X login token could not be refreshed. Sign in with X again',
        );
      }
    }

    return {
      accessToken: session.accessToken,
      xUserId: session.xUserId,
      xUsername: session.xUsername,
    };
  }

  private async executeJob(job: JobRecord, bucketKey: string): Promise<void> {
    const tStart = Date.now();
    let tPosted = tStart;
    this.pruneBucketMaps(tStart);
    this.lastDispatchByBucket.set(bucketKey, tStart);
    const running = this.deps.jobRepo.markRunning(job.id, 'posting_tweet');
    this.emitJobUpdate(running);

    const fmtSec = (ms: number) => (Math.max(0, ms) / 1000).toFixed(2);

    try {
      const userContext = await this.resolveUserContext(job);

      const media = await this.deps.xProvider.requestCombatRecord(
        job.activisionId,
        {
          onTweetPosted: () => {
            tPosted = Date.now();
            if (this.stopped) return;
            const updated = this.deps.jobRepo.updateStep(job.id, 'waiting_bot_reply');
            this.emitJobUpdate(updated);
          },
          onWaitingForReply: () => {
            if (this.stopped) return;
            const updated = this.deps.jobRepo.updateStep(job.id, 'waiting_bot_reply');
            this.emitJobUpdate(updated);
          },
        },
        userContext,
      );

      const tReplied = Date.now();
      if (this.stopped) return;
      this.emitJobUpdate(this.deps.jobRepo.updateStep(job.id, 'downloading_image'));

      let savedImage: { filename: string; buffer: Buffer; mimeType: string };
      try {
        if (media.localImageBuffer) {
          savedImage = await saveLocalImage(
            media.localImageBuffer,
            media.mimeType ?? 'image/png',
            this.deps.config.imagesDir,
          );
        } else if (media.imageUrl) {
          savedImage = await downloadTrustedXImage(
            media.imageUrl,
            this.deps.config.imagesDir,
            this.deps.fetchImpl,
          );
        } else {
          throw new ImageDownloadError('Bot reply did not include an image attachment');
        }
      } catch (err) {
        if (err instanceof ImageDownloadError) {
          throw err;
        }
        throw new ImageDownloadError(
          err instanceof Error ? err.message : 'Failed to download combat record image',
        );
      }

      const tDownloaded = Date.now();
      this.emitJobUpdate(this.deps.jobRepo.updateStep(job.id, 'parsing_image'));

      const parsed = await this.deps.imageParser.parse({
        buffer: savedImage.buffer,
        mimeType: savedImage.mimeType,
        activisionId: job.activisionId,
      });

      const tParsed = Date.now();
      const fetchedAtMs = tParsed;
      const expiresAtMs = fetchedAtMs + this.deps.config.cacheTtlMinutes * 60_000;

      const stats: CombatRecordStats = {
        activisionId: job.activisionId,
        normalizedId: job.normalizedId,
        parsedActivisionId: parsed.parsedActivisionId,
        season: parsed.season,
        sourceBotHandle: this.deps.config.xBotHandle,
        replyTweetId: media.replyTweetId,
        imageUrl: media.imageUrl ?? null,
        localImagePath: `/api/images/${savedImage.filename}`,
        fetchedAt: new Date(fetchedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        parserProvider: this.deps.imageParser.name,
        xProvider: this.deps.xProvider.name,
        cardLayout: parsed.cardLayout,
        modes: parsed.modes,
      };

      if (this.stopped) return;
      const previousRecord = this.deps.statsRepo.getLatest(job.normalizedId);
      this.deps.statsRepo.upsert(stats);
      await this.removeReplacedImage(previousRecord?.localImagePath, savedImage.filename);
      const completed = this.deps.jobRepo.complete(job.id, stats);
      this.emitJobUpdate(completed);
      console.log(
        `[queue] job ${job.id} (${job.activisionId}) completed in ${fmtSec(tParsed - tStart)}s (post=${fmtSec(tPosted - tStart)}s, reply=${fmtSec(tReplied - tPosted)}s, download=${fmtSec(tDownloaded - tReplied)}s, parse=${fmtSec(tParsed - tDownloaded)}s)`,
      );
    } catch (err) {
      if (this.stopped) return;
      let code: JobErrorCode = 'INTERNAL_ERROR';
      let message = 'Unexpected error processing combat record lookup';

      if (err instanceof XChallengeRequiredError) {
        code = err.code;
        message = err.message;
        this.pausedByBucket.set(bucketKey, {
          untilMs: Date.now() + Math.max(this.deps.config.xCooldownMs, 60_000),
          code,
          message,
        });
      } else if (err instanceof XRateLimitError) {
        code = err.code;
        message = err.message;
        this.pausedByBucket.set(bucketKey, {
          untilMs: Date.now() + Math.max(this.deps.config.xCooldownMs, 60_000),
          code,
          message,
        });
      } else if (err instanceof XProviderError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof ImageDownloadError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof ParseFailedError) {
        code = err.code;
        message = err.message;
      } else if (err instanceof Error) {
        message = err.message;
      }

      console.warn(
        `[queue] job ${job.id} (${job.activisionId}) failed with ${code} in ${fmtSec(Date.now() - tStart)}s: ${message}`,
      );
      const failed = this.deps.jobRepo.fail(job.id, code, message);
      this.emitJobUpdate(failed);
    }
  }
}
