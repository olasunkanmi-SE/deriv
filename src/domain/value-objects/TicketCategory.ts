import { VocabularyError } from '../errors.js';

export const TICKET_CATEGORIES = [
  'withdrawal_delay',
  'account_security',
  'account_access',
  'trade_dispute',
  'general_query',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export function parseTicketCategory(s: string): TicketCategory {
  if ((TICKET_CATEGORIES as readonly string[]).includes(s)) {
    return s as TicketCategory;
  }
  throw new VocabularyError('TicketCategory', s, TICKET_CATEGORIES);
}
