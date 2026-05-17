import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { RetrievalResult } from '../../domain/entities/RetrievalResult.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { ILLMService } from '../../domain/services/ILLMService.js';
import { buildResponsePrompt } from '../prompts/buildResponsePrompt.js';

export interface DraftResponsesResult {
  drafts: ResponseDraft[];
  nextState: PipelineState;
}

export class DraftResponsesUseCase {
  constructor(
    private readonly llm: ILLMService,
    private readonly artifactRepo: IArtifactRepository,
  ) {}

  async execute(
    tickets: Ticket[],
    triageResults: TriageResult[],
    retrievalResults: RetrievalResult[],
    allChunks: KnowledgeChunk[],
    currentState: PipelineState,
  ): Promise<DraftResponsesResult> {
    assertState(currentState, PipelineState.TRIAGE_COMPLETE);

    const triageMap = new Map(triageResults.map((t) => [t.ticket_id, t]));
    const retrievalMap = new Map(retrievalResults.map((r) => [r.ticket_id, r]));
    const chunkMap = new Map(allChunks.map((c) => [c.chunk_id, c]));
    const drafts: ResponseDraft[] = [];

    for (const ticket of tickets) {
      const triage = triageMap.get(ticket.ticket_id);
      if (!triage) {
        console.warn(`[DraftResponses] No triage result for ${ticket.ticket_id}, skipping`);
        continue;
      }

      const retrieval = retrievalMap.get(ticket.ticket_id);
      const selectedChunkIds = retrieval?.selected_chunk_ids ?? [];
      const selectedChunks = selectedChunkIds
        .map((id) => chunkMap.get(id))
        .filter((c): c is KnowledgeChunk => c !== undefined);

      process.stdout.write(`  Drafting response for ${ticket.ticket_id}...`);
      const prompt = buildResponsePrompt(ticket, triage, selectedChunks);
      const raw = await this.llm.complete({
        prompt,
        stage: 'response_drafting',
        ticketIds: [ticket.ticket_id],
        chunkIds: selectedChunkIds,
        inputArtifacts: [
          'tickets.json',
          'artifacts/knowledge_corpus.json',
          'artifacts/retrieval_results.json',
          'artifacts/triage.json',
        ],
        outputArtifact: 'artifacts/response_drafts.json',
      });

      const draft = this.parseAndValidate(raw, ticket.ticket_id, selectedChunkIds);
      drafts.push(draft);
      process.stdout.write(` done (${draft.tone})\n`);
    }

    await this.artifactRepo.write('response_drafts.json', drafts);

    return {
      drafts,
      nextState: nextState(PipelineState.TRIAGE_COMPLETE),
    };
  }

  private parseAndValidate(
    raw: string,
    ticketId: string,
    allowedChunkIds: string[],
  ): ResponseDraft {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`[DraftResponses] Invalid JSON for ${ticketId}, using safe defaults`);
      parsed = {};
    }

    const allowed = new Set(allowedChunkIds);
    const rawChunkIds = Array.isArray(parsed['source_chunk_ids']) ? parsed['source_chunk_ids'] : [];
    const parsedChunkIds = rawChunkIds.filter(
      (id): id is string => typeof id === 'string' && allowed.has(id),
    );

    const sourceChunkIds = parsedChunkIds;

    const responseText = typeof parsed['response_text'] === 'string' && parsed['response_text'].trim()
      ? parsed['response_text'].trim()
      : 'Our team is reviewing your case and will follow up shortly.';

    const tone = typeof parsed['tone'] === 'string' && parsed['tone'].trim()
      ? parsed['tone'].trim()
      : 'professional';

    const containsPolicyClaims = typeof parsed['contains_policy_claims'] === 'boolean'
      ? parsed['contains_policy_claims']
      : sourceChunkIds.length > 0;

    return {
      ticket_id: ticketId,
      response_text: responseText,
      tone,
      contains_policy_claims: containsPolicyClaims,
      source_chunk_ids: sourceChunkIds,
    };
  }
}
