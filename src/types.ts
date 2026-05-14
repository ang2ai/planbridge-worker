export interface QueueItem {
  queueId: string;
  projectId: string;
  analysisType: 'CHANGE_REQUEST' | 'NEW_PLAN' | 'CONFLICT_CHECK';
  requestId: string | null;
  requestPayload: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  retryCount: number;
  maxRetries: number;
}

export interface ProjectInfo {
  projectId: string;
  projectName: string;
  repoLocalPath: string | null;
  repoBranch: string;
  baseUrl: string | null;
  framework: string;
}

export interface ComponentInfo {
  componentId: string;
  pbId: string;
  componentName: string;
  componentType: string;
  elementTag: string | null;
  elementRole: string | null;
  currentProps: string | null;
  currentText: string | null;
  currentSpec: string | null;
  treePath: string | null;
  reactHierarchy: string | null;
}

export interface PolicyInfo {
  policyId: string;
  policyType: string;
  policyTitle: string;
  policyContent: string;
  scope: string;
  currentVersion: number;
}

export interface ChangeRequestInfo {
  requestId: string;
  title: string;
  description: string;
  currentState: string | null;
  desiredState: string | null;
  priority: string;
  status: string;
}

export interface TodoItem {
  title: string;
  prompt: string;
  targetFiles: string[];
  complexity: 'SIMPLE' | 'MODERATE' | 'COMPLEX';
  sortOrder: number;
  dependencies?: string;
}

export interface AnalysisResult {
  summary: string;
  todos?: TodoItem[];
  policyUpdates?: Array<{
    policyId?: string;
    action: 'CREATE' | 'UPDATE';
    policyType: string;
    policyTitle: string;
    policyContent: string;
  }>;
  impactedComponents?: string[];
  conflicts?: Array<{
    description: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
  }>;
  planningDocument?: string;
}
