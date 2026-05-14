import { initPool, closePool } from './db';
import { processNextItem } from './worker';
import { config } from './config';
import { logger } from './logger';

let pollTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function poll(): Promise<void> {
  if (shuttingDown) return;

  try {
    const processed = await processNextItem();
    if (processed) {
      // 처리한 게 있으면 바로 다음 폴링 (큐에 더 있을 수 있음)
      if (!shuttingDown) {
        setImmediate(poll);
        return;
      }
    }
  } catch (err) {
    logger.error('폴링 오류', { error: err instanceof Error ? err.message : String(err) });
  }

  if (!shuttingDown) {
    pollTimer = setTimeout(poll, config.pollIntervalMs);
  }
}

async function main(): Promise<void> {
  logger.info('PlanBridge Worker 시작', {
    workerId: config.workerId,
    pollInterval: config.pollIntervalMs,
    model: config.model,
  });

  await initPool();

  // 시작하자마자 첫 폴링
  await poll();
}

async function shutdown(): Promise<void> {
  logger.info('워커 종료 중...');
  shuttingDown = true;

  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  await closePool();
  logger.info('워커 종료 완료');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  logger.error('워커 시작 실패', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
