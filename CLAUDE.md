# PlanBridge Worker (AI 분석 워커)

## 역할
- Oracle 큐(PB_ANALYSIS_QUEUE)에서 작업 가져오기
- Git Mirror 소스코드 읽기 (읽기 전용)
- Claude Agent SDK로 AI 분석 실행
- 분석 결과 Oracle 저장 + API 서버에 완료 알림

## 기술 스택
- Node.js + TypeScript
- Claude Agent SDK (@anthropic-ai/claude-agent-sdk)
- Oracle DB 연동

## 환경변수
- ANTHROPIC_API_KEY: Claude API 키
- ORACLE_URL / ORACLE_USER / ORACLE_PASSWORD
- REPOS_BASE_PATH: Git Mirror 소스 경로 (/repos) - 읽기 전용
- API_SERVER_URL: planbridge-api 주소
- POLL_INTERVAL_MS: 큐 폴링 간격 (기본 5000)

## 실행
```bash
npm install
npm run start
```

## 설계 문서 (우선순위 순)
@docs/planbridge-final-architecture.md
@docs/planbridge-mapping-design.md
@docs/planbridge-usecases.md

## 문서 우선순위 규칙
- 전체 아키텍처/방향 → planbridge-final-architecture.md 우선
- 분석 워커 상세 설계 → planbridge-final-architecture.md 섹션 3 기준
- 문서 간 충돌 시 → planbridge-final-architecture.md 최종 기준

## 개발 원칙
- allowed_tools: Read, Glob, Bash(읽기전용)만 허용
- Edit/Write 절대 금지 (Git Mirror 보호)
- 소스코드는 /repos/{projectId}/ 경로에서만 읽기
- 최대 3회 재시도 후 FAILED 처리
