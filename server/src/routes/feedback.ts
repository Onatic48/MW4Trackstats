import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { FeedbackSubmitResponse } from '@mw4trackstats/shared';
import type { AppConfig } from '../config.js';
import type { FeedbackRepository } from '../db/feedbackRepository.js';
import type { SessionRepository } from '../db/sessionRepository.js';
import { extractClientIp, type IpRateLimiter } from '../middleware/rateLimit.js';
import { appendFeedbackToGoogleSheet } from '../providers/feedback/googleSheetsWebhook.js';
import {
  extractSessionIdFromRequest,
  getAllowedOrigins,
  isCrossSitePostBlocked,
} from './auth.js';

const FeedbackBodySchema = z.object({
  message: z.string().trim().min(5).max(1500),
  locale: z.enum(['en', 'tr']).optional().default('en'),
});

export function createFeedbackRouter(deps: {
  config: AppConfig;
  sessionRepo: SessionRepository;
  feedbackRepo: FeedbackRepository;
  readLimiter: IpRateLimiter;
  feedbackLimiter: IpRateLimiter;
  fetchImpl?: typeof fetch;
}): Router {
  const router = Router();
  const allowedOrigins = getAllowedOrigins(deps.config);

  router.post(
    '/feedback',
    deps.readLimiter.middleware,
    async (req: Request, res: Response) => {
      if (isCrossSitePostBlocked(req, allowedOrigins)) {
        res.status(403).json({
          error: {
            code: 'X_AUTH_REQUIRED',
            message: 'Cross-origin POST request rejected',
          },
        });
        return;
      }

      const sessionId = extractSessionIdFromRequest(req);
      const session = sessionId ? deps.sessionRepo.findSessionById(sessionId) : null;
      if (!session) {
        res.status(401).json({
          error: {
            code: 'USER_X_LOGIN_REQUIRED',
            message: 'Sign in with X to submit feedback',
          },
        });
        return;
      }

      const clientIp = extractClientIp(req);
      const userQuota = deps.feedbackLimiter.checkAndConsume(`xuser:${session.xUserId}`);
      if (!userQuota.allowed) {
        res.setHeader('Retry-After', String(userQuota.retryAfterSeconds));
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many feedback submissions. Try again in ${userQuota.retryAfterSeconds} seconds`,
            retryAfterSeconds: userQuota.retryAfterSeconds,
          },
        });
        return;
      }

      const ipQuota = deps.feedbackLimiter.checkAndConsume(`ip:${clientIp}`);
      if (!ipQuota.allowed) {
        res.setHeader('Retry-After', String(ipQuota.retryAfterSeconds));
        res.status(429).json({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many feedback submissions from this IP. Try again in ${ipQuota.retryAfterSeconds} seconds`,
            retryAfterSeconds: ipQuota.retryAfterSeconds,
          },
        });
        return;
      }

      const parsed = FeedbackBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_ID',
            message: 'Feedback must be between 5 and 1500 characters',
          },
        });
        return;
      }

      const entry = deps.feedbackRepo.create({
        xUserId: session.xUserId,
        xUsername: session.xUsername,
        message: parsed.data.message,
        locale: parsed.data.locale,
      });

      if (!deps.config.googleSheetsWebhookUrl) {
        const payload: FeedbackSubmitResponse = {
          ok: true,
          id: entry.id,
          syncedToSheets: false,
        };
        res.status(201).json(payload);
        return;
      }

      try {
        await appendFeedbackToGoogleSheet({
          webhookUrl: deps.config.googleSheetsWebhookUrl,
          webhookSecret: deps.config.googleSheetsWebhookSecret,
          entry,
          fetchImpl: deps.fetchImpl,
        });
        deps.feedbackRepo.markSynced(entry.id, true, null);
        const payload: FeedbackSubmitResponse = {
          ok: true,
          id: entry.id,
          syncedToSheets: true,
        };
        res.status(201).json(payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Sheets sync failed';
        console.warn(`[feedback] Google Sheets sync failed for ${entry.id}:`, msg);
        deps.feedbackRepo.markSynced(entry.id, false, msg);
        res.status(502).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Saved locally, but Google Sheets sync failed',
          },
        });
      }
    },
  );

  return router;
}
