import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import { validateActivisionId, type ParserProviderKind } from '@mw4trackstats/shared';
import type { AppConfig } from './config.js';
import type { FeedbackRepository } from './db/feedbackRepository.js';
import type { JobRepository, StatsRepository } from './db/repository.js';
import type { SessionRepository } from './db/sessionRepository.js';
import { buildOEmbedPayload, renderIndexHtmlWithEmbedMeta } from './embeds/ogMeta.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createIpRateLimiter, type IpRateLimiter } from './middleware/rateLimit.js';
import type { XProvider } from './providers/x/index.js';
import type { JobQueueService } from './queue/jobQueue.js';
import { createAuthRoutes } from './routes/auth.js';
import { createFeedbackRouter } from './routes/feedback.js';
import { createHealthRouter } from './routes/health.js';
import { createStatsRouter } from './routes/stats.js';

export interface AppDependencies {
  config: AppConfig;
  statsRepo: StatsRepository;
  jobRepo: JobRepository;
  sessionRepo?: SessionRepository;
  feedbackRepo?: FeedbackRepository;
  xProvider: XProvider;
  activeParserProvider: ParserProviderKind;
  jobQueue: JobQueueService;
  readLimiter?: IpRateLimiter;
  uncachedLimiter?: IpRateLimiter;
  feedbackLimiter?: IpRateLimiter;
  authFetchImpl?: typeof fetch;
  feedbackFetchImpl?: typeof fetch;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxy ? 1 : false);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  const allowedOrigins = deps.config.clientOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const primaryPublicOrigin = (allowedOrigins[0] ?? 'http://localhost:5173').replace(/\/+$/, '');

  app.use(
    cors({
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  const readLimiter =
    deps.readLimiter ??
    createIpRateLimiter({
      windowMs: 60_000,
      maxRequests: deps.config.rateLimitMaxReads,
    });

  const uncachedLimiter =
    deps.uncachedLimiter ??
    createIpRateLimiter({
      windowMs: deps.config.rateLimitWindowMs,
      maxRequests: deps.config.rateLimitMaxUncached,
    });

  const feedbackLimiter =
    deps.feedbackLimiter ??
    createIpRateLimiter({
      windowMs: 15 * 60_000,
      maxRequests: 5,
    });

  if (deps.sessionRepo) {
    const auth = createAuthRoutes({
      config: deps.config,
      sessionRepo: deps.sessionRepo,
      fetchImpl: deps.authFetchImpl,
    });
    app.use('/api', auth.apiRouter);
    app.get('/callback', (req, res) => {
      void auth.callbackHandler(req, res);
    });
  }

  if (deps.sessionRepo && deps.feedbackRepo) {
    app.use(
      '/api',
      createFeedbackRouter({
        config: deps.config,
        sessionRepo: deps.sessionRepo,
        feedbackRepo: deps.feedbackRepo,
        readLimiter,
        feedbackLimiter,
        fetchImpl: deps.feedbackFetchImpl,
      }),
    );
  }

  app.use(
    '/api',
    createHealthRouter({
      config: deps.config,
      jobRepo: deps.jobRepo,
      xProvider: deps.xProvider,
      activeParserProvider: deps.activeParserProvider,
    }),
  );

  app.get('/api/oembed', readLimiter.middleware, (req, res) => {
    const rawId = typeof req.query.id === 'string' ? req.query.id : null;
    const validation = rawId ? validateActivisionId(rawId) : null;
    const stats = validation?.valid ? deps.statsRepo.getLatest(validation.normalized) : null;
    res.json(
      buildOEmbedPayload({
        stats,
        activisionId: validation?.valid ? validation.canonical : null,
        publicOrigin: primaryPublicOrigin,
      }),
    );
  });

  app.use(
    '/api',
    createStatsRouter({
      config: deps.config,
      statsRepo: deps.statsRepo,
      jobQueue: deps.jobQueue,
      readLimiter,
      uncachedLimiter,
    }),
  );

  if (deps.config.serveClientDist) {
    const clientDistDir = path.resolve(deps.config.repoRoot, 'client', 'dist');
    const indexHtml = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      const indexHtmlTemplate = fs.readFileSync(indexHtml, 'utf8');
      app.use(express.static(clientDistDir, { index: false }));
      app.use((req, res, next) => {
        if (req.method === 'GET' && !req.path.startsWith('/api')) {
          const rawId = typeof req.query.id === 'string' ? req.query.id : null;
          const validation = rawId ? validateActivisionId(rawId) : null;
          const queriedId = validation?.valid ? validation.canonical : null;
          const stats = validation?.valid
            ? deps.statsRepo.getLatest(validation.normalized)
            : null;
          const html = renderIndexHtmlWithEmbedMeta({
            templateHtml: indexHtmlTemplate,
            stats,
            queriedId,
            publicOrigin: primaryPublicOrigin,
          });
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(html);
          return;
        }
        next();
      });
    }
  }

  app.use(errorHandler);
  return app;
}
