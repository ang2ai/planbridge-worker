import { runAgent } from '../agent';
import { getProjectPolicies } from '../db';
import type { QueueItem, ProjectInfo, AnalysisResult } from '../types';
import { logger } from '../logger';

export async function analyzeNewPlan(
  item: QueueItem,
  project: ProjectInfo
): Promise<AnalysisResult> {
  const payload = JSON.parse(item.requestPayload);
  const { planDescription, screenTitle } = payload;

  const repoPath = project.repoLocalPath || `/repos/${project.projectId}`;
  const policies = await getProjectPolicies(project.projectId);

  const systemPrompt = `당신은 프론트엔드 아키텍처 전문 AI 분석가입니다.
신규 화면 기획을 지원하여 기존 컴포넌트/정책 재사용 방안을 제안합니다.

제약 사항:
- 파일 읽기만 허용 (쓰기/수정 금지)
- 소스 경로: ${repoPath}
- JSON 형식으로 결과를 반환하세요

JSON 출력 형식:
{
  "summary": "신규 화면 분석 요약",
  "planningDocument": "기획서 마크다운 내용",
  "todos": [
    {
      "title": "개발 태스크",
      "prompt": "상세 구현 프롬프트",
      "targetFiles": [],
      "complexity": "SIMPLE|MODERATE|COMPLEX"
    }
  ],
  "policyUpdates": []
}`;

  const policiesText = policies.length > 0
    ? policies.slice(0, 20).map((p) => `[${p.policyType}] ${p.policyTitle}`).join('\n')
    : '등록된 정책 없음';

  const userPrompt = `신규 화면 기획을 분석해주세요.

## 프로젝트 정보
- 이름: ${project.projectName}
- 프레임워크: ${project.framework}
- 소스 경로: ${repoPath}

## 신규 화면 설명
${planDescription}

${screenTitle ? `화면 제목: ${screenTitle}` : ''}

## 기존 정책 목록 (${policies.length}개)
${policiesText}

## 분석 지시
1. ${repoPath}/src 또는 ${repoPath}/app 디렉토리에서 기존 페이지 구조를 파악하세요
2. components/ 디렉토리에서 재사용 가능한 컴포넌트를 탐색하세요
3. 기존 정책과 비교하여 재사용/충돌 분석을 하세요
4. 화면 구조를 제안하고 개발 TODO를 생성하세요
5. 기획서 초안을 마크다운으로 작성하세요
6. JSON 형식으로 결과를 반환하세요`;

  logger.info('신규 화면 기획 분석 시작', { projectId: project.projectId, screenTitle });

  const agentResult = await runAgent(systemPrompt, userPrompt);

  let analysisResult: AnalysisResult;
  try {
    const jsonMatch = agentResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      analysisResult = JSON.parse(jsonMatch[0]);
    } else {
      analysisResult = { summary: agentResult, todos: [], planningDocument: agentResult };
    }
  } catch {
    analysisResult = { summary: agentResult, todos: [], planningDocument: agentResult };
  }

  return analysisResult;
}
