import { TicketId } from '../types.js';

export interface QueueRankingItem {
  rank: number;
  ticket_id: TicketId;
  why: string;
}
