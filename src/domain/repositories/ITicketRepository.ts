import { RawTicket } from '../entities/RawTicket.js';

export interface ITicketRepository {
  loadAll(): Promise<RawTicket[]>;
}
