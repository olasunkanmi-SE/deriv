import { ActionPlan } from '../../domain/entities/ActionPlan.js';
import { FinalTicketOutput } from '../../domain/entities/FinalTicketOutput.js';
import { GroundingValidation } from '../../domain/entities/GroundingValidation.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';

export interface FinaliseResultsResult {
  outputs: FinalTicketOutput[];
  nextState: PipelineState;
}

export class FinaliseResultsUseCase {
  constructor(private readonly artifactRepo: IArtifactRepository) {}

  async execute(
    tickets: Ticket[],
    triageResults: TriageResult[],
    responseDrafts: ResponseDraft[],
    actionPlans: ActionPlan[],
    validations: GroundingValidation[],
    currentState: PipelineState,
  ): Promise<FinaliseResultsResult> {
    assertState(currentState, PipelineState.GROUNDING_VALIDATED);

    const triageMap = new Map(triageResults.map((t) => [t.ticket_id, t]));
    const draftMap = new Map(responseDrafts.map((d) => [d.ticket_id, d]));
    const planMap = new Map(actionPlans.map((p) => [p.ticket_id, p]));

    const failedChunksByTicket = new Map<string, Set<string>>();
    for (const v of validations) {
      if (!v.grounded) {
        if (!failedChunksByTicket.has(v.ticket_id)) {
          failedChunksByTicket.set(v.ticket_id, new Set());
        }
        for (const id of v.source_chunk_ids) {
          failedChunksByTicket.get(v.ticket_id)!.add(id);
        }
      }
    }

    const unsupportedClaimCountByTicket = new Map<string, number>();
    for (const v of validations) {
      if (!v.grounded) {
        unsupportedClaimCountByTicket.set(
          v.ticket_id,
          (unsupportedClaimCountByTicket.get(v.ticket_id) ?? 0) + 1,
        );
      }
    }

    const outputs: FinalTicketOutput[] = [];

    for (const ticket of tickets) {
      const triage = triageMap.get(ticket.ticket_id);
      const draft = draftMap.get(ticket.ticket_id);
      const plan = planMap.get(ticket.ticket_id);
      if (!triage || !draft || !plan) {
        console.warn(`[Finalise] Missing artifacts for ${ticket.ticket_id}, skipping`);
        continue;
      }

      const failedChunks = failedChunksByTicket.get(ticket.ticket_id) ?? new Set<string>();
      const unsupportedCount = unsupportedClaimCountByTicket.get(ticket.ticket_id) ?? 0;
      const corrected = failedChunks.size > 0;

      const finalDraft = corrected
        ? this.stripUnsupportedClaims(draft, failedChunks)
        : draft;

      outputs.push({
        ticket_id: ticket.ticket_id,
        final_triage: triage,
        final_response: finalDraft,
        final_action_plan: plan,
        validation_summary: {
          unsupported_claims_found: unsupportedCount,
          corrected,
        },
      });
    }

    await this.artifactRepo.write('final_ticket_outputs.json', outputs);

    return {
      outputs,
      nextState: nextState(PipelineState.GROUNDING_VALIDATED),
    };
  }

  private stripUnsupportedClaims(draft: ResponseDraft, failedChunks: Set<string>): ResponseDraft {
    const cleanedChunkIds = draft.source_chunk_ids.filter((id) => !failedChunks.has(id));
    const containsPolicyClaims = cleanedChunkIds.length > 0 ? draft.contains_policy_claims : false;

    return {
      ...draft,
      source_chunk_ids: cleanedChunkIds,
      contains_policy_claims: containsPolicyClaims,
    };
  }
}
