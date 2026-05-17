import { describe, it, expect, beforeEach } from 'vitest';
import { CreateActionPlanUseCase } from '../../../src/application/use-cases/CreateActionPlanUseCase.js';
import { SpyLLMCallLogger } from '../../stubs/SpyLLMCallLogger.js';
import { StubLLMService } from '../../stubs/StubLLMService.js';
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

const VALID_ACTION_PLAN_RESPONSE = JSON.stringify({
  actions: [
    {
      action_id: 'A-T-1001-1',
      description: 'Escalate withdrawal case to payments operations team for manual review.',
      owner_queue: 'payments_ops',
      priority: 'P1',
      depends_on: [],
    },
    {
      action_id: 'A-T-1001-2',
      description: 'Send follow-up confirmation to customer once resolved.',
      owner_queue: 'customer_support',
      priority: 'P2',
      depends_on: ['A-T-1001-1'],
    },
  ],
  handoff_note: 'VIP customer T-1001 has a withdrawal pending for 3 days. High urgency; payments_ops must review before end of business.',
});

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
    reasoning_summary: 'Customer waiting beyond standard window.',
    source_chunk_ids: ['payments-001'],
  };
}

function makeDraft(ticketId: string): ResponseDraft {
  return {
    ticket_id: ticketId,
    response_text: 'Your withdrawal is under review.',
    tone: 'empathetic',
    contains_policy_claims: true,
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

describe('CreateActionPlanUseCase', () => {
  let logger: SpyLLMCallLogger;

  beforeEach(() => {
    logger = new SpyLLMCallLogger();
  });

  it('throws PipelineStateError when state is not RESPONSE_DRAFTED', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    await expect(
      useCase.execute([], [], [], [], [], PipelineState.TRIAGE_COMPLETE),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to ACTION_PLAN_CREATED', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.nextState).toBe(PipelineState.ACTION_PLAN_CREATED);
  });

  it('returns one action plan per ticket', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeTriage('T-1001'), makeTriage('T-1002')],
      [makeDraft('T-1001'), makeDraft('T-1002')],
      [makeRetrieval('T-1001', []), makeRetrieval('T-1002', [])],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.actionPlans).toHaveLength(2);
    expect(result.actionPlans[0]?.ticket_id).toBe('T-1001');
    expect(result.actionPlans[1]?.ticket_id).toBe('T-1002');
  });

  it('normalises action_ids to A-{ticketId}-N pattern regardless of LLM output', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RESPONSE_DRAFTED,
    );

    const plan = result.actionPlans[0]!;
    expect(plan.actions[0]?.action_id).toBe('A-T-1001-1');
    expect(plan.actions[1]?.action_id).toBe('A-T-1001-2');
  });

  it('parses owner_queue and priority correctly', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RESPONSE_DRAFTED,
    );

    const plan = result.actionPlans[0]!;
    expect(plan.actions[0]?.owner_queue).toBe('payments_ops');
    expect(plan.actions[0]?.priority).toBe('P1');
    expect(plan.actions[1]?.owner_queue).toBe('customer_support');
    expect(plan.actions[1]?.priority).toBe('P2');
  });

  it('includes handoff_note', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.actionPlans[0]?.handoff_note).toContain('T-1001');
  });

  it('uses safe defaults when LLM returns invalid JSON', async () => {
    const llm = new StubLLMService({ action_planning: 'not-json' }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    const plan = result.actionPlans[0]!;
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]?.action_id).toBe('A-T-1001-1');
    expect(plan.actions[0]?.owner_queue).toBe('customer_support');
    expect(plan.actions[0]?.priority).toBe('P2');
  });

  it('falls back to customer_support queue for invalid vocab', async () => {
    const badQueueResponse = JSON.stringify({
      actions: [
        {
          action_id: 'A-T-1001-1',
          description: 'Review ticket.',
          owner_queue: 'INVALID_QUEUE',
          priority: 'P1',
          depends_on: [],
        },
      ],
      handoff_note: 'Review needed.',
    });
    const llm = new StubLLMService({ action_planning: badQueueResponse }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.actionPlans[0]?.actions[0]?.owner_queue).toBe('customer_support');
  });

  it('skips tickets without a matching triage result', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-NO-TRIAGE')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001'), makeDraft('T-NO-TRIAGE')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.actionPlans).toHaveLength(1);
    expect(result.actionPlans[0]?.ticket_id).toBe('T-1001');
  });

  it('skips tickets without a matching response draft', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-NO-DRAFT')],
      [makeTriage('T-1001'), makeTriage('T-NO-DRAFT')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', [])],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(result.actionPlans).toHaveLength(1);
    expect(result.actionPlans[0]?.ticket_id).toBe('T-1001');
  });

  it('writes action_plan.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, artifactRepo);

    await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makeRetrieval('T-1001', ['payments-001'])],
      [makeChunk('payments-001')],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(artifactRepo.write).toHaveBeenCalledWith('action_plan.json', expect.any(Array));
  });

  it('makes one LLM call per ticket', async () => {
    const llm = new StubLLMService({ action_planning: VALID_ACTION_PLAN_RESPONSE }, logger, CLOCK);
    const useCase = new CreateActionPlanUseCase(llm, makeArtifactRepo());

    await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002'), makeTicket('T-1003')],
      [makeTriage('T-1001'), makeTriage('T-1002'), makeTriage('T-1003')],
      [makeDraft('T-1001'), makeDraft('T-1002'), makeDraft('T-1003')],
      [
        makeRetrieval('T-1001', []),
        makeRetrieval('T-1002', []),
        makeRetrieval('T-1003', []),
      ],
      [],
      PipelineState.RESPONSE_DRAFTED,
    );

    expect(logger.records).toHaveLength(3);
    expect(logger.records.every((r) => r.stage === 'action_planning')).toBe(true);
  });
});
