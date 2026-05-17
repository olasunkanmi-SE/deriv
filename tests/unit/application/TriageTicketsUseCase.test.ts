import { describe, it, expect, beforeEach } from 'vitest';
import { TriageTicketsUseCase } from '../../../src/application/use-cases/TriageTicketsUseCase.js';
import { SpyLLMCallLogger } from '../../stubs/SpyLLMCallLogger.js';
import { StubLLMService } from '../../stubs/StubLLMService.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { RetrievalResult } from '../../../src/domain/entities/RetrievalResult.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

const CLOCK = { now: () => '2026-05-17T10:00:00.000Z' };

const VALID_TRIAGE_RESPONSE = JSON.stringify({
  category: 'withdrawal_delay',
  urgency: 'high',
  sentiment: 'negative',
  resolution_mode: 'needs_human_review',
  recommended_queue: 'payments_ops',
  reasoning_summary: 'Customer waiting 3 days beyond standard review window.',
  source_chunk_ids: ['payments-001'],
});

function makeTicket(id: string, lowConf = false): Ticket {
  return {
    ticket_id: id,
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending',
    message: 'My withdrawal is pending.',
    retrieval_query: 'withdrawal pending',
    low_retrieval_confidence: lowConf,
  };
}

function makeChunk(id: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: 'Section',
    text: 'Relevant policy text.',
    character_count: 20,
    content_hash: 'hash',
  };
}

function makeRetrieval(ticketId: string, chunkIds: string[]): RetrievalResult {
  return {
    ticket_id: ticketId,
    query_text: 'withdrawal pending',
    selected_chunk_ids: chunkIds,
    selection_reason: 'Top BM25 results',
    omitted_relevant_risk: null,
  };
}

function makeArtifactRepo(): IArtifactRepository {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    appendLine: vi.fn(),
  };
}

describe('TriageTicketsUseCase', () => {
  let logger: SpyLLMCallLogger;

  beforeEach(() => {
    logger = new SpyLLMCallLogger();
  });

  it('throws PipelineStateError when state is not RETRIEVAL_COMPLETE', async () => {
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    await expect(
      useCase.execute([], [], [], PipelineState.TICKETS_NORMALISED),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to TRIAGE_COMPLETE', async () => {
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());
    const ticket = makeTicket('T-1001');

    const result = await useCase.execute(
      [ticket],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(result.nextState).toBe(PipelineState.TRIAGE_COMPLETE);
  });

  it('returns one TriageResult per ticket with correct ticket_id', async () => {
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeRetrieval('T-1001', ['payments-001']), makeRetrieval('T-1002', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(result.triageResults).toHaveLength(2);
    expect(result.triageResults[0]?.ticket_id).toBe('T-1001');
    expect(result.triageResults[1]?.ticket_id).toBe('T-1002');
  });

  it('parses all vocabulary fields from the LLM response', async () => {
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    const triage = result.triageResults[0]!;
    expect(triage.category).toBe('withdrawal_delay');
    expect(triage.urgency).toBe('high');
    expect(triage.sentiment).toBe('negative');
    expect(triage.resolution_mode).toBe('needs_human_review');
    expect(triage.recommended_queue).toBe('payments_ops');
  });

  it('keeps only chunk IDs present in the retrieval result (prevents hallucinated IDs)', async () => {
    const response = JSON.stringify({
      ...JSON.parse(VALID_TRIAGE_RESPONSE),
      source_chunk_ids: ['payments-001', 'HALLUCINATED-999'],
    });
    const llm = new StubLLMService({ triage: response }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(result.triageResults[0]?.source_chunk_ids).toEqual(['payments-001']);
    expect(result.triageResults[0]?.source_chunk_ids).not.toContain('HALLUCINATED-999');
  });

  it('forces resolution_mode to needs_human_review when low_retrieval_confidence is true', async () => {
    const highConfResponse = JSON.stringify({
      ...JSON.parse(VALID_TRIAGE_RESPONSE),
      resolution_mode: 'reply_only',
    });
    const llm = new StubLLMService({ triage: highConfResponse }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001', true)],  // low_retrieval_confidence = true
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(result.triageResults[0]?.resolution_mode).toBe('needs_human_review');
  });

  it('uses safe defaults when LLM returns invalid JSON', async () => {
    const llm = new StubLLMService({ triage: 'not-json-at-all' }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    const triage = result.triageResults[0]!;
    expect(triage.category).toBe('general_query');
    expect(triage.urgency).toBe('medium');
    expect(triage.resolution_mode).toBe('needs_human_review');
  });

  it('uses safe defaults when vocabulary values are out of range', async () => {
    const badVocabResponse = JSON.stringify({
      category: 'UNKNOWN_CATEGORY',
      urgency: 'super_critical',
      sentiment: 'furious',
      resolution_mode: 'auto_fix',
      recommended_queue: 'alien_team',
      reasoning_summary: 'Bad output.',
      source_chunk_ids: [],
    });
    const llm = new StubLLMService({ triage: badVocabResponse }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    const triage = result.triageResults[0]!;
    expect(triage.category).toBe('general_query');
    expect(triage.urgency).toBe('medium');
    expect(triage.sentiment).toBe('neutral');
    expect(triage.resolution_mode).toBe('needs_human_review');
    expect(triage.recommended_queue).toBe('customer_support');
  });

  it('writes triage.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, artifactRepo);

    await useCase.execute(
      [makeTicket('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(artifactRepo.write).toHaveBeenCalledWith('triage.json', expect.any(Array));
  });

  it('makes one LLM call per ticket', async () => {
    const llm = new StubLLMService({ triage: VALID_TRIAGE_RESPONSE }, logger, CLOCK);
    const useCase = new TriageTicketsUseCase(llm, makeArtifactRepo());

    await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002'), makeTicket('T-1003')],
      [
        makeRetrieval('T-1001', []),
        makeRetrieval('T-1002', []),
        makeRetrieval('T-1003', []),
      ],
      [],
      PipelineState.RETRIEVAL_COMPLETE,
    );

    expect(logger.records).toHaveLength(3);
    expect(logger.records.every((r) => r.stage === 'triage')).toBe(true);
  });
});
