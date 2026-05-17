import { RetrievalConfig } from '../../domain/services/IRetrievalService.js';

export type { RetrievalConfig };

export interface LLMConfig {
  anthropicApiKey: string;
  triageModel: string;
  mainModel: string;
}

export function loadRetrievalConfig(): RetrievalConfig {
  return {
    topK: parseIntEnv('RETRIEVAL_TOP_K', 4),
    minScore: parseFloatEnv('RETRIEVAL_MIN_SCORE', 0.1),
    confidenceThreshold: parseFloatEnv('RETRIEVAL_CONFIDENCE_THRESHOLD', 0.2),
    epsilon: 0.05,
  };
}

export function loadLLMConfig(): LLMConfig {
  const key = process.env['ANTHROPIC_API_KEY'];
  if (!key) {
    throw new Error(
      '[EnvConfig] ANTHROPIC_API_KEY is not set.\n' +
      'Set it in your environment before running the pipeline:\n' +
      '  export ANTHROPIC_API_KEY=your_key_here',
    );
  }
  return {
    anthropicApiKey: key,
    triageModel: process.env['TRIAGE_MODEL'] ?? 'claude-haiku-4-5-20251001',
    mainModel: process.env['MAIN_MODEL'] ?? 'claude-sonnet-4-6',
  };
}

function parseIntEnv(name: string, fallback: number): number {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function parseFloatEnv(name: string, fallback: number): number {
  const v = parseFloat(process.env[name] ?? '');
  return Number.isFinite(v) ? v : fallback;
}
