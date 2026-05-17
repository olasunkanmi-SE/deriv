import { ChunkId, TicketId } from '../types.js';
import { Queue } from '../value-objects/Queue.js';
import { ResolutionMode } from '../value-objects/ResolutionMode.js';
import { Sentiment } from '../value-objects/Sentiment.js';
import { TicketCategory } from '../value-objects/TicketCategory.js';
import { UrgencyLevel } from '../value-objects/UrgencyLevel.js';

export interface TriageResult {
  ticket_id: TicketId;
  category: TicketCategory;
  urgency: UrgencyLevel;
  sentiment: Sentiment;
  resolution_mode: ResolutionMode;
  recommended_queue: Queue;
  reasoning_summary: string;
  source_chunk_ids: ChunkId[];
}
