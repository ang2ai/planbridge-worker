import { runAgent } from '../agent';
import {
  getComponentInfo,
  getPoliciesForComponent,
  getChangeRequestInfo,
  updateChangeRequestAnalysis,
  saveTodoItems,
} from '../db';
import type { QueueItem, ProjectInfo, AnalysisResult } from '../types';
import { logger } from '../logger';

export async function analyzeChangeRequest(
  item: QueueItem,
  project: ProjectInfo
): Promise<AnalysisResult> {
  const payload = JSON.parse(item.requestPayload);
  const { componentId, requestId: payloadRequestId } = payload;
  const requestId = item.requestId || payloadRequestId;

  if (!componentId || !requestId) {
    throw new Error('componentId 또는 requestId 누락');
  }

  const [component, policies, changeRequest] = await Promise.all([
    getComponentInfo(componentId),
    getPoliciesForComponent(componentId),
    getChangeRequestInfo(requestId),
  ]);

  if (!component) throw new Error(`컴포넌트 없음: ${componentId}`);
  if (!changeRequest) throw new Error(`변경 요청 없음: ${requestId}`);

  const repoPath = project.repoLocalPath || `/repos/${project.projectId}`;

  const systemPrompt = `당신은 소프트웨어 개발 전문 AI 분석가입니다.
기획자의 변경 요청을 분석하여 개발팀을 위한 구체적인 TODO 목록을 생성합니다.

제약 사항:
- 파일 읽기만 허용 (쓰기/수정 금지)
- 소스 경로: ${repoPath}
- 분석 후 반드시 JSON 형식으로 결과를 반환하세요

JSON 출력 형식:
{
  "summary": "분석 요약 (2-3문장)",
  "todos": [
    {
      "title": "TODO 제목",
      "prompt": "Claude Code에 전달할 상세 프롬프트",
      "targetFiles": ["파일 경로 목록"],
      "complexity": "SIMPLE|MODERATE|COMPLEX"
    }
  ],
  "policyUpdates": [
    {
      "action": "CREATE|UPDATE",
      "policyType": "BUSINESS_RULE|UI_SPEC|INTERACTION|VALIDATION|TEXT_CONTENT|API_SPEC",
      "policyTitle": "정책 제목",
      "policyContent": "정책 내용"
    }
  ]
}`;

  const policiesText = policies.length > 0
    ? policies.map((p) => `[${p.policyType}] ${p.policyTitle}\n${p.policyContent}`).join('\n\n')
    : '등록된 정책 없음';

  const userPrompt = `다음 변경 요청을 분석하고 TODO 목록을 생성해주세요.

## 프로젝트 정보
- 이름: ${project.projectName}
- 프레임워크: ${project.framework}
- 소스 경로: ${repoPath}

## 대상 컴포넌트
- ID: ${component.pbId}
- 이름: ${component.componentName}
- 타입: ${component.componentType}
- 역할: ${component.elementRole || '미지정'}
- 현재 스펙: ${component.currentSpec || '없음'}
- 컴포넌트 계층: ${component.treePath || '없음'}

## 현재 적용 정책
${policiesText}

## 변경 요청
- 제목: ${changeRequest.title}
- 우선순위: ${changeRequest.priority}
- 상세 내용:
${changeRequest.description}

${changeRequest.desiredState ? `## 원하는 결과\n${changeRequest.desiredState}` : ''}

## 분석 지시
1. ${repoPath} 경로에서 ${component.componentName} 관련 파일을 찾으세요
2. 실제 소스 코드를 읽고 현재 구현 상태를 파악하세요
3. import 관계와 의존 컴포넌트를 확인하세요
4. 변경 요청을 구현하기 위한 구체적인 TODO를 생성하세요
5. 결과를 JSON 형식으로 반환하세요`;

  logger.info('변경 요청 분석 시작', { requestId, componentName: component.componentName });

  const agentResult = await runAgent(systemPrompt, userPrompt);

  // JSON 추출
  let analysisResult: AnalysisResult;
  try {
    const jsonMatch = agentResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysisResult = JSON.parse(jsonMatch[0]);
    } else {
      analysisResult = { summary: agentResult, todos: [] };
    }
  } catch {
    analysisResult = { summary: agentResult, todos: [] };
  }

  // DB 저장
  await updateChangeRequestAnalysis(requestId, JSON.stringify(analysisResult), 'READY');

  if (analysisResult.todos && analysisResult.todos.length > 0) {
    await saveTodoItems(requestId, analysisResult.todos);
    logger.info('TODO 저장 완료', { requestId, count: analysisResult.todos.length });
  }

  return analysisResult;
}
