import { ActionPlan } from '../../domain/entities/ActionPlan.js';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';

export function buildGroundingPrompt(
  ticket: Ticket,
  triage: TriageResult,
  draft: ResponseDraft,
  plan: ActionPlan,
  chunks: KnowledgeChunk[],
): string {
  const chunkContext = chunks.length > 0
    ? chunks.map((c) => `[${c.chunk_id}] ${c.section_title}\n${c.text}`).join('\n\n')
    : '(no knowledge base context available)';

  const actionsText = plan.actions
    .map((a) => `  - [${a.action_id}] (${a.owner_queue}, ${a.priority}): ${a.description}`)
    .join('\n');

  return `You are a quality-assurance reviewer for a financial trading platform's support pipeline.
Your job is to verify that a drafted customer response and internal action plan are grounded in the provided knowledge base and do not contain unsupported claims.

## Ticket
ticket_id: ${ticket.ticket_id}
subject: ${ticket.subject}
message: ${ticket.message}

## Triage
category: ${triage.category}
urgency: ${triage.urgency}

## Knowledge Base Context
${chunkContext}

## Drafted Customer Response
${draft.response_text}
source_chunk_ids cited: ${draft.source_chunk_ids.length > 0 ? draft.source_chunk_ids.join(', ') : '(none)'}
contains_policy_claims: ${draft.contains_policy_claims}

## Internal Action Plan
${actionsText}
handoff_note: ${plan.handoff_note}

## Task
Review the response and action plan for grounding issues. For each issue found, produce a validation record.
Return ONLY a JSON array. Each element has this shape:

{
  "artifact": "response_drafts.json" | "action_plan.json",
  "claim": "<the specific claim being evaluated>",
  "grounded": true | false,
  "source_type": "knowledge_base" | "ticket" | "derived",
  "source_chunk_ids": ["<chunk IDs that support this claim, or empty array>"],
  "issue": "<description of the problem, or null if grounded>",
  "recommended_fix": "<how to fix the issue, or null if grounded>"
}

## Grounding rules
- A claim is grounded if it is directly supported by the knowledge base chunks listed above, by the ticket content itself, or is a reasonable inference (source_type: derived)
- A claim is NOT grounded if it asserts specific timelines, procedures, or policies not present in any chunk
- A claim is NOT grounded if it uses source_chunk_ids not present in the Knowledge Base Context above
- The handoff_note must reference specifics of this ticket — a generic note is not grounded
- If everything looks correct, return an empty array []`.trim();
}
