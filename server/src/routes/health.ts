import { Router, type Request, type Response } from 'express';
import type { HealthResponse, ParserProviderKind, XProviderKind } from '@mw4trackstats/shared';
import type { AppConfig } from '../config.js';
import type { JobRepository } from '../db/repository.js';
import type { XProvider } from '../providers/x/index.js';

export function createHealthRouter(deps: {
  config: AppConfig;
  jobRepo: JobRepository;
  xProvider: XProvider;
  activeParserProvider: ParserProviderKind;
}): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    const xStatus = await deps.xProvider.healthCheck();
    const payload: HealthResponse = {
      ok: true,
      xProvider: deps.xProvider.name as XProviderKind,
      parserProvider: deps.activeParserProvider,
      geminiModel: deps.config.geminiModel,
      cacheTtlMinutes: deps.config.cacheTtlMinutes,
      queuePending: deps.jobRepo.countPending(),
      xReady: xStatus.ready,
      xDetail: xStatus.detail,
      oauth2Configured: deps.config.oauth2Configured,
    };
    res.json(payload);
  });

  return router;
}
