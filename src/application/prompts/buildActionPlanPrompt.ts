import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { ResponseDraft } from '../../domain/entities/ResponseDraft.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';
import { ACTION_PRIORITIES } from '../../domain/value-objects/ActionPriority.js';
import { QUEUES } from '../../domain/value-objects/Queue.js';

export function buildActionPlanPrompt(
  ticket: Ticket,
  triage: TriageResult,
  draft: ResponseDraft,
  chunks: KnowledgeChunk[],
): string {
  const chunkContext = chunks.length > 0
    ? chunks.map((c) => `[${c.chunk_id}] ${c.section_title}\n${c.text}`).join('\n\n')
    : '(no knowledge base context available for this ticket)';

  return `You are an internal operations coordinator for a financial trading platform.
Given a support ticket, its triage result, and a drafted customer response, produce a concrete action plan for internal teams.

## Ticket
ticket_id: ${ticket.ticket_id}
customer_tier: ${ticket.customer_tier}
subject: ${ticket.subject}
message: ${ticket.message}

## Triage Context
category: ${triage.category}
urgency: ${triage.urgency}
sentiment: ${triage.sentiment}
recommended_queue: ${triage.recommended_queue}
resolution_mode: ${triage.resolution_mode}
reasoning_summary: ${triage.reasoning_summary}

## Drafted Customer Response
${draft.response_text}

## Knowledge Base Context
${chunkContext}

## Task
Produce an internal action plan for resolving this ticket.
Return ONLY a JSON object with these exact fields:

{
  "actions": [
    {
      "action_id": "A-${ticket.ticket_id}-1",
      "description": "<specific, concrete action for this ticket — not generic>",
      "owner_queue": "<one of: ${QUEUES.join(' | ')}>",
      "priority": "<one of: ${ACTION_PRIORITIES.join(' | ')}>",
      "depends_on": ["<action_id of a prerequisite action, or empty array>"]
    }
  ],
  "handoff_note": "<ticket-specific internal note for the receiving team — reference the customer's actual situation, not generic instructions>"
}

## Constraints
- action_id pattern must be A-${ticket.ticket_id}-N where N starts at 1
- owner_queue must be one of: ${QUEUES.join(', ')}
- priority must be one of: ${ACTION_PRIORITIES.join(', ')} (P0 = critical, P3 = low)
- depends_on must only reference action_ids defined in this same actions array
- handoff_note MUST reference specifics of this ticket (customer tier, category, urgency, or message content) — do not write a generic note that could apply to any ticket
- Do not duplicate actions already completed (e.g. do not say "send acknowledgement" if the response draft already does that)
- source_chunk_ids should list any chunk IDs from the knowledge base context you relied on`.trim();
}
