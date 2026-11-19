import { createApp } from './app.js';
import { loadConfig, loadRootEnv } from './config.js';
import { openDatabase } from './db/database.js';
import { SqliteJobRepository, SqliteStatsRepository } from './db/repository.js';
import { SqliteSessionRepository } from './db/sessionRepository.js';
import { createImageParser } from './providers/parser/index.js';
import { createXProvider } from './providers/x/index.js';
import { JobQueueService } from './queue/jobQueue.js';

loadRootEnv();
const config = loadConfig();

const db = openDatabase(config.databasePath);
const statsRepo = new SqliteStatsRepository(db);
const jobRepo = new SqliteJobRepository(db);
const sessionRepo = new SqliteSessionRepository(db);
const xProvider = createXProvider(config);
const imageParser = createImageParser(config);

const jobQueue = new JobQueueService({
  statsRepo,
  jobRepo,
  sessionRepo,
  xProvider,
  imageParser,
  config,
});

jobQueue.start();

const app = createApp({
  config,
  statsRepo,
  jobRepo,
  sessionRepo,
  xProvider,
  activeParserProvider: imageParser.name,
  jobQueue,
});

const server = app.listen(config.port, config.host, () => {
  console.log(
    `[server] MW4Trackstats API listening at http://${config.host}:${config.port} (X=${xProvider.name}, parser=${imageParser.name}, model=${config.geminiModel})`,
  );
});

function shutdown(signal: string): void {
  console.log(`[server] Received ${signal}, shutting down cleanly...`);
  server.close(() => {
    void jobQueue.stop().finally(() => {
      db.close();
      process.exit(0);
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
