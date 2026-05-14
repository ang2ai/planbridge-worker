import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // AI 연동 설정
  // 현재: Anthropic API 사용 (ANTHROPIC_API_KEY 필요)
  // 변경 시: Azure OpenAI로 교체 가능
  //   AZURE_OPENAI_ENDPOINT=https://회사명.openai.azure.com
  //   AZURE_OPENAI_API_KEY=발급받은키
  //   AZURE_OPENAI_DEPLOYMENT=gpt-4o   ← Azure에서 등록한 모델 배포명
  //   AZURE_OPENAI_API_VERSION=2025-01-01-preview
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  oracle: {
    connectString: process.env.ORACLE_URL || 'localhost:1521/XEPDB1',
    user: process.env.ORACLE_USER || 'planbridge',
    password: process.env.ORACLE_PASSWORD || 'password',
    poolMin: 2,
    poolMax: 10,
    poolIncrement: 1,
  },
  reposBasePath: process.env.REPOS_BASE_PATH || '/repos',
  apiServerUrl: process.env.API_SERVER_URL || 'http://localhost:8080',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '5000', 10),
  workerId: `worker-${process.pid}`,
  model: 'claude-opus-4-7',
};
