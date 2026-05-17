import { describe, it, expect, vi } from 'vitest';
import { JsonlLLMCallLogger } from '../../../src/infrastructure/llm/JsonlLLMCallLogger.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import type { LLMCallRecord } from '../../../src/domain/services/ILLMCallLogger.js';

function makeRecord(overrides: Partial<LLMCallRecord> = {}): LLMCallRecord {
  return {
    stage: 'triage',
    timestamp: '2026-05-17T10:00:00.000Z',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    prompt_hash: 'abc123',
    input_artifacts: ['tickets.json', 'artifacts/knowledge_corpus.json'],
    output_artifact: 'artifacts/triage.json',
    ticket_ids: ['T-1001'],
    chunk_ids_included: ['payments-001', 'support_sla-001'],
    ...overrides,
  };
}

describe('JsonlLLMCallLogger', () => {
  it('calls appendLine on the artifact repository', async () => {
    const repo: IArtifactRepository = {
      write: vi.fn(),
      read: vi.fn(),
      exists: vi.fn(),
      appendLine: vi.fn().mockResolvedValue(undefined),
    };
    const logger = new JsonlLLMCallLogger(repo);

    await logger.log(makeRecord());

    expect(repo.appendLine).toHaveBeenCalledOnce();
    expect(repo.appendLine).toHaveBeenCalledWith('llm_calls.jsonl', expect.any(String));
  });

  it('serialises the record as a single-line JSON string', async () => {
    const lines: string[] = [];
    const repo: IArtifactRepository = {
      write: vi.fn(),
      read: vi.fn(),
      exists: vi.fn(),
      appendLine: vi.fn().mockImplementation(async (_: string, line: string) => {
        lines.push(line);
      }),
    };
    const logger = new JsonlLLMCallLogger(repo);
    const record = makeRecord();

    await logger.log(record);

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.stage).toBe('triage');
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.ticket_ids).toEqual(['T-1001']);
    expect(parsed.chunk_ids_included).toEqual(['payments-001', 'support_sla-001']);
  });

  it('produces a line with no newline characters (valid JSONL)', async () => {
    const lines: string[] = [];
    const repo: IArtifactRepository = {
      write: vi.fn(),
      read: vi.fn(),
      exists: vi.fn(),
      appendLine: vi.fn().mockImplementation(async (_: string, line: string) => {
        lines.push(line);
      }),
    };
    const logger = new JsonlLLMCallLogger(repo);

    await logger.log(makeRecord());

    expect(lines[0]).not.toContain('\n');
  });

  it('logs multiple calls as separate lines', async () => {
    const lines: string[] = [];
    const repo: IArtifactRepository = {
      write: vi.fn(),
      read: vi.fn(),
      exists: vi.fn(),
      appendLine: vi.fn().mockImplementation(async (_: string, line: string) => {
        lines.push(line);
      }),
    };
    const logger = new JsonlLLMCallLogger(repo);

    await logger.log(makeRecord({ stage: 'triage', ticket_ids: ['T-1001'] }));
    await logger.log(makeRecord({ stage: 'response_drafting', ticket_ids: ['T-1002'] }));

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).stage).toBe('triage');
    expect(JSON.parse(lines[1]!).stage).toBe('response_drafting');
  });

  it('preserves all required LLMCallRecord fields', async () => {
    const lines: string[] = [];
    const repo: IArtifactRepository = {
      write: vi.fn(), read: vi.fn(), exists: vi.fn(),
      appendLine: vi.fn().mockImplementation(async (_: string, l: string) => lines.push(l)),
    };
    const logger = new JsonlLLMCallLogger(repo);
    const record = makeRecord();

    await logger.log(record);

    const parsed = JSON.parse(lines[0]!);
    const requiredFields: (keyof LLMCallRecord)[] = [
      'stage', 'timestamp', 'provider', 'model', 'prompt_hash',
      'input_artifacts', 'output_artifact', 'ticket_ids', 'chunk_ids_included',
    ];
    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
  });
});
