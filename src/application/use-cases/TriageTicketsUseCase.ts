import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { RetrievalResult } from '../../domain/entities/RetrievalResult.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { ILLMService } from '../../domain/services/ILLMService.js';
import { parseTicketCategory } from '../../domain/value-objects/TicketCategory.js';
import { parseUrgencyLevel } from '../../domain/value-objects/UrgencyLevel.js';
import { parseSentiment } from '../../domain/value-objects/Sentiment.js';
import { parseResolutionMode } from '../../domain/value-objects/ResolutionMode.js';
import { parseQueue } from '../../domain/value-objects/Queue.js';
import { buildTriagePrompt } from '../prompts/buildTriagePrompt.js';

export interface TriageTicketsResult {
  triageResults: TriageResult[];
  nextState: PipelineState;
}

export class TriageTicketsUseCase {
  constructor(
    private readonly llm: ILLMService,
    private readonly artifactRepo: IArtifactRepository,
  ) {}

  async execute(
    tickets: Ticket[],
    retrievalResults: RetrievalResult[],
    allChunks: KnowledgeChunk[],
    currentState: PipelineState,
  ): Promise<TriageTicketsResult> {
    assertState(currentState, PipelineState.RETRIEVAL_COMPLETE);

    const retrievalMap = new Map(retrievalResults.map((r) => [r.ticket_id, r]));
    const chunkMap = new Map(allChunks.map((c) => [c.chunk_id, c]));
    const triageResults: TriageResult[] = [];

    for (const ticket of tickets) {
      const retrieval = retrievalMap.get(ticket.ticket_id);
      const selectedChunkIds = retrieval?.selected_chunk_ids ?? [];
      const selectedChunks = selectedChunkIds
        .map((id) => chunkMap.get(id))
        .filter((c): c is KnowledgeChunk => c !== undefined);

      process.stdout.write(`  Triaging ${ticket.ticket_id}...`);
      const prompt = buildTriagePrompt(ticket, selectedChunks);
      const raw = await this.llm.complete({
        prompt,
        stage: 'triage',
        ticketIds: [ticket.ticket_id],
        chunkIds: selectedChunkIds,
        inputArtifacts: [
          'tickets.json',
          'artifacts/knowledge_corpus.json',
          'artifacts/retrieval_results.json',
        ],
        outputArtifact: 'artifacts/triage.json',
      });

      const triage = this.parseAndValidate(raw, ticket, selectedChunkIds);
      triageResults.push(triage);
      process.stdout.write(` ${triage.category} / ${triage.urgency}\n`);
    }

    await this.artifactRepo.write('triage.json', triageResults);

    return {
      triageResults,
      nextState: nextState(PipelineState.RETRIEVAL_COMPLETE),
    };
  }

  private parseAndValidate(
    raw: string,
    ticket: Ticket,
    allowedChunkIds: string[],
  ): TriageResult {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`[TriageTickets] Invalid JSON for ${ticket.ticket_id}, using safe defaults`);
      parsed = {};
    }

    const allowed = new Set(allowedChunkIds);
    const rawChunkIds = Array.isArray(parsed['source_chunk_ids']) ? parsed['source_chunk_ids'] : [];
    const sourceChunkIds = rawChunkIds.filter(
      (id): id is string => typeof id === 'string' && allowed.has(id),
    );

    // Force needs_human_review when retrieval confidence was low
    const resolutionRaw = safeString(parsed['resolution_mode']);
    let resolutionMode = safeParse(resolutionRaw, parseResolutionMode, 'needs_human_review' as const);
    if (ticket.low_retrieval_confidence) {
      resolutionMode = 'needs_human_review';
    }

    return {
      ticket_id: ticket.ticket_id,
      category: safeParse(safeString(parsed['category']), parseTicketCategory, 'general_query' as const),
      urgency: safeParse(safeString(parsed['urgency']), parseUrgencyLevel, 'medium' as const),
      sentiment: safeParse(safeString(parsed['sentiment']), parseSentiment, 'neutral' as const),
      resolution_mode: resolutionMode,
      recommended_queue: safeParse(safeString(parsed['recommended_queue']), parseQueue, 'customer_support' as const),
      reasoning_summary: safeString(parsed['reasoning_summary']) || 'No reasoning provided.',
      source_chunk_ids: sourceChunkIds,
    };
  }
}

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function safeParse<T>(value: string, parser: (s: string) => T, fallback: T): T {
  try {
    return parser(value);
  } catch {
    console.warn(`[TriageTickets] Vocabulary parse failed for "${value}", using fallback`);
    return fallback;
  }
}
