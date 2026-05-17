import { FinalTicketOutput } from '../../domain/entities/FinalTicketOutput.js';
import { QueueEntry } from './RankQueueUseCase.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { IClock } from '../../domain/services/IClock.js';

export interface PipelineStateTransition {
  state: PipelineState;
  timestamp: string;
}

export interface AuditLog {
  pipeline_run_at: string;
  state_transitions: PipelineStateTransition[];
  ticket_count: number;
  llm_calls_total: number;
  unsupported_claims_corrected: number;
  queue_summary: Record<string, number>;
}

export interface ExportAuditLogResult {
  auditLog: AuditLog;
  nextState: PipelineState;
}

export class ExportAuditLogUseCase {
  constructor(
    private readonly artifactRepo: IArtifactRepository,
    private readonly clock: IClock,
  ) {}

  async execute(
    outputs: FinalTicketOutput[],
    ranking: QueueEntry[],
    stateTransitions: PipelineStateTransition[],
    llmCallsTotal: number,
    currentState: PipelineState,
  ): Promise<ExportAuditLogResult> {
    assertState(currentState, PipelineState.AUDIT_LOG_EXPORTED);

    const unsupportedClaimsCorrected = outputs.reduce(
      (sum, o) => sum + o.validation_summary.unsupported_claims_found,
      0,
    );

    const queueSummary: Record<string, number> = {};
    for (const entry of ranking) {
      queueSummary[entry.recommended_queue] = (queueSummary[entry.recommended_queue] ?? 0) + 1;
    }

    const auditLog: AuditLog = {
      pipeline_run_at: this.clock.now(),
      state_transitions: stateTransitions,
      ticket_count: outputs.length,
      llm_calls_total: llmCallsTotal,
      unsupported_claims_corrected: unsupportedClaimsCorrected,
      queue_summary: queueSummary,
    };

    await this.artifactRepo.write('audit_log.json', auditLog);

    return {
      auditLog,
      nextState: nextState(PipelineState.AUDIT_LOG_EXPORTED),
    };
  }
}
