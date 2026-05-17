import { ChunkId, TicketId } from '../types.js';

export interface ResponseDraft {
  ticket_id: TicketId;
  response_text: string;
  tone: string;
  contains_policy_claims: boolean;
  source_chunk_ids: ChunkId[];
}
