import { describe, it, expect } from 'vitest';
import { RankQueueUseCase } from '../../../src/application/use-cases/RankQueueUseCase.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { FinalTicketOutput } from '../../../src/domain/entities/FinalTicketOutput.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

function makeTicket(id: string, tier: 'standard' | 'vip' = 'standard'): Ticket {
  return {
    ticket_id: id,
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: tier,
    language: 'en',
    subject: 'Support request',
    message: 'Need help.',
    retrieval_query: 'help',
    low_retrieval_confidence: false,
  };
}

function makeOutput(
  ticketId: string,
  urgency: TriageResult['urgency'],
  category: TriageResult['category'] = 'general_query',
): FinalTicketOutput {
  const triage: TriageResult = {
    ticket_id: ticketId,
    category,
    urgency,
    sentiment: 'neutral',
    resolution_mode: 'reply_only',
    recommended_queue: 'customer_support',
    reasoning_summary: 'Standard case.',
    source_chunk_ids: [],
  };
  const draft: ResponseDraft = {
    ticket_id: ticketId,
    response_text: 'We will review your request.',
    tone: 'professional',
    contains_policy_claims: false,
    source_chunk_ids: [],
  };
  const plan: ActionPlan = {
    ticket_id: ticketId,
    actions: [{
      action_id: `A-${ticketId}-1`,
      description: 'Review and resolve.',
      owner_queue: 'customer_support',
      priority: 'P2',
      depends_on: [],
    }],
    handoff_note: `Case ${ticketId} needs standard review.`,
  };
  return {
    ticket_id: ticketId,
    final_triage: triage,
    final_response: draft,
    final_action_plan: plan,
    validation_summary: { unsupported_claims_found: 0, corrected: false },
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

describe('RankQueueUseCase', () => {
  it('throws PipelineStateError when state is not FINAL_OUTPUTS_WRITTEN', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    await expect(
      useCase.execute([], [], PipelineState.GROUNDING_VALIDATED),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to AUDIT_LOG_EXPORTED', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001')],
      [makeOutput('T-1001', 'medium')],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(result.nextState).toBe(PipelineState.AUDIT_LOG_EXPORTED);
  });

  it('ranks higher-urgency tickets first', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-LOW'), makeTicket('T-HIGH'), makeTicket('T-CRIT')],
      [
        makeOutput('T-LOW', 'low'),
        makeOutput('T-HIGH', 'high'),
        makeOutput('T-CRIT', 'critical'),
      ],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(result.ranking[0]?.ticket_id).toBe('T-CRIT');
    expect(result.ranking[1]?.ticket_id).toBe('T-HIGH');
    expect(result.ranking[2]?.ticket_id).toBe('T-LOW');
  });

  it('VIP tier scores higher than standard at same urgency', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-STD', 'standard'), makeTicket('T-VIP', 'vip')],
      [makeOutput('T-STD', 'high'), makeOutput('T-VIP', 'high')],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(result.ranking[0]?.ticket_id).toBe('T-VIP');
  });

  it('assigns sequential rank numbers starting from 1', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-1001'), makeTicket('T-1002')],
      [makeOutput('T-1001', 'medium'), makeOutput('T-1002', 'low')],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(result.ranking[0]?.rank).toBe(1);
    expect(result.ranking[1]?.rank).toBe(2);
  });

  it('withdrawal_delay category scores higher than general_query at same urgency and tier', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute(
      [makeTicket('T-GEN'), makeTicket('T-WD')],
      [makeOutput('T-GEN', 'medium', 'general_query'), makeOutput('T-WD', 'medium', 'withdrawal_delay')],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(result.ranking[0]?.ticket_id).toBe('T-WD');
  });

  it('writes queue_ranking.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const useCase = new RankQueueUseCase(artifactRepo);
    await useCase.execute(
      [makeTicket('T-1001')],
      [makeOutput('T-1001', 'high')],
      PipelineState.FINAL_OUTPUTS_WRITTEN,
    );
    expect(artifactRepo.write).toHaveBeenCalledWith('queue_ranking.json', expect.any(Array));
  });

  it('returns empty ranking for empty inputs', async () => {
    const useCase = new RankQueueUseCase(makeArtifactRepo());
    const result = await useCase.execute([], [], PipelineState.FINAL_OUTPUTS_WRITTEN);
    expect(result.ranking).toHaveLength(0);
  });
});
