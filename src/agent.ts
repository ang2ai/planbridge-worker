import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { config } from './config';
import { logger } from './logger';

const client = new Anthropic({ apiKey: config.anthropicApiKey });

// 읽기 전용 도구 정의
const READ_ONLY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: '파일 내용을 읽습니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: '읽을 파일의 절대 경로' },
        start_line: { type: 'number', description: '시작 라인 (선택)' },
        end_line: { type: 'number', description: '끝 라인 (선택)' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'glob_files',
    description: '패턴으로 파일을 검색합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'glob 패턴 (예: **/*.tsx)' },
        base_dir: { type: 'string', description: '검색 기준 디렉토리' },
      },
      required: ['pattern', 'base_dir'],
    },
  },
  {
    name: 'grep_files',
    description: '파일에서 텍스트를 검색합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: '검색할 텍스트 또는 정규식' },
        base_dir: { type: 'string', description: '검색 기준 디렉토리' },
        file_pattern: { type: 'string', description: '파일 필터 (예: *.tsx)' },
      },
      required: ['pattern', 'base_dir'],
    },
  },
  {
    name: 'list_directory',
    description: '디렉토리 목록을 조회합니다.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: { type: 'string', description: '디렉토리 경로' },
      },
      required: ['dir_path'],
    },
  },
];

function executeTool(toolName: string, toolInput: Record<string, unknown>): string {
  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = toolInput['file_path'] as string;
        if (!fs.existsSync(filePath)) return `Error: 파일 없음 - ${filePath}`;
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
        const start = (toolInput['start_line'] as number || 1) - 1;
        const end = toolInput['end_line'] as number || lines.length;
        return lines.slice(start, end).join('\n');
      }

      case 'glob_files': {
        const baseDir = toolInput['base_dir'] as string;
        const pattern = toolInput['pattern'] as string;
        if (!fs.existsSync(baseDir)) return `Error: 디렉토리 없음 - ${baseDir}`;
        try {
          const result = execSync(
            `find "${baseDir}" -type f -name "${pattern.replace('**/', '')}" 2>/dev/null || dir /s /b "${path.join(baseDir, pattern.replace('**/', ''))}" 2>nul`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          return result || '파일 없음';
        } catch {
          // Windows fallback
          return `검색 완료 (결과 없음)`;
        }
      }

      case 'grep_files': {
        const searchPattern = toolInput['pattern'] as string;
        const baseDir = toolInput['base_dir'] as string;
        const filePattern = (toolInput['file_pattern'] as string) || '*';
        if (!fs.existsSync(baseDir)) return `Error: 디렉토리 없음 - ${baseDir}`;
        try {
          const result = execSync(
            `grep -r "${searchPattern}" "${baseDir}" --include="${filePattern}" -l 2>/dev/null | head -20`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          return result || '검색 결과 없음';
        } catch {
          return '검색 결과 없음';
        }
      }

      case 'list_directory': {
        const dirPath = toolInput['dir_path'] as string;
        if (!fs.existsSync(dirPath)) return `Error: 디렉토리 없음 - ${dirPath}`;
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        return items
          .map((item) => `${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`)
          .join('\n');
      }

      default:
        return `Error: 알 수 없는 도구 - ${toolName}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function runAgent(systemPrompt: string, userPrompt: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];

  let iterations = 0;
  const maxIterations = 30;

  while (iterations < maxIterations) {
    iterations++;

    const response = await client.messages.create({
      model: config.model,
      max_tokens: 8192,
      system: systemPrompt,
      tools: READ_ONLY_TOOLS,
      messages,
    });

    logger.debug('Agent response', { stopReason: response.stop_reason, iteration: iterations });

    // 응답을 메시지 히스토리에 추가
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      // 최종 텍스트 응답 추출
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock ? (textBlock as Anthropic.TextBlock).text : '';
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const toolResult = executeTool(block.name, block.input as Record<string, unknown>);
          logger.debug('Tool executed', { tool: block.name, resultLength: toolResult.length });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: toolResult,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      break;
    }
  }

  logger.warn('Agent reached max iterations', { iterations });
  // 마지막 텍스트 응답 반환
  const lastAssistantMsg = messages.filter((m) => m.role === 'assistant').pop();
  if (lastAssistantMsg && Array.isArray(lastAssistantMsg.content)) {
    const textBlock = lastAssistantMsg.content.find((b) => (b as Anthropic.TextBlock).type === 'text');
    if (textBlock) return (textBlock as Anthropic.TextBlock).text;
  }
  return '분석 완료 (최대 반복 도달)';
}
