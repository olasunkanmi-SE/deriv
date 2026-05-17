import { TicketId } from '../types.js';

export type CustomerTier = 'standard' | 'vip';

export interface RawTicket {
  ticket_id: TicketId;
  submitted_at: string;
  customer_tier: CustomerTier;
  language: string;
  subject: string;
  message: string;
}
