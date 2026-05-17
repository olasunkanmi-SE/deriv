import { PipelineStateTransition } from '../use-cases/ExportAuditLogUseCase.js';
import { CreateActionPlanUseCase } from '../use-cases/CreateActionPlanUseCase.js';
import { DraftResponsesUseCase } from '../use-cases/DraftResponsesUseCase.js';
import { ExportAuditLogUseCase } from '../use-cases/ExportAuditLogUseCase.js';
import { FinaliseResultsUseCase } from '../use-cases/FinaliseResultsUseCase.js';
import { IndexKnowledgeUseCase } from '../use-cases/IndexKnowledgeUseCase.js';
import { LoadInputsUseCase } from '../use-cases/LoadInputsUseCase.js';
import { NormaliseTicketsUseCase } from '../use-cases/NormaliseTicketsUseCase.js';
import { RankQueueUseCase } from '../use-cases/RankQueueUseCase.js';
import { RetrieveKnowledgeUseCase } from '../use-cases/RetrieveKnowledgeUseCase.js';
import { TriageTicketsUseCase } from '../use-cases/TriageTicketsUseCase.js';
import { ValidateGroundingUseCase } from '../use-cases/ValidateGroundingUseCase.js';
import { PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IClock } from '../../domain/services/IClock.js';
import { RetrievalConfig } from '../../domain/services/IRetrievalService.js';
import { IKnowledgeRepository } from '../../domain/repositories/IKnowledgeRepository.js';
import { ITicketRepository } from '../../domain/repositories/ITicketRepository.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { ILLMService } from '../../domain/services/ILLMService.js';
import { ILLMCallLogger } from '../../domain/services/ILLMCallLogger.js';
import { IChunker } from '../../domain/services/IChunker.js';
import { IRetrievalService } from '../../domain/services/IRetrievalService.js';

export interface OrchestratorDeps {
  ticketRepo: ITicketRepository;
  knowledgeRepo: IKnowledgeRepository;
  artifactRepo: IArtifactRepository;
  llm: ILLMService;
  llmCallLogger: ILLMCallLogger;
  chunker: IChunker;
  retriever: IRetrievalService;
  clock: IClock;
  retrievalConfig: RetrievalConfig;
}

export class PipelineOrchestrator {
  private state: PipelineState = PipelineState.INIT;
  private readonly transitions: PipelineStateTransition[] = [];
  private llmCallCount = 0;

  constructor(private readonly deps: OrchestratorDeps) {}

  async run(): Promise<void> {
    this.recordTransition(PipelineState.INIT);

    // Stage: Load inputs
    log('Loading tickets...');
    const loadUseCase = new LoadInputsUseCase(this.deps.ticketRepo);
    const { tickets: rawTickets, nextState: afterLoad } = await loadUseCase.execute(this.state);
    this.advance(afterLoad);
    log(`Loaded ${rawTickets.length} ticket(s).`);

    // Stage: Index knowledge
    log('Indexing knowledge base...');
    const indexUseCase = new IndexKnowledgeUseCase(
      this.deps.knowledgeRepo,
      this.deps.chunker,
      this.deps.artifactRepo,
    );
    const { chunks, nextState: afterIndex } = await indexUseCase.execute(this.state);
    this.advance(afterIndex);
    log(`Indexed ${chunks.length} chunk(s).`);

    // Stage: Normalise tickets
    const normaliseUseCase = new NormaliseTicketsUseCase();
    const { tickets, nextState: afterNorm } = normaliseUseCase.execute(rawTickets, this.state);
    this.advance(afterNorm);

    // Stage: Retrieve knowledge
    log('Running BM25 retrieval...');
    const retrieveUseCase = new RetrieveKnowledgeUseCase(
      this.deps.retriever,
      this.deps.artifactRepo,
      this.deps.retrievalConfig,
    );
    const { results: retrievalResults, tickets: ticketsWithConfidence, nextState: afterRetrieval } = await retrieveUseCase.execute(
      tickets,
      chunks,
      this.state,
    );
    this.advance(afterRetrieval);
    const lowConfCount = ticketsWithConfidence.filter((t) => t.low_retrieval_confidence).length;
    log(`Retrieval complete. ${lowConfCount > 0 ? `${lowConfCount} ticket(s) flagged low-confidence.` : 'All tickets have sufficient retrieval confidence.'}`);

    // Stage 1 LLM: Triage
    log(`Stage 1/4 — Triage (${ticketsWithConfidence.length} LLM call(s))...`);
    const triageUseCase = new TriageTicketsUseCase(this.deps.llm, this.deps.artifactRepo);
    const { triageResults, nextState: afterTriage } = await triageUseCase.execute(
      ticketsWithConfidence,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterTriage);
    this.llmCallCount += ticketsWithConfidence.length;
    log('Stage 1/4 — Triage complete. → artifacts/triage.json');

    // Stage 2 LLM: Response drafting
    log(`Stage 2/4 — Response drafting (${ticketsWithConfidence.length} LLM call(s))...`);
    const draftUseCase = new DraftResponsesUseCase(this.deps.llm, this.deps.artifactRepo);
    const { drafts, nextState: afterDraft } = await draftUseCase.execute(
      ticketsWithConfidence,
      triageResults,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterDraft);
    this.llmCallCount += drafts.length;
    log('Stage 2/4 — Response drafting complete. → artifacts/response_drafts.json');

    // Stage 3 LLM: Action planning
    log(`Stage 3/4 — Action planning (${ticketsWithConfidence.length} LLM call(s))...`);
    const actionUseCase = new CreateActionPlanUseCase(this.deps.llm, this.deps.artifactRepo);
    const { actionPlans, nextState: afterAction } = await actionUseCase.execute(
      ticketsWithConfidence,
      triageResults,
      drafts,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterAction);
    this.llmCallCount += actionPlans.length;
    log('Stage 3/4 — Action planning complete. → artifacts/action_plan.json');

    // Stage 4 LLM: Grounding validation
    log(`Stage 4/4 — Grounding validation (${ticketsWithConfidence.length} LLM call(s))...`);
    const groundingUseCase = new ValidateGroundingUseCase(this.deps.llm, this.deps.artifactRepo);
    const { validations, nextState: afterGrounding } = await groundingUseCase.execute(
      ticketsWithConfidence,
      triageResults,
      drafts,
      actionPlans,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterGrounding);
    this.llmCallCount += ticketsWithConfidence.length;
    const issues = validations.filter((v) => !v.grounded).length;
    log(`Stage 4/4 — Grounding validation complete. ${issues} issue(s) found. → artifacts/grounding_validation.json`);

    // Finalise
    log('Finalising results...');
    const finaliseUseCase = new FinaliseResultsUseCase(this.deps.artifactRepo);
    const { outputs, nextState: afterFinalise } = await finaliseUseCase.execute(
      ticketsWithConfidence,
      triageResults,
      drafts,
      actionPlans,
      validations,
      this.state,
    );
    this.advance(afterFinalise);
    log('→ artifacts/final_ticket_outputs.json');

    // Queue ranking
    const rankUseCase = new RankQueueUseCase(this.deps.artifactRepo);
    const { ranking, nextState: afterRank } = await rankUseCase.execute(
      ticketsWithConfidence,
      outputs,
      this.state,
    );
    this.advance(afterRank);
    log('→ artifacts/queue_ranking.json');

    // Audit log
    const auditUseCase = new ExportAuditLogUseCase(this.deps.artifactRepo, this.deps.clock);
    const { nextState: afterAudit } = await auditUseCase.execute(
      outputs,
      ranking,
      this.transitions,
      this.llmCallCount,
      this.state,
    );
    this.advance(afterAudit);
    log('→ artifacts/audit_log.json');
  }

  getState(): PipelineState {
    return this.state;
  }

  getTransitions(): PipelineStateTransition[] {
    return [...this.transitions];
  }

  private advance(newState: PipelineState): void {
    this.state = newState;
    this.recordTransition(newState);
  }

  private recordTransition(state: PipelineState): void {
    this.transitions.push({ state, timestamp: this.deps.clock.now() });
  }
}

function log(msg: string): void {
  console.log(`[Pipeline] ${msg}`);
}
