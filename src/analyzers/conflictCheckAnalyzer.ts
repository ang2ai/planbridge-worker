import { runAgent } from '../agent';
import { getComponentInfo, getPoliciesForComponent } from '../db';
import type { QueueItem, ProjectInfo, AnalysisResult } from '../types';
import { logger } from '../logger';

export async function analyzeConflictCheck(
  item: QueueItem,
  project: ProjectInfo
): Promise<AnalysisResult> {
  const payload = JSON.parse(item.requestPayload);
  const { policyId, componentIds, proposedChange } = payload;

  const repoPath = project.repoLocalPath || `/repos/${project.projectId}`;

  // 연관 컴포넌트 정책 조회
  const componentPolicies = await Promise.all(
    (componentIds || []).map((id: string) => getPoliciesForComponent(id))
  );
  const allPolicies = componentPolicies.flat();

  const systemPrompt = `당신은 정책 충돌 감지 전문 AI입니다.
정책 변경이 기존 정책 및 소스 코드에 미치는 영향을 분석합니다.

제약 사항:
- 파일 읽기만 허용
- 소스 경로: ${repoPath}
- JSON 형식으로 결과 반환

JSON 출력 형식:
{
  "summary": "충돌 분석 요약",
  "conflicts": [
    {
      "description": "충돌 내용",
      "severity": "LOW|MEDIUM|HIGH"
    }
  ],
  "impactedComponents": ["컴포넌트 ID 목록"],
  "todos": []
}`;

  const policiesText = allPolicies.slice(0, 10)
    .map((p) => `[${p.policyType}] ${p.policyTitle}: ${p.policyContent.substring(0, 200)}`)
    .join('\n\n');

  const userPrompt = `정책 변경에 대한 충돌 분석을 수행해주세요.

## 프로젝트: ${project.projectName}
## 소스 경로: ${repoPath}

## 변경하려는 정책 ID: ${policyId}
## 제안된 변경 내용:
${proposedChange}

## 연관 컴포넌트의 현재 정책 (${allPolicies.length}개):
${policiesText}

## 분석 지시
1. 제안된 변경이 기존 정책과 충돌하는지 확인하세요
2. 영향받는 컴포넌트의 소스 코드를 분석하세요
3. 실제 코드 구현과의 불일치를 탐지하세요
4. 충돌 심각도를 LOW/MEDIUM/HIGH로 평가하세요
5. JSON으로 결과를 반환하세요`;

  logger.info('정책 충돌 분석 시작', { policyId, componentCount: componentIds?.length });

  const agentResult = await runAgent(systemPrompt, userPrompt);

  let analysisResult: AnalysisResult;
  try {
    const jsonMatch = agentResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysisResult = JSON.parse(jsonMatch[0]);
    } else {
      analysisResult = { summary: agentResult, conflicts: [], todos: [] };
    }
  } catch {
    analysisResult = { summary: agentResult, conflicts: [], todos: [] };
  }

  return analysisResult;
}
