import { describe, it, expect } from 'vitest';
import { FinaliseResultsUseCase } from '../../../src/application/use-cases/FinaliseResultsUseCase.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { GroundingValidation } from '../../../src/domain/entities/GroundingValidation.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

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

function makeDraft(ticketId: string, chunkIds = ['payments-001']): ResponseDraft {
  return {
    ticket_id: ticketId,
    response_text: 'Your withdrawal is under review.',
    tone: 'professional',
    contains_policy_claims: true,
    source_chunk_ids: chunkIds,
  };
}

function makePlan(ticketId: string): ActionPlan {
  return {
    ticket_id: ticketId,
    actions: [{
      action_id: `A-${ticketId}-1`,
      description: 'Escalate to payments team.',
      owner_queue: 'payments_ops',
      priority: 'P1',
      depends_on: [],
    }],
    handoff_note: `Customer ${ticketId} needs review.`,
  };
}

function makeValidation(
  ticketId: string,
  grounded: boolean,
  chunkIds: string[] = [],
): GroundingValidation {
  return {
    ticket_id: ticketId,
    artifact: 'response_drafts.json',
    claim: 'Response cites a chunk',
    grounded,
    source_type: 'knowledge_base',
    source_chunk_ids: chunkIds,
    issue: grounded ? null : 'Ungrounded claim',
    recommended_fix: grounded ? null : 'Fix the claim',
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

describe('FinaliseResultsUseCase', () => {
  it('throws PipelineStateError when state is not GROUNDING_VALIDATED', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    await expect(
      useCase.execute([], [], [], [], [], PipelineState.ACTION_PLAN_CREATED),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to FINAL_OUTPUTS_WRITTEN', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeValidation('T-1001', true, ['payments-001'])],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.nextState).toBe(PipelineState.FINAL_OUTPUTS_WRITTEN);
  });

  it('returns one output per ticket', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeTriage('T-1001'), makeTriage('T-1002')],
      [makeDraft('T-1001'), makeDraft('T-1002')],
      [makePlan('T-1001'), makePlan('T-1002')],
      [],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.outputs).toHaveLength(2);
  });

  it('includes triage, response, and plan in final output', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [],
      PipelineState.GROUNDING_VALIDATED,
    );
    const output = result.outputs[0]!;
    expect(output.final_triage.ticket_id).toBe('T-1001');
    expect(output.final_response.ticket_id).toBe('T-1001');
    expect(output.final_action_plan.ticket_id).toBe('T-1001');
  });

  it('reports zero unsupported claims when all validations pass', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [makeValidation('T-1001', true, ['payments-001'])],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.outputs[0]?.validation_summary.unsupported_claims_found).toBe(0);
    expect(result.outputs[0]?.validation_summary.corrected).toBe(false);
  });

  it('strips failed chunk IDs from final_response source_chunk_ids', async () => {
    const draft = makeDraft('T-1001', ['payments-001', 'hallucinated-999']);
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [draft],
      [makePlan('T-1001')],
      [makeValidation('T-1001', false, ['hallucinated-999'])],
      PipelineState.GROUNDING_VALIDATED,
    );
    const finalResponse = result.outputs[0]!.final_response;
    expect(finalResponse.source_chunk_ids).not.toContain('hallucinated-999');
    expect(finalResponse.source_chunk_ids).toContain('payments-001');
  });

  it('sets corrected=true when unsupported chunks were stripped', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001', ['hallucinated-999'])],
      [makePlan('T-1001')],
      [makeValidation('T-1001', false, ['hallucinated-999'])],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.outputs[0]?.validation_summary.corrected).toBe(true);
    expect(result.outputs[0]?.validation_summary.unsupported_claims_found).toBe(1);
  });

  it('sets contains_policy_claims=false when all source chunks are stripped', async () => {
    const draft = makeDraft('T-1001', ['hallucinated-999']);
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [draft],
      [makePlan('T-1001')],
      [makeValidation('T-1001', false, ['hallucinated-999'])],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.outputs[0]?.final_response.contains_policy_claims).toBe(false);
  });

  it('writes final_ticket_outputs.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const useCase = new FinaliseResultsUseCase(artifactRepo);
    await useCase.execute(
      [makeTicket('T-1001')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(artifactRepo.write).toHaveBeenCalledWith('final_ticket_outputs.json', expect.any(Array));
  });

  it('skips tickets missing triage, draft, or plan artifacts', async () => {
    const useCase = new FinaliseResultsUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-INCOMPLETE')],
      [makeTriage('T-1001')],
      [makeDraft('T-1001')],
      [makePlan('T-1001')],
      [],
      PipelineState.GROUNDING_VALIDATED,
    );
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]?.ticket_id).toBe('T-1001');
  });
});
