import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateActivisionId, type StatsLookupResponse } from '@mw4trackstats/shared';
import type { AppConfig } from '../config.js';
import type { StatsRepository } from '../db/repository.js';
import { extractClientIp, type IpRateLimiter } from '../middleware/rateLimit.js';
import type { JobQueueService } from '../queue/jobQueue.js';
import {
  extractSessionIdFromRequest,
  getAllowedOrigins,
  isCrossSitePostBlocked,
} from './auth.js';

const LookupRequestSchema = z.object({
  activisionId: z.string(),
  forceRefresh: z.boolean().optional().default(false),
});

const PurgeRequestSchema = z.object({
  activisionId: z.string(),
});

const SAFE_IMAGE_FILENAME_REGEX = /^[a-f0-9-]+\.(png|jpg|jpeg|webp)$/i;
const SAFE_LOCAL_IMAGE_PATH_REGEX = /^\/api\/images\/([a-f0-9-]+\.(?:png|jpg|jpeg|webp))$/i;

export function createStatsRouter(deps: {
  config: AppConfig;
  statsRepo: StatsRepository;
  jobQueue: JobQueueService;
  readLimiter: IpRateLimiter;
  uncachedLimiter: IpRateLimiter;
}): Router {
  const router = Router();
  const allowedOrigins = getAllowedOrigins(deps.config);

  router.post('/stats', deps.readLimiter.middleware, (req: Request, res: Response) => {
    if (isCrossSitePostBlocked(req, allowedOrigins)) {
      res.status(403).json({
        error: {
          code: 'X_AUTH_REQUIRED',
          message: 'Cross-origin POST request rejected',
        },
      });
      return;
    }

    const parsedBody = LookupRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: 'Request body must include activisionId string',
        },
      });
      return;
    }

    const clientIp = extractClientIp(req);
    const xSessionId = extractSessionIdFromRequest(req);
    const outcome = deps.jobQueue.lookupOrEnqueue({
      rawActivisionId: parsedBody.data.activisionId,
      forceRefresh: parsedBody.data.forceRefresh,
      xSessionId,
      consumeUncachedQuota: () => deps.uncachedLimiter.checkAndConsume(clientIp),
    });

    if (outcome.kind === 'invalid_id') {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: outcome.reason,
        },
      });
      return;
    }

    if (outcome.kind === 'login_required') {
      res.status(401).json({
        error: {
          code: 'USER_X_LOGIN_REQUIRED',
          message: 'Sign in with your X account to look up uncached player stats',
        },
      });
      return;
    }

    if (outcome.kind === 'rate_limited') {
      res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many live X queries from this IP. Try again in ${outcome.retryAfterSeconds} seconds`,
          retryAfterSeconds: outcome.retryAfterSeconds,
        },
      });
      return;
    }

    if (outcome.kind === 'cached') {
      const payload: StatsLookupResponse = {
        status: 'cached',
        activisionId: outcome.data.activisionId,
        data: outcome.data,
      };
      res.status(200).json(payload);
      return;
    }

    const payload: StatsLookupResponse = {
      status: 'queued',
      jobId: outcome.job.jobId,
      activisionId: outcome.job.activisionId,
      step: outcome.job.step,
      queuePosition: outcome.job.queuePosition,
      deduplicated: outcome.deduplicated,
      staleData: outcome.job.staleData,
    };
    res.status(202).json(payload);
  });

  router.post('/stats/purge', deps.readLimiter.middleware, (req: Request, res: Response) => {
    if (isCrossSitePostBlocked(req, allowedOrigins)) {
      res.status(403).json({
        error: {
          code: 'X_AUTH_REQUIRED',
          message: 'Cross-origin POST request rejected',
        },
      });
      return;
    }

    const parsedBody = PurgeRequestSchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: 'Request body must include activisionId string',
        },
      });
      return;
    }

    const validation = validateActivisionId(parsedBody.data.activisionId);
    if (!validation.valid) {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: validation.reason,
        },
      });
      return;
    }

    const clientIp = extractClientIp(req);
    const quota = deps.uncachedLimiter.checkAndConsume(clientIp);
    if (!quota.allowed) {
      res.setHeader('Retry-After', String(quota.retryAfterSeconds));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: `Too many requests from this IP. Try again in ${quota.retryAfterSeconds} seconds`,
          retryAfterSeconds: quota.retryAfterSeconds,
        },
      });
      return;
    }

    const deletedRecord = deps.statsRepo.deleteByNormalizedId(validation.normalized);
    if (deletedRecord?.localImagePath) {
      const match = SAFE_LOCAL_IMAGE_PATH_REGEX.exec(deletedRecord.localImagePath);
      const filename = match?.[1];
      if (filename) {
        const baseDir = path.resolve(deps.config.imagesDir);
        const targetPath = path.resolve(baseDir, filename);
        if (targetPath.startsWith(baseDir + path.sep) && fs.existsSync(targetPath)) {
          try {
            fs.unlinkSync(targetPath);
          } catch {
            // Ignore unlink race
          }
        }
      }
    }

    res.status(200).json({
      deleted: deletedRecord !== null,
      activisionId: deletedRecord?.activisionId ?? validation.canonical,
    });
  });

  router.get('/stats/recent', deps.readLimiter.middleware, (_req: Request, res: Response) => {
    const items = deps.statsRepo.listRecent(8);
    res.json({ items });
  });

  router.get(
    '/stats/player/:activisionId',
    deps.readLimiter.middleware,
    (req: Request, res: Response) => {
      const validation = validateActivisionId(req.params.activisionId);
      if (!validation.valid) {
        res.status(400).json({
          error: {
            code: 'INVALID_ID',
            message: validation.reason,
          },
        });
        return;
      }

      const fresh = deps.statsRepo.getFresh(validation.normalized);
      if (fresh) {
        res.json({ found: true, fresh: true, data: fresh });
        return;
      }

      const latest = deps.statsRepo.getLatest(validation.normalized);
      if (latest) {
        res.json({ found: true, fresh: false, data: latest });
        return;
      }

      res.status(404).json({ found: false, data: null });
    },
  );

  router.get('/stats/jobs/:jobId', deps.readLimiter.middleware, (req: Request, res: Response) => {
    const jobId = String(req.params.jobId ?? '');
    const status = deps.jobQueue.getJobStatus(jobId);
    if (!status) {
      res.status(404).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Lookup job not found',
        },
      });
      return;
    }

    res.json(status);
  });

  router.get(
    '/stats/jobs/:jobId/stream',
    deps.readLimiter.middleware,
    (req: Request, res: Response) => {
      const jobId = String(req.params.jobId ?? '');
      const initialStatus = deps.jobQueue.getJobStatus(jobId);
      if (!initialStatus) {
        res.status(404).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Lookup job not found',
          },
        });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const sendFrame = (payload: unknown) => {
        res.write(`event: status\ndata: ${JSON.stringify(payload)}\n\n`);
      };

      sendFrame(initialStatus);

      if (initialStatus.state === 'completed' || initialStatus.state === 'failed') {
        res.end();
        return;
      }

      let closed = false;
      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        clearInterval(pingInterval);
        unsubscribe();
      };

      const unsubscribe = deps.jobQueue.subscribe(jobId, (update) => {
        if (closed) {
          return;
        }
        sendFrame(update);
        if (update.state === 'completed' || update.state === 'failed') {
          cleanup();
          res.end();
        }
      });

      const pingInterval = setInterval(() => {
        if (!closed) {
          res.write(': keepalive\n\n');
        }
      }, 15000);

      req.on('close', cleanup);
    },
  );

  router.get('/images/:filename', (req: Request, res: Response) => {
    const filename = String(req.params.filename ?? '');
    if (!SAFE_IMAGE_FILENAME_REGEX.test(filename)) {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid image filename',
        },
      });
      return;
    }

    const baseDir = path.resolve(deps.config.imagesDir);
    const resolvedPath = path.resolve(baseDir, filename);

    if (!resolvedPath.startsWith(baseDir + path.sep)) {
      res.status(400).json({
        error: {
          code: 'INVALID_ID',
          message: 'Invalid image path',
        },
      });
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      res.status(404).json({
        error: {
          code: 'IMAGE_DOWNLOAD_FAILED',
          message: 'Image not found',
        },
      });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(resolvedPath);
  });

  return router;
}
