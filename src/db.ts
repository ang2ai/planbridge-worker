import oracledb from 'oracledb';
import { config } from './config';
import { logger } from './logger';
import type { QueueItem, ProjectInfo, ComponentInfo, PolicyInfo, ChangeRequestInfo, TodoItem } from './types';

let pool: oracledb.Pool | null = null;

export async function initPool(): Promise<void> {
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  pool = await oracledb.createPool(config.oracle);
  logger.info('Oracle connection pool created');
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close(10);
    pool = null;
    logger.info('Oracle connection pool closed');
  }
}

async function withConnection<T>(fn: (conn: oracledb.Connection) => Promise<T>): Promise<T> {
  const conn = await pool!.getConnection();
  try {
    return await fn(conn);
  } finally {
    await conn.close();
  }
}

export async function fetchNextQueueItem(): Promise<QueueItem | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT QUEUE_ID, PROJECT_ID, ANALYSIS_TYPE, REQUEST_ID,
              REQUEST_PAYLOAD, STATUS, RETRY_COUNT, MAX_RETRIES
       FROM PB_ANALYSIS_QUEUE
       WHERE STATUS = 'QUEUED'
         AND RETRY_COUNT < MAX_RETRIES
       ORDER BY CREATED_AT ASC
       FETCH FIRST 1 ROW ONLY`,
      {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );

    if (!result.rows || result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      queueId: row['QUEUE_ID'] as string,
      projectId: row['PROJECT_ID'] as string,
      analysisType: row['ANALYSIS_TYPE'] as QueueItem['analysisType'],
      requestId: row['REQUEST_ID'] as string | null,
      requestPayload: row['REQUEST_PAYLOAD'] as string,
      status: row['STATUS'] as QueueItem['status'],
      retryCount: row['RETRY_COUNT'] as number,
      maxRetries: row['MAX_RETRIES'] as number,
    };
  });
}

export async function markQueueProcessing(queueId: string): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE PB_ANALYSIS_QUEUE
       SET STATUS = 'PROCESSING', WORKER_ID = :workerId, STARTED_AT = SYSTIMESTAMP
       WHERE QUEUE_ID = :queueId`,
      { workerId: config.workerId, queueId },
      { autoCommit: true }
    );
  });
}

export async function markQueueCompleted(queueId: string, result: string): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE PB_ANALYSIS_QUEUE
       SET STATUS = 'COMPLETED', RESULT = :result, COMPLETED_AT = SYSTIMESTAMP
       WHERE QUEUE_ID = :queueId`,
      { result, queueId },
      { autoCommit: true }
    );
  });
}

export async function markQueueFailed(queueId: string, errorMessage: string): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE PB_ANALYSIS_QUEUE
       SET STATUS = CASE WHEN RETRY_COUNT + 1 >= MAX_RETRIES THEN 'FAILED' ELSE 'QUEUED' END,
           RETRY_COUNT = RETRY_COUNT + 1,
           ERROR_MESSAGE = :errorMessage
       WHERE QUEUE_ID = :queueId`,
      { errorMessage: errorMessage.substring(0, 4000), queueId },
      { autoCommit: true }
    );
  });
}

export async function getProjectInfo(projectId: string): Promise<ProjectInfo | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT PROJECT_ID, PROJECT_NAME, REPO_LOCAL_PATH, REPO_BRANCH, BASE_URL, FRAMEWORK
       FROM PB_PROJECT WHERE PROJECT_ID = :projectId`,
      { projectId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows || result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      projectId: row['PROJECT_ID'] as string,
      projectName: row['PROJECT_NAME'] as string,
      repoLocalPath: row['REPO_LOCAL_PATH'] as string | null,
      repoBranch: row['REPO_BRANCH'] as string,
      baseUrl: row['BASE_URL'] as string | null,
      framework: row['FRAMEWORK'] as string,
    };
  });
}

export async function getComponentInfo(componentId: string): Promise<ComponentInfo | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT COMPONENT_ID, PB_ID, COMPONENT_NAME, COMPONENT_TYPE,
              ELEMENT_TAG, ELEMENT_ROLE, CURRENT_PROPS, CURRENT_TEXT,
              CURRENT_SPEC, TREE_PATH, REACT_HIERARCHY
       FROM PB_COMPONENT WHERE COMPONENT_ID = :componentId`,
      { componentId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows || result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      componentId: row['COMPONENT_ID'] as string,
      pbId: row['PB_ID'] as string,
      componentName: row['COMPONENT_NAME'] as string,
      componentType: row['COMPONENT_TYPE'] as string,
      elementTag: row['ELEMENT_TAG'] as string | null,
      elementRole: row['ELEMENT_ROLE'] as string | null,
      currentProps: row['CURRENT_PROPS'] as string | null,
      currentText: row['CURRENT_TEXT'] as string | null,
      currentSpec: row['CURRENT_SPEC'] as string | null,
      treePath: row['TREE_PATH'] as string | null,
      reactHierarchy: row['REACT_HIERARCHY'] as string | null,
    };
  });
}

export async function getPoliciesForComponent(componentId: string): Promise<PolicyInfo[]> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT p.POLICY_ID, p.POLICY_TYPE, p.POLICY_TITLE, p.POLICY_CONTENT,
              p.SCOPE, p.CURRENT_VERSION
       FROM PB_POLICY p
       LEFT JOIN PB_POLICY_LINK pl ON p.POLICY_ID = pl.POLICY_ID
       WHERE (pl.COMPONENT_ID = :componentId OR p.COMPONENT_ID = :componentId)
         AND p.STATUS = 'ACTIVE'
       ORDER BY p.POLICY_TYPE, p.CURRENT_VERSION DESC`,
      { componentId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows || []).map((row) => ({
      policyId: row['POLICY_ID'] as string,
      policyType: row['POLICY_TYPE'] as string,
      policyTitle: row['POLICY_TITLE'] as string,
      policyContent: row['POLICY_CONTENT'] as string,
      scope: row['SCOPE'] as string,
      currentVersion: row['CURRENT_VERSION'] as number,
    }));
  });
}

export async function getChangeRequestInfo(requestId: string): Promise<ChangeRequestInfo | null> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT REQUEST_ID, TITLE, DESCRIPTION, CURRENT_STATE, DESIRED_STATE, PRIORITY, STATUS
       FROM PB_CHANGE_REQUEST WHERE REQUEST_ID = :requestId`,
      { requestId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!result.rows || result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      requestId: row['REQUEST_ID'] as string,
      title: row['TITLE'] as string,
      description: row['DESCRIPTION'] as string,
      currentState: row['CURRENT_STATE'] as string | null,
      desiredState: row['DESIRED_STATE'] as string | null,
      priority: row['PRIORITY'] as string,
      status: row['STATUS'] as string,
    };
  });
}

export async function updateChangeRequestAnalysis(
  requestId: string,
  aiAnalysis: string,
  status: string
): Promise<void> {
  await withConnection(async (conn) => {
    await conn.execute(
      `UPDATE PB_CHANGE_REQUEST
       SET AI_ANALYSIS = :aiAnalysis, STATUS = :status, UPDATED_AT = SYSTIMESTAMP
       WHERE REQUEST_ID = :requestId`,
      { aiAnalysis, status, requestId },
      { autoCommit: true }
    );
  });
}

export async function saveTodoItems(requestId: string, todos: TodoItem[]): Promise<void> {
  await withConnection(async (conn) => {
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      await conn.execute(
        `INSERT INTO PB_TODO_ITEM
           (TODO_ID, REQUEST_ID, TITLE, PROMPT, TARGET_FILES, COMPLEXITY, SORT_ORDER, DEPENDENCIES)
         VALUES
           (SYS_GUID(), :requestId, :title, :prompt, :targetFiles, :complexity, :sortOrder, :dependencies)`,
        {
          requestId,
          title: todo.title.substring(0, 500),
          prompt: todo.prompt,
          targetFiles: JSON.stringify(todo.targetFiles || []),
          complexity: todo.complexity || 'MODERATE',
          sortOrder: i,
          dependencies: todo.dependencies || null,
        },
        { autoCommit: false }
      );
    }
    await conn.commit();
  });
}

export async function getProjectPolicies(projectId: string): Promise<PolicyInfo[]> {
  return withConnection(async (conn) => {
    const result = await conn.execute<Record<string, unknown>>(
      `SELECT POLICY_ID, POLICY_TYPE, POLICY_TITLE, POLICY_CONTENT, SCOPE, CURRENT_VERSION
       FROM PB_POLICY
       WHERE PROJECT_ID = :projectId AND STATUS = 'ACTIVE'
       ORDER BY POLICY_TYPE`,
      { projectId },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (result.rows || []).map((row) => ({
      policyId: row['POLICY_ID'] as string,
      policyType: row['POLICY_TYPE'] as string,
      policyTitle: row['POLICY_TITLE'] as string,
      policyContent: row['POLICY_CONTENT'] as string,
      scope: row['SCOPE'] as string,
      currentVersion: row['CURRENT_VERSION'] as number,
    }));
  });
}
