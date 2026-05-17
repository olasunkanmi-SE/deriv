import { ActionPlan } from '../../domain/entities/ActionPlan.js';
import { GroundingValidation } from '../../domain/entities/GroundingValidation.js';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { RetrievalResult } from '../../domain/entities/RetrievalResult.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { ILLMService } from '../../domain/services/ILLMService.js';
import { GroundingChecker } from '../services/GroundingChecker.js';
import { buildGroundingPrompt } from '../prompts/buildGroundingPrompt.js';

export interface ValidateGroundingResult {
  validations: GroundingValidation[];
  nextState: PipelineState;
}

export class ValidateGroundingUseCase {
  private readonly checker = new GroundingChecker();

  constructor(
    private readonly llm: ILLMService,
    private readonly artifactRepo: IArtifactRepository,
  ) {}

  async execute(
    tickets: Ticket[],
    triageResults: TriageResult[],
    responseDrafts: ResponseDraft[],
    actionPlans: ActionPlan[],
    retrievalResults: RetrievalResult[],
    allChunks: KnowledgeChunk[],
    currentState: PipelineState,
  ): Promise<ValidateGroundingResult> {
    assertState(currentState, PipelineState.ACTION_PLAN_CREATED);

    const triageMap = new Map(triageResults.map((t) => [t.ticket_id, t]));
    const draftMap = new Map(responseDrafts.map((d) => [d.ticket_id, d]));
    const planMap = new Map(actionPlans.map((p) => [p.ticket_id, p]));
    const retrievalMap = new Map(retrievalResults.map((r) => [r.ticket_id, r]));
    const chunkMap = new Map(allChunks.map((c) => [c.chunk_id, c]));

    const deterministicResults = this.checker.check(responseDrafts, actionPlans, allChunks);
    const llmResults: GroundingValidation[] = [];

    for (const ticket of tickets) {
      const triage = triageMap.get(ticket.ticket_id);
      const draft = draftMap.get(ticket.ticket_id);
      const plan = planMap.get(ticket.ticket_id);
      if (!triage || !draft || !plan) continue;

      const retrieval = retrievalMap.get(ticket.ticket_id);
      const selectedChunkIds = retrieval?.selected_chunk_ids ?? [];
      const selectedChunks = selectedChunkIds
        .map((id) => chunkMap.get(id))
        .filter((c): c is KnowledgeChunk => c !== undefined);

      const prompt = buildGroundingPrompt(ticket, triage, draft, plan, selectedChunks);
      const raw = await this.llm.complete({
        prompt,
        stage: 'grounding_validation',
        ticketIds: [ticket.ticket_id],
        chunkIds: selectedChunkIds,
        inputArtifacts: [
          'artifacts/triage.json',
          'artifacts/response_drafts.json',
          'artifacts/action_plan.json',
          'artifacts/knowledge_corpus.json',
        ],
        outputArtifact: 'artifacts/grounding_validation.json',
      });

      const parsed = this.parseLLMValidations(raw, ticket.ticket_id);
      llmResults.push(...parsed);
    }

    const allValidations = [...deterministicResults, ...llmResults];
    await this.artifactRepo.write('grounding_validation.json', allValidations);

    return {
      validations: allValidations,
      nextState: nextState(PipelineState.ACTION_PLAN_CREATED),
    };
  }

  private parseLLMValidations(raw: string, ticketId: string): GroundingValidation[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[GroundingValidation] Invalid JSON for ${ticketId}, skipping LLM validations`);
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const results: GroundingValidation[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const v = item as Record<string, unknown>;

      const artifact = typeof v['artifact'] === 'string' ? v['artifact'] : 'unknown';
      const claim = typeof v['claim'] === 'string' && v['claim'].trim() ? v['claim'].trim() : 'unspecified claim';
      const grounded = typeof v['grounded'] === 'boolean' ? v['grounded'] : true;
      const sourceType = parseSourceType(typeof v['source_type'] === 'string' ? v['source_type'] : '');
      const rawIds = Array.isArray(v['source_chunk_ids']) ? v['source_chunk_ids'] : [];
      const sourceChunkIds = rawIds.filter((id): id is string => typeof id === 'string');
      const issue = typeof v['issue'] === 'string' && v['issue'].trim() ? v['issue'].trim() : null;
      const recommendedFix = typeof v['recommended_fix'] === 'string' && v['recommended_fix'].trim()
        ? v['recommended_fix'].trim()
        : null;

      results.push({ ticket_id: ticketId, artifact, claim, grounded, source_type: sourceType, source_chunk_ids: sourceChunkIds, issue, recommended_fix: recommendedFix });
    }
    return results;
  }
}

function parseSourceType(s: string): 'ticket' | 'knowledge_base' | 'derived' {
  if (s === 'ticket' || s === 'knowledge_base' || s === 'derived') return s;
  return 'derived';
}
