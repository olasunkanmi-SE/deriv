import { describe, it, expect, beforeEach } from 'vitest';
import { DraftResponsesUseCase } from '../../../src/application/use-cases/DraftResponsesUseCase.js';
import { SpyLLMCallLogger } from '../../stubs/SpyLLMCallLogger.js';
import { StubLLMService } from '../../stubs/StubLLMService.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { RetrievalResult } from '../../../src/domain/entities/RetrievalResult.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

const CLOCK = { now: () => '2026-05-17T10:00:00.000Z' };

const VALID_DRAFT_RESPONSE = JSON.stringify({
  response_text: 'Thank you for contacting us. Your withdrawal is under review.',
  tone: 'empathetic',
  contains_policy_claims: true,
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

function makeTriage(ticketId: string): TriageResult {
  return {
    ticket_id: ticketId,
    category: 'withdrawal_delay',
    urgency: 'high',
    sentiment: 'negative',
    resolution_mode: 'needs_human_review',
    recommended_queue: 'payments_ops',
    reasoning_summary: 'Customer waiting beyond standard window.',
    source_chunk_ids: ['payments-001'],
  };
}

function makeChunk(id: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: 'Section',
    text: 'Verified customers have withdrawals reviewed within 24 hours.',
    character_count: 60,
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

describe('DraftResponsesUseCase', () => {
  let logger: SpyLLMCallLogger;

  beforeEach(() => {
    logger = new SpyLLMCallLogger();
  });

  it('throws PipelineStateError when state is not TRIAGE_COMPLETE', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    await expect(
      useCase.execute([], [], [], [], PipelineState.RETRIEVAL_COMPLETE),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to RESPONSE_DRAFTED', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(result.nextState).toBe(PipelineState.RESPONSE_DRAFTED);
  });

  it('returns one draft per ticket', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeTriage('T-1001'), makeTriage('T-1002')],
      [makeRetrieval('T-1001', ['payments-001']), makeRetrieval('T-1002', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]?.ticket_id).toBe('T-1001');
    expect(result.drafts[1]?.ticket_id).toBe('T-1002');
  });

  it('parses all fields from the LLM response', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    const draft = result.drafts[0]!;
    expect(draft.response_text).toBe('Thank you for contacting us. Your withdrawal is under review.');
    expect(draft.tone).toBe('empathetic');
    expect(draft.contains_policy_claims).toBe(true);
    expect(draft.source_chunk_ids).toEqual(['payments-001']);
  });

  it('keeps only chunk IDs present in the retrieval result (prevents hallucinated IDs)', async () => {
    const response = JSON.stringify({
      ...JSON.parse(VALID_DRAFT_RESPONSE),
      source_chunk_ids: ['payments-001', 'HALLUCINATED-999'],
    });
    const llm = new StubLLMService({ response_drafting: response }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(result.drafts[0]?.source_chunk_ids).toEqual(['payments-001']);
    expect(result.drafts[0]?.source_chunk_ids).not.toContain('HALLUCINATED-999');
  });

  it('preserves empty source_chunk_ids when LLM returns none (no implicit fallback)', async () => {
    const responseWithoutIds = JSON.stringify({
      response_text: 'Your case is under review.',
      tone: 'professional',
      contains_policy_claims: false,
      source_chunk_ids: [],
    });
    const llm = new StubLLMService({ response_drafting: responseWithoutIds }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    // LLM explicitly returned no citations — honour that; do not inject all retrieved chunks
    expect(result.drafts[0]?.source_chunk_ids).toEqual([]);
  });

  it('uses safe defaults when LLM returns invalid JSON', async () => {
    const llm = new StubLLMService({ response_drafting: 'not-json' }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.TRIAGE_COMPLETE,
    );

    const draft = result.drafts[0]!;
    expect(draft.response_text).toBe('Our team is reviewing your case and will follow up shortly.');
    expect(draft.tone).toBe('professional');
  });

  it('skips tickets without a matching triage result', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-NO-TRIAGE')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0]?.ticket_id).toBe('T-1001');
  });

  it('writes response_drafts.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, artifactRepo);

    await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(artifactRepo.write).toHaveBeenCalledWith('response_drafts.json', expect.any(Array));
  });

  it('makes one LLM call per ticket', async () => {
    const llm = new StubLLMService({ response_drafting: VALID_DRAFT_RESPONSE }, logger, CLOCK);
    const useCase = new DraftResponsesUseCase(llm, makeArtifactRepo());

    await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002'), makeTicket('T-1003')],
      [makeTriage('T-1001'), makeTriage('T-1002'), makeTriage('T-1003')],
      [
        makeRetrieval('T-1001', []),
        makeRetrieval('T-1002', []),
        makeRetrieval('T-1003', []),
      ],
      [],
      PipelineState.TRIAGE_COMPLETE,
    );

    expect(logger.records).toHaveLength(3);
    expect(logger.records.every((r) => r.stage === 'response_drafting')).toBe(true);
  });
});
