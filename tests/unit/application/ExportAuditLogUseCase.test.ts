import { describe, it, expect } from 'vitest';
import { ExportAuditLogUseCase } from '../../../src/application/use-cases/ExportAuditLogUseCase.js';
import type { QueueEntry } from '../../../src/application/use-cases/RankQueueUseCase.js';
import type { FinalTicketOutput } from '../../../src/domain/entities/FinalTicketOutput.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import { vi } from 'vitest';

const CLOCK = { now: () => '2026-05-17T10:00:00.000Z' };

function makeOutput(ticketId: string, unsupportedClaims = 0): FinalTicketOutput {
  const triage: TriageResult = {
    ticket_id: ticketId,
    category: 'general_query',
    urgency: 'medium',
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
    actions: [],
    handoff_note: `Case ${ticketId} for review.`,
  };
  return {
    ticket_id: ticketId,
    final_triage: triage,
    final_response: draft,
    final_action_plan: plan,
    validation_summary: { unsupported_claims_found: unsupportedClaims, corrected: unsupportedClaims > 0 },
  };
}

function makeQueueEntry(ticketId: string, queue: QueueEntry['recommended_queue']): QueueEntry {
  return {
    ticket_id: ticketId,
    rank: 1,
    score: 30,
    recommended_queue: queue,
    urgency: 'high',
    customer_tier: 'standard',
    category: 'general_query',
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

describe('ExportAuditLogUseCase', () => {
  it('throws PipelineStateError when state is not AUDIT_LOG_EXPORTED', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    await expect(
      useCase.execute([], [], [], 0, PipelineState.FINAL_OUTPUTS_WRITTEN),
    ).rejects.toThrow(PipelineStateError);
  });

  it('advances to VALIDATION_COMPLETE', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute([], [], [], 0, PipelineState.AUDIT_LOG_EXPORTED);
    expect(result.nextState).toBe(PipelineState.VALIDATION_COMPLETE);
  });

  it('records correct ticket_count', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute(
      [makeOutput('T-1001'), makeOutput('T-1002'), makeOutput('T-1003')],
      [],
      [],
      0,
      PipelineState.AUDIT_LOG_EXPORTED,
    );
    expect(result.auditLog.ticket_count).toBe(3);
  });

  it('records total unsupported claims corrected across all tickets', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute(
      [makeOutput('T-1001', 2), makeOutput('T-1002', 1)],
      [],
      [],
      0,
      PipelineState.AUDIT_LOG_EXPORTED,
    );
    expect(result.auditLog.unsupported_claims_corrected).toBe(3);
  });

  it('records llm_calls_total', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute([], [], [], 12, PipelineState.AUDIT_LOG_EXPORTED);
    expect(result.auditLog.llm_calls_total).toBe(12);
  });

  it('summarises queue distribution', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute(
      [],
      [
        makeQueueEntry('T-1001', 'payments_ops'),
        makeQueueEntry('T-1002', 'payments_ops'),
        makeQueueEntry('T-1003', 'customer_support'),
      ],
      [],
      0,
      PipelineState.AUDIT_LOG_EXPORTED,
    );
    expect(result.auditLog.queue_summary['payments_ops']).toBe(2);
    expect(result.auditLog.queue_summary['customer_support']).toBe(1);
  });

  it('records state transitions', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const transitions = [
      { state: PipelineState.INPUTS_LOADED, timestamp: '2026-05-17T09:00:00Z' },
      { state: PipelineState.TRIAGE_COMPLETE, timestamp: '2026-05-17T09:01:00Z' },
    ];
    const result = await useCase.execute([], [], transitions, 0, PipelineState.AUDIT_LOG_EXPORTED);
    expect(result.auditLog.state_transitions).toHaveLength(2);
    expect(result.auditLog.state_transitions[0]?.state).toBe(PipelineState.INPUTS_LOADED);
  });

  it('uses clock.now() for pipeline_run_at', async () => {
    const useCase = new ExportAuditLogUseCase(makeArtifactRepo(), CLOCK);
    const result = await useCase.execute([], [], [], 0, PipelineState.AUDIT_LOG_EXPORTED);
    expect(result.auditLog.pipeline_run_at).toBe('2026-05-17T10:00:00.000Z');
  });

  it('writes audit_log.json artifact', async () => {
    const artifactRepo = makeArtifactRepo();
    const useCase = new ExportAuditLogUseCase(artifactRepo, CLOCK);
    await useCase.execute([], [], [], 0, PipelineState.AUDIT_LOG_EXPORTED);
    expect(artifactRepo.write).toHaveBeenCalledWith('audit_log.json', expect.any(Object));
  });
});
