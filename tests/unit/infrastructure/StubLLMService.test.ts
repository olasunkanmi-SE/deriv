import { describe, it, expect, beforeEach } from 'vitest';
import { StubLLMService } from '../../stubs/StubLLMService.js';
import { SpyLLMCallLogger } from '../../stubs/SpyLLMCallLogger.js';
import type { LLMRequest } from '../../../src/domain/services/ILLMService.js';
import type { IClock } from '../../../src/domain/services/IClock.js';

const FIXED_CLOCK: IClock = { now: () => '2026-05-17T10:00:00.000Z' };

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    prompt: 'Classify this ticket as JSON.',
    stage: 'triage',
    ticketIds: ['T-1001'],
    chunkIds: ['payments-001'],
    inputArtifacts: ['tickets.json', 'artifacts/knowledge_corpus.json'],
    outputArtifact: 'artifacts/triage.json',
    ...overrides,
  };
}

describe('StubLLMService', () => {
  let logger: SpyLLMCallLogger;

  beforeEach(() => {
    logger = new SpyLLMCallLogger();
  });

  it('returns the stage-level fixture response', async () => {
    const stub = new StubLLMService({ triage: '{"category":"withdrawal_delay"}' }, logger, FIXED_CLOCK);
    const result = await stub.complete(makeRequest({ stage: 'triage' }));
    expect(result).toBe('{"category":"withdrawal_delay"}');
  });

  it('returns a ticket-specific response when the fixture is a record', async () => {
    const stub = new StubLLMService(
      { triage: { 'T-1001': '{"urgency":"high"}', 'T-1002': '{"urgency":"low"}' } },
      logger, FIXED_CLOCK,
    );

    const r1 = await stub.complete(makeRequest({ ticketIds: ['T-1001'] }));
    const r2 = await stub.complete(makeRequest({ ticketIds: ['T-1002'] }));

    expect(r1).toBe('{"urgency":"high"}');
    expect(r2).toBe('{"urgency":"low"}');
  });

  it('returns "{}" when no fixture exists for the stage', async () => {
    const stub = new StubLLMService({}, logger, FIXED_CLOCK);
    const result = await stub.complete(makeRequest({ stage: 'triage' }));
    expect(result).toBe('{}');
  });

  it('returns "{}" when ticket ID is not found in the stage fixture map', async () => {
    const stub = new StubLLMService({ triage: { 'T-9999': '{"x":1}' } }, logger, FIXED_CLOCK);
    const result = await stub.complete(makeRequest({ ticketIds: ['T-0001'] }));
    expect(result).toBe('{}');
  });

  it('calls the logger once per complete() invocation', async () => {
    const stub = new StubLLMService({ triage: '{}' }, logger, FIXED_CLOCK);
    await stub.complete(makeRequest());
    await stub.complete(makeRequest({ stage: 'response_drafting' }));
    expect(logger.records).toHaveLength(2);
  });

  it('log record contains all required fields with correct values', async () => {
    const stub = new StubLLMService({ triage: '{}' }, logger, FIXED_CLOCK);
    await stub.complete(makeRequest());

    const record = logger.records[0]!;
    expect(record.stage).toBe('triage');
    expect(record.provider).toBe('stub');
    expect(record.model).toBe('stub');
    expect(record.timestamp).toBe('2026-05-17T10:00:00.000Z');
    expect(record.ticket_ids).toEqual(['T-1001']);
    expect(record.chunk_ids_included).toEqual(['payments-001']);
    expect(record.prompt_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.input_artifacts).toContain('tickets.json');
    expect(record.output_artifact).toBe('artifacts/triage.json');
  });

  it('prompt_hash is stable — same prompt produces same hash', async () => {
    const stub = new StubLLMService({ triage: '{}' }, logger, FIXED_CLOCK);
    const req = makeRequest({ prompt: 'Exact same prompt text.' });
    await stub.complete(req);
    await stub.complete(req);

    expect(logger.records[0]!.prompt_hash).toBe(logger.records[1]!.prompt_hash);
  });

  it('prompt_hash differs for different prompts', async () => {
    const stub = new StubLLMService({ triage: '{}' }, logger, FIXED_CLOCK);
    await stub.complete(makeRequest({ prompt: 'Prompt A' }));
    await stub.complete(makeRequest({ prompt: 'Prompt B' }));

    expect(logger.records[0]!.prompt_hash).not.toBe(logger.records[1]!.prompt_hash);
  });

  it('tracks completed requests for inspection', async () => {
    const stub = new StubLLMService({ triage: '{}', response_drafting: '{}' }, logger, FIXED_CLOCK);
    await stub.complete(makeRequest({ stage: 'triage', ticketIds: ['T-1001'] }));
    await stub.complete(makeRequest({ stage: 'response_drafting', ticketIds: ['T-1002'] }));

    const calls = stub.getCompletedRequests();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.stage).toBe('triage');
    expect(calls[1]?.stage).toBe('response_drafting');
  });
});
