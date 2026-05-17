import { describe, it, expect, beforeEach } from 'vitest';
import { ValidateGroundingUseCase } from '../../../src/application/use-cases/ValidateGroundingUseCase.js';
import { SpyLLMCallLogger } from '../../stubs/SpyLLMCallLogger.js';
import { StubLLMService } from '../../stubs/StubLLMService.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { RetrievalResult } from '../../../src/domain/entities/RetrievalResult.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

const CLOCK = { now: () => '2026-05-17T10:00:00.000Z' };

const EMPTY_LLM_VALIDATIONS = JSON.stringify([]);

const LLM_GROUNDING_ISSUE = JSON.stringify([
  {
    artifact: 'response_drafts.json',
    claim: 'Response guarantees 24-hour resolution',
    grounded: false,
    source_type: 'knowledge_base',
    source_chunk_ids: [],
    issue: 'No chunk supports a guarantee of 24-hour resolution',
    recommended_fix: 'Soften the language to reflect a review process, not a guarantee',
  },
]);

function makeTicket(id: string): Ticket {
  return {
    ticket_id: id,
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending',
    message: 'My withdrawal is pending.',
    retrieval_query: 'withdrawal pending',
    low_retrieval_confidence: false,
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
    reasoning_summary: 'Customer waiting beyond window.',
    source_chunk_ids: ['payments-001'],
  };
}

function makeDraft(ticketId: string): ResponseDraft {
  return {
    ticket_id: ticketId,
    response_text: 'Your withdrawal review takes 24 hours for verified customers.',
    tone: 'professional',
    contains_policy_claims: true,
    source_chunk_ids: ['payments-001'],
  };
}

function makePlan(ticketId: string): ActionPlan {
  return {
    ticket_id: ticketId,
    actions: [
      {
        action_id: `A-${ticketId}-1`,
        description: 'Escalate withdrawal to payments team for manual review and resolution.',
        owner_queue: 'payments_ops',
        priority: 'P1',
        depends_on: [],
      },
    ],
    handoff_note: `Customer ${ticketId} has a pending withdrawal. Payments team must review urgently.`,
  };
}

function makeChunk(id: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: 'Withdrawals',
    text: 'Verified customers have withdrawals reviewed within 24 hours.',
    character_count: 61,
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

describe('ValidateGroundingUseCase', () => {
  let logger: SpyLLMCallLogger;

  beforeEach(() => {
    logger = new SpyLLMCallLogger();
  });

  it('throws PipelineStateError when state is not ACTION_PLAN_CREATED', async () => {
    const llm = new StubLLMService({ grounding_validation: EMPTY_LLM_VALIDATIONS }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());

    await expect(
      useCase.execute([], [], [], [], [], [], PipelineState.RESPONSE_DRAFTED),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to GROUNDING_VALIDATED', async () => {
    const llm = new StubLLMService({ grounding_validation: EMPTY_LLM_VALIDATIONS }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.ACTION_PLAN_CREATED,
    );

    expect(result.nextState).toBe(PipelineState.GROUNDING_VALIDATED);
  });

  it('combines deterministic and LLM validation results', async () => {
    const llm = new StubLLMService({ grounding_validation: LLM_GROUNDING_ISSUE }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.ACTION_PLAN_CREATED,
    );

    const llmIssue = result.validations.find((v) => v.claim === 'Response guarantees 24-hour resolution');
    expect(llmIssue).toBeDefined();
    expect(llmIssue?.grounded).toBe(false);
  });

  it('writes grounding_validation.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const llm = new StubLLMService({ grounding_validation: EMPTY_LLM_VALIDATIONS }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, artifactRepo);

    await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.ACTION_PLAN_CREATED,
    );

    expect(artifactRepo.write).toHaveBeenCalledWith('grounding_validation.json', expect.any(Array));
  });

  it('catches a draft citing a non-existent chunk (deterministic)', async () => {
    const llm = new StubLLMService({ grounding_validation: EMPTY_LLM_VALIDATIONS }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());
    const badDraft = { ...makeDraft('T-1001'), source_chunk_ids: ['HALLUCINATED-999'] };

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [badDraft],
      [makePlan('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.ACTION_PLAN_CREATED,
    );

    const ghostIssue = result.validations.find((v) => v.source_chunk_ids.includes('HALLUCINATED-999'));
    expect(ghostIssue).toBeDefined();
    expect(ghostIssue?.grounded).toBe(false);
  });

  it('makes one LLM call per ticket', async () => {
    const llm = new StubLLMService({ grounding_validation: EMPTY_LLM_VALIDATIONS }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());

    await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeTriage('T-1001'), makeTriage('T-1002')],
      [makeDraft('T-1001'), makeDraft('T-1002')],
      [makePlan('T-1001'), makePlan('T-1002')],
      [makeRetrieval('T-1001', []), makeRetrieval('T-1002', [])],
      [],
      PipelineState.ACTION_PLAN_CREATED,
    );

    expect(logger.records).toHaveLength(2);
    expect(logger.records.every((r) => r.stage === 'grounding_validation')).toBe(true);
  });

  it('handles invalid JSON from LLM gracefully', async () => {
    const llm = new StubLLMService({ grounding_validation: 'not-json' }, logger, CLOCK);
    const useCase = new ValidateGroundingUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.ACTION_PLAN_CREATED,
    );

    // Deterministic results still present; no crash from bad LLM JSON
    expect(result.validations).toBeDefined();
    expect(Array.isArray(result.validations)).toBe(true);
  });
});
