import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { RetrievalResult } from '../../domain/entities/RetrievalResult.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { IRetrievalService } from '../../domain/services/IRetrievalService.js';
import { RetrievalConfig } from '../../infrastructure/config/EnvConfig.js';

export interface RetrieveKnowledgeResult {
  results: RetrievalResult[];
  tickets: Ticket[];
  nextState: PipelineState;
}

export class RetrieveKnowledgeUseCase {
  constructor(
    private readonly retriever: IRetrievalService,
    private readonly artifactRepo: IArtifactRepository,
    private readonly config: RetrievalConfig,
  ) {}

  async execute(
    tickets: Ticket[],
    chunks: KnowledgeChunk[],
    currentState: PipelineState,
  ): Promise<RetrieveKnowledgeResult> {
    assertState(currentState, PipelineState.TICKETS_NORMALISED);

    const results: RetrievalResult[] = [];
    const updatedTickets: Ticket[] = [];

    for (const ticket of tickets) {
      // Fetch topK + 1 so we can detect borderline omissions
      const candidates = this.retriever.retrieve(
        ticket.retrieval_query,
        chunks,
        this.config.topK + 1,
      );

      const topCandidates = candidates.slice(0, this.config.topK);
      const spillover = candidates[this.config.topK];

      // Apply min-score floor
      const selected = topCandidates.filter((c) => c.score >= this.config.minScore);

      // Low-confidence: top score below threshold, OR all selected scores bunched within ε
      const topScore = selected[0]?.score ?? 0;
      const bottomScore = selected[selected.length - 1]?.score ?? 0;
      const allBunched =
        selected.length > 1 && topScore - bottomScore < this.config.epsilon;
      const lowConfidence = topScore < this.config.confidenceThreshold || allBunched;

      // Omitted-relevant-risk: (K+1)th score is ≥ 85% of the Kth selected score
      const kthScore = topCandidates[topCandidates.length - 1]?.score ?? 0;
      const omittedRisk =
        spillover && kthScore > 0 && spillover.score / kthScore >= 0.85
          ? `Chunk "${spillover.chunk.chunk_id}" (score ${spillover.score.toFixed(3)}) is within 15% of the Kth selected (score ${kthScore.toFixed(3)}) and may be relevant`
          : null;

      const selectionReason =
        selected.length > 0
          ? `BM25 top-${selected.length}: ${selected.map((c) => `${c.chunk.chunk_id}(${c.score.toFixed(3)})`).join(', ')}`
          : 'No chunks met the minimum score threshold — low retrieval confidence';

      results.push({
        ticket_id: ticket.ticket_id,
        query_text: ticket.retrieval_query,
        selected_chunk_ids: selected.map((c) => c.chunk.chunk_id),
        selection_reason: selectionReason,
        omitted_relevant_risk: omittedRisk,
      });

      updatedTickets.push({ ...ticket, low_retrieval_confidence: lowConfidence });
    }

    await this.artifactRepo.write('retrieval_results.json', results);

    return {
      results,
      tickets: updatedTickets,
      nextState: nextState(PipelineState.TICKETS_NORMALISED),
    };
  }
}
