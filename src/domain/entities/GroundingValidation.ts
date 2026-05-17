import { ChunkId, TicketId } from '../types.js';

export type SourceType = 'ticket' | 'knowledge_base' | 'derived';

export interface GroundingValidation {
  ticket_id: TicketId;
  artifact: string;
  claim: string;
  grounded: boolean;
  source_type: SourceType;
  source_chunk_ids: ChunkId[];
  issue: string | null;
  recommended_fix: string | null;
}
