import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { TICKET_CATEGORIES } from '../../domain/value-objects/TicketCategory.js';
import { URGENCY_LEVELS } from '../../domain/value-objects/UrgencyLevel.js';
import { SENTIMENTS } from '../../domain/value-objects/Sentiment.js';
import { RESOLUTION_MODES } from '../../domain/value-objects/ResolutionMode.js';
import { QUEUES } from '../../domain/value-objects/Queue.js';

export function buildTriagePrompt(ticket: Ticket, chunks: KnowledgeChunk[]): string {
  const chunkContext = chunks.length > 0
    ? chunks.map((c) => `[${c.chunk_id}] ${c.section_title}\n${c.text}`).join('\n\n')
    : '(no knowledge base context available for this ticket)';

  return `You are a support triage specialist for a financial trading platform.

## Ticket
ticket_id: ${ticket.ticket_id}
customer_tier: ${ticket.customer_tier}
submitted_at: ${ticket.submitted_at}
subject: ${ticket.subject}
message: ${ticket.message}

## Knowledge Base Context
${chunkContext}

## Task
Classify the ticket above and return ONLY a JSON object with these exact fields:

{
  "category": <one of: ${TICKET_CATEGORIES.join(' | ')}>,
  "urgency": <one of: ${URGENCY_LEVELS.join(' | ')}>,
  "sentiment": <one of: ${SENTIMENTS.join(' | ')}>,
  "resolution_mode": <one of: ${RESOLUTION_MODES.join(' | ')}>,
  "recommended_queue": <one of: ${QUEUES.join(' | ')}>,
  "reasoning_summary": "<1–2 sentences explaining the classification and urgency>",
  "source_chunk_ids": ["<only chunk IDs from the context above that informed your classification>"]
}

## Classification rules
- urgency must reflect customer risk and business risk, not just emotional tone
- critical: account locked with open positions, suspected fraud, active security breach
- high: multi-day withdrawal delay, account access blocked, security concern
- medium: trade dispute, general policy question with financial impact
- low: informational request, minor clarification
- source_chunk_ids must only reference chunk IDs present in the Knowledge Base Context above
- if retrieval context is insufficient to classify confidently, set resolution_mode to needs_human_review`.trim();
}
