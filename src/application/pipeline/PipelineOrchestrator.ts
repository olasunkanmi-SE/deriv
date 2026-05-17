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
    const loadUseCase = new LoadInputsUseCase(this.deps.ticketRepo);
    const { tickets: rawTickets, nextState: afterLoad } = await loadUseCase.execute(this.state);
    this.advance(afterLoad);

    // Stage: Index knowledge
    const indexUseCase = new IndexKnowledgeUseCase(
      this.deps.knowledgeRepo,
      this.deps.chunker,
      this.deps.artifactRepo,
    );
    const { chunks, nextState: afterIndex } = await indexUseCase.execute(this.state);
    this.advance(afterIndex);

    // Stage: Normalise tickets
    const normaliseUseCase = new NormaliseTicketsUseCase();
    const { tickets, nextState: afterNorm } = normaliseUseCase.execute(rawTickets, this.state);
    this.advance(afterNorm);

    // Stage: Retrieve knowledge
    const retrieveUseCase = new RetrieveKnowledgeUseCase(
      this.deps.retriever,
      this.deps.artifactRepo,
      this.deps.retrievalConfig,
    );
    const { results: retrievalResults, nextState: afterRetrieval } = await retrieveUseCase.execute(
      tickets,
      chunks,
      this.state,
    );
    this.advance(afterRetrieval);

    // Stage 1 LLM: Triage
    const triageUseCase = new TriageTicketsUseCase(this.deps.llm, this.deps.artifactRepo);
    const { triageResults, nextState: afterTriage } = await triageUseCase.execute(
      tickets,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterTriage);
    this.llmCallCount += tickets.length;

    // Stage 2 LLM: Response drafting
    const draftUseCase = new DraftResponsesUseCase(this.deps.llm, this.deps.artifactRepo);
    const { drafts, nextState: afterDraft } = await draftUseCase.execute(
      tickets,
      triageResults,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterDraft);
    this.llmCallCount += tickets.length;

    // Stage 3 LLM: Action planning
    const actionUseCase = new CreateActionPlanUseCase(this.deps.llm, this.deps.artifactRepo);
    const { actionPlans, nextState: afterAction } = await actionUseCase.execute(
      tickets,
      triageResults,
      drafts,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterAction);
    this.llmCallCount += tickets.length;

    // Stage 4 LLM: Grounding validation
    const groundingUseCase = new ValidateGroundingUseCase(this.deps.llm, this.deps.artifactRepo);
    const { validations, nextState: afterGrounding } = await groundingUseCase.execute(
      tickets,
      triageResults,
      drafts,
      actionPlans,
      retrievalResults,
      chunks,
      this.state,
    );
    this.advance(afterGrounding);
    this.llmCallCount += tickets.length;

    // Finalise
    const finaliseUseCase = new FinaliseResultsUseCase(this.deps.artifactRepo);
    const { outputs, nextState: afterFinalise } = await finaliseUseCase.execute(
      tickets,
      triageResults,
      drafts,
      actionPlans,
      validations,
      this.state,
    );
    this.advance(afterFinalise);

    // Queue ranking
    const rankUseCase = new RankQueueUseCase(this.deps.artifactRepo);
    const { ranking, nextState: afterRank } = await rankUseCase.execute(
      tickets,
      outputs,
      this.state,
    );
    this.advance(afterRank);

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
