import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TriageResult } from '../../domain/entities/TriageResult.js';

export function buildResponsePrompt(
  ticket: Ticket,
  triage: TriageResult,
  chunks: KnowledgeChunk[],
): string {
  const chunkContext = chunks.length > 0
    ? chunks.map((c) => `[${c.chunk_id}] ${c.section_title}\n${c.text}`).join('\n\n')
    : '(no knowledge base context available for this ticket)';

  const lowConfNote = ticket.low_retrieval_confidence
    ? '\nNOTE: Retrieval confidence for this ticket is low. Be conservative — do not assert specific policies. Refer the customer to our support team for definitive guidance.\n'
    : '';

  return `You are a support agent for a financial trading platform writing a customer-facing response.

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
${lowConfNote}
## Knowledge Base Context
${chunkContext}

## Task
Write a clear, empathetic customer-facing response grounded in the knowledge base context above.
Return ONLY a JSON object with these exact fields:

{
  "response_text": "<the full customer-facing response, addressed directly to the customer>",
  "tone": "<one word describing the tone: empathetic | professional | apologetic | informational>",
  "contains_policy_claims": <true if the response references any policy rules or timelines, false otherwise>,
  "source_chunk_ids": ["<only chunk IDs from the context above that you cited in the response>"]
}

## Hard constraints — violations will cause the response to be rejected
- Do NOT guarantee specific payout timing or outcomes unless the knowledge base states it explicitly
- Do NOT claim that actions were already taken unless the ticket or knowledge base confirms it
- Do NOT provide financial advice, trading recommendations, or market predictions
- Do NOT provide security advice that contradicts or goes beyond the knowledge base
- Do NOT use phrases like "we have already" or "we will immediately" unless justified by the sources
- If the knowledge base does not cover the customer's concern, acknowledge the situation honestly and advise them to contact support
- source_chunk_ids must only reference chunk IDs present in the Knowledge Base Context above
- contains_policy_claims must be true whenever the response mentions timelines, procedures, or platform policies`.trim();
}
