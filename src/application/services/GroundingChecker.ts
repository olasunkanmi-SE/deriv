import { ActionPlan } from '../../domain/entities/ActionPlan.js';
import { GroundingValidation } from '../../domain/entities/GroundingValidation.js';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';

export class GroundingChecker {
  check(
    drafts: ResponseDraft[],
    actionPlans: ActionPlan[],
    corpus: KnowledgeChunk[],
  ): GroundingValidation[] {
    const chunkIndex = new Map(corpus.map((c) => [c.chunk_id, c]));
    const results: GroundingValidation[] = [];

    for (const draft of drafts) {
      results.push(...this.checkDraft(draft, chunkIndex));
    }

    for (const plan of actionPlans) {
      results.push(...this.checkActionPlan(plan, chunkIndex));
    }

    return results;
  }

  private checkDraft(
    draft: ResponseDraft,
    chunkIndex: Map<string, KnowledgeChunk>,
  ): GroundingValidation[] {
    const validations: GroundingValidation[] = [];

    for (const chunkId of draft.source_chunk_ids) {
      const chunk = chunkIndex.get(chunkId);
      if (!chunk) {
        validations.push({
          ticket_id: draft.ticket_id,
          artifact: 'response_drafts.json',
          claim: `Response cites chunk ${chunkId}`,
          grounded: false,
          source_type: 'knowledge_base',
          source_chunk_ids: [chunkId],
          issue: `Chunk ID "${chunkId}" not found in knowledge corpus`,
          recommended_fix: `Remove reference to "${chunkId}" from source_chunk_ids`,
        });
        continue;
      }

      const overlap = hasTokenOverlap(draft.response_text, chunk.text);
      validations.push({
        ticket_id: draft.ticket_id,
        artifact: 'response_drafts.json',
        claim: `Response cites chunk ${chunkId} (${chunk.section_title})`,
        grounded: overlap,
        source_type: 'knowledge_base',
        source_chunk_ids: [chunkId],
        issue: overlap ? null : `Response text shares no significant tokens with chunk "${chunkId}"`,
        recommended_fix: overlap ? null : `Revise response to accurately reflect chunk "${chunkId}", or remove the citation`,
      });
    }

    if (draft.contains_policy_claims && draft.source_chunk_ids.length === 0) {
      validations.push({
        ticket_id: draft.ticket_id,
        artifact: 'response_drafts.json',
        claim: 'Response contains policy claims but has no source chunks',
        grounded: false,
        source_type: 'knowledge_base',
        source_chunk_ids: [],
        issue: 'contains_policy_claims is true but source_chunk_ids is empty',
        recommended_fix: 'Add supporting chunk IDs or set contains_policy_claims to false',
      });
    }

    return validations;
  }

  private checkActionPlan(
    plan: ActionPlan,
    chunkIndex: Map<string, KnowledgeChunk>,
  ): GroundingValidation[] {
    const validations: GroundingValidation[] = [];

    if (!plan.handoff_note || plan.handoff_note.trim().length < 20) {
      validations.push({
        ticket_id: plan.ticket_id,
        artifact: 'action_plan.json',
        claim: 'Action plan has a non-trivial handoff note',
        grounded: false,
        source_type: 'ticket',
        source_chunk_ids: [],
        issue: 'Handoff note is missing or too short to be ticket-specific',
        recommended_fix: 'Write a handoff note that references the customer situation',
      });
    }

    for (const action of plan.actions) {
      if (!action.description || action.description.trim().length < 10) {
        validations.push({
          ticket_id: plan.ticket_id,
          artifact: 'action_plan.json',
          claim: `Action ${action.action_id} has a meaningful description`,
          grounded: false,
          source_type: 'ticket',
          source_chunk_ids: [],
          issue: `Action "${action.action_id}" description is too short or empty`,
          recommended_fix: 'Provide a concrete, specific action description',
        });
      }
    }

    // Verify any chunk references in action descriptions exist in corpus
    const chunkRefPattern = /\[([a-z0-9\-]+)\]/gi;
    for (const action of plan.actions) {
      const matches = [...action.description.matchAll(chunkRefPattern)];
      for (const match of matches) {
        const refId = match[1];
        if (refId && !chunkIndex.has(refId)) {
          validations.push({
            ticket_id: plan.ticket_id,
            artifact: 'action_plan.json',
            claim: `Action ${action.action_id} references chunk ${refId}`,
            grounded: false,
            source_type: 'knowledge_base',
            source_chunk_ids: [refId],
            issue: `Chunk ID "${refId}" referenced in action description not found in corpus`,
            recommended_fix: `Remove or correct the reference to "${refId}"`,
          });
        }
      }
    }

    return validations;
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
}

function hasTokenOverlap(responseText: string, chunkText: string): boolean {
  const responseTokens = tokenize(responseText);
  const chunkTokens = tokenize(chunkText);
  let shared = 0;
  for (const token of responseTokens) {
    if (chunkTokens.has(token)) shared++;
  }
  const responseSize = responseTokens.size;
  if (responseSize === 0) return false;
  const jaccard = shared / (responseSize + chunkTokens.size - shared);
  return shared >= 3 || jaccard >= 0.1;
}
