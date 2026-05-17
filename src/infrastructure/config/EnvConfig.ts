export interface RetrievalConfig {
  topK: number;
  minScore: number;
  confidenceThreshold: number;
  epsilon: number;
}

export interface LLMConfig {
  anthropicApiKey: string;
  triageModel: string;
  mainModel: string;
}

export function loadRetrievalConfig(): RetrievalConfig {
  return {
    topK: parseInt(process.env['RETRIEVAL_TOP_K'] ?? '4', 10),
    minScore: parseFloat(process.env['RETRIEVAL_MIN_SCORE'] ?? '0.1'),
    confidenceThreshold: parseFloat(process.env['RETRIEVAL_CONFIDENCE_THRESHOLD'] ?? '0.2'),
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
