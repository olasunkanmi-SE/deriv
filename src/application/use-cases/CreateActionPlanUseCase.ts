import { Action, ActionPlan } from '../../domain/entities/ActionPlan.js';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { RetrievalResult } from '../../domain/entities/RetrievalResult.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { ILLMService } from '../../domain/services/ILLMService.js';
import { parseActionPriority } from '../../domain/value-objects/ActionPriority.js';
import { parseQueue } from '../../domain/value-objects/Queue.js';
import { buildActionPlanPrompt } from '../prompts/buildActionPlanPrompt.js';

export interface CreateActionPlanResult {
  actionPlans: ActionPlan[];
  nextState: PipelineState;
}

export class CreateActionPlanUseCase {
  constructor(
    private readonly llm: ILLMService,
    private readonly artifactRepo: IArtifactRepository,
  ) {}

  async execute(
    tickets: Ticket[],
    triageResults: TriageResult[],
    responseDrafts: ResponseDraft[],
    retrievalResults: RetrievalResult[],
    allChunks: KnowledgeChunk[],
    currentState: PipelineState,
  ): Promise<CreateActionPlanResult> {
    assertState(currentState, PipelineState.RESPONSE_DRAFTED);

    const triageMap = new Map(triageResults.map((t) => [t.ticket_id, t]));
    const draftMap = new Map(responseDrafts.map((d) => [d.ticket_id, d]));
    const retrievalMap = new Map(retrievalResults.map((r) => [r.ticket_id, r]));
    const chunkMap = new Map(allChunks.map((c) => [c.chunk_id, c]));
    const actionPlans: ActionPlan[] = [];

    for (const ticket of tickets) {
      const triage = triageMap.get(ticket.ticket_id);
      if (!triage) {
        console.warn(`[ActionPlan] No triage result for ${ticket.ticket_id}, skipping`);
        continue;
      }

      const draft = draftMap.get(ticket.ticket_id);
      if (!draft) {
        console.warn(`[ActionPlan] No response draft for ${ticket.ticket_id}, skipping`);
        continue;
      }

      const retrieval = retrievalMap.get(ticket.ticket_id);
      const selectedChunkIds = retrieval?.selected_chunk_ids ?? [];
      const selectedChunks = selectedChunkIds
        .map((id) => chunkMap.get(id))
        .filter((c): c is KnowledgeChunk => c !== undefined);

      process.stdout.write(`  Planning actions for ${ticket.ticket_id}...`);
      const prompt = buildActionPlanPrompt(ticket, triage, draft, selectedChunks);
      const raw = await this.llm.complete({
        prompt,
        stage: 'action_planning',
        ticketIds: [ticket.ticket_id],
        chunkIds: selectedChunkIds,
        inputArtifacts: [
          'tickets.json',
          'artifacts/knowledge_corpus.json',
          'artifacts/retrieval_results.json',
          'artifacts/triage.json',
          'artifacts/response_drafts.json',
        ],
        outputArtifact: 'artifacts/action_plan.json',
      });

      const plan = this.parseAndValidate(raw, ticket.ticket_id, selectedChunkIds);
      actionPlans.push(plan);
      process.stdout.write(` done (${plan.actions.length} action(s))\n`);
    }

    await this.artifactRepo.write('action_plan.json', actionPlans);

    return {
      actionPlans,
      nextState: nextState(PipelineState.RESPONSE_DRAFTED),
    };
  }

  private parseAndValidate(
    raw: string,
    ticketId: string,
    allowedChunkIds: string[],
  ): ActionPlan {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.warn(`[ActionPlan] Invalid JSON for ${ticketId}, using safe defaults`);
      parsed = {};
    }

    const rawActions = Array.isArray(parsed['actions']) ? parsed['actions'] : [];
    const validActionIds = new Set<string>();
    const actions: Action[] = [];
    let counter = 1;

    for (const rawAction of rawActions) {
      if (typeof rawAction !== 'object' || rawAction === null) continue;
      const a = rawAction as Record<string, unknown>;

      const actionId = `A-${ticketId}-${counter}`;
      counter++;

      let ownerQueue = parseQueueSafe(typeof a['owner_queue'] === 'string' ? a['owner_queue'] : '');
      if (!ownerQueue) ownerQueue = 'customer_support';

      let priority = parsePrioritySafe(typeof a['priority'] === 'string' ? a['priority'] : '');
      if (!priority) priority = 'P2';

      const rawDepends = Array.isArray(a['depends_on']) ? a['depends_on'] : [];
      const dependsOn = rawDepends.filter(
        (id): id is string => typeof id === 'string' && validActionIds.has(id),
      );

      const description = typeof a['description'] === 'string' && a['description'].trim()
        ? a['description'].trim()
        : 'Review and resolve customer issue.';

      validActionIds.add(actionId);
      actions.push({ action_id: actionId, description, owner_queue: ownerQueue, priority, depends_on: dependsOn });
    }

    if (actions.length === 0) {
      actions.push({
        action_id: `A-${ticketId}-1`,
        description: 'Review and resolve customer issue.',
        owner_queue: 'customer_support',
        priority: 'P2',
        depends_on: [],
      });
    }

    const handoffNote = typeof parsed['handoff_note'] === 'string' && parsed['handoff_note'].trim()
      ? parsed['handoff_note'].trim()
      : `Ticket ${ticketId} requires follow-up. Please review and take appropriate action.`;

    return { ticket_id: ticketId, actions, handoff_note: handoffNote };
  }
}

function parseQueueSafe(s: string) {
  try { return parseQueue(s); } catch { return null; }
}

function parsePrioritySafe(s: string) {
  try { return parseActionPriority(s); } catch { return null; }
}
