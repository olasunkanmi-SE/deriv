import { RawTicket } from './RawTicket.js';

export interface Ticket extends RawTicket {
  retrieval_query: string;
  low_retrieval_confidence?: boolean;
}
