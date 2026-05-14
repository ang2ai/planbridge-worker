import dotenv from 'dotenv';
dotenv.config();

export const config = {
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
