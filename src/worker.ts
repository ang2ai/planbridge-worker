import axios from 'axios';
import {
  fetchNextQueueItem,
  markQueueProcessing,
  markQueueCompleted,
  markQueueFailed,
  getProjectInfo,
} from './db';
import { analyzeChangeRequest } from './analyzers/changeRequestAnalyzer';
import { analyzeNewPlan } from './analyzers/newPlanAnalyzer';
import { analyzeConflictCheck } from './analyzers/conflictCheckAnalyzer';
import { config } from './config';
import { logger } from './logger';
import type { QueueItem, ProjectInfo } from './types';

let isRunning = false;

export async function processNextItem(): Promise<boolean> {
  if (isRunning) return false;

  const item = await fetchNextQueueItem();
  if (!item) return false;

  isRunning = true;
  logger.info('큐 아이템 처리 시작', {
    queueId: item.queueId,
    analysisType: item.analysisType,
    projectId: item.projectId,
  });

  try {
    await markQueueProcessing(item.queueId);

    const project = await getProjectInfo(item.projectId);
    if (!project) {
      throw new Error(`프로젝트 없음: ${item.projectId}`);
    }

    const result = await dispatch(item, project);
    const resultJson = JSON.stringify(result);

    await markQueueCompleted(item.queueId, resultJson);
    await notifyApiServer(item, result);

    logger.info('큐 아이템 처리 완료', { queueId: item.queueId });
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('큐 아이템 처리 실패', { queueId: item.queueId, error: errorMsg });
    await markQueueFailed(item.queueId, errorMsg);
    return false;
  } finally {
    isRunning = false;
  }
}

async function dispatch(item: QueueItem, project: ProjectInfo) {
  switch (item.analysisType) {
    case 'CHANGE_REQUEST':
      return analyzeChangeRequest(item, project);
    case 'NEW_PLAN':
      return analyzeNewPlan(item, project);
    case 'CONFLICT_CHECK':
      return analyzeConflictCheck(item, project);
    default:
      throw new Error(`알 수 없는 분석 유형: ${item.analysisType}`);
  }
}

async function notifyApiServer(item: QueueItem, result: unknown): Promise<void> {
  try {
    await axios.post(
      `${config.apiServerUrl}/api/analysis/completed`,
      {
        queueId: item.queueId,
        projectId: item.projectId,
        analysisType: item.analysisType,
        requestId: item.requestId,
        result,
      },
      { timeout: 5000 }
    );
  } catch (err) {
    // 알림 실패는 치명적이지 않음 — 결과는 이미 DB에 저장됨
    logger.warn('API 서버 알림 실패', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
