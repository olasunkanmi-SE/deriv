import { ChunkId, TicketId } from '../types.js';

export interface RetrievalResult {
  ticket_id: TicketId;
  query_text: string;
  selected_chunk_ids: ChunkId[];
  selection_reason: string;
  omitted_relevant_risk: string | null;
}
