import fs from 'node:fs/promises';
import { RawTicket, CustomerTier } from '../../domain/entities/RawTicket.js';
import { ITicketRepository } from '../../domain/repositories/ITicketRepository.js';

const VALID_TIERS = new Set<string>(['standard', 'vip']);

export class FileTicketRepository implements ITicketRepository {
  constructor(private readonly ticketsPath: string) {}

  async loadAll(): Promise<RawTicket[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ticketsPath, 'utf-8');
    } catch (err) {
      throw new Error(`[FileTicketRepository] Cannot read "${this.ticketsPath}": ${String(err)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`[FileTicketRepository] Invalid JSON in "${this.ticketsPath}": ${String(err)}`);
    }

    if (!isObject(parsed) || !Array.isArray((parsed as Record<string, unknown>)['tickets'])) {
      throw new Error(`[FileTicketRepository] Expected { tickets: [...] } in "${this.ticketsPath}"`);
    }

    const items = (parsed as Record<string, unknown>)['tickets'] as unknown[];
    const tickets: RawTicket[] = [];

    for (const item of items) {
      const ticket = validateTicket(item);
      if (ticket === null) {
        console.warn(`[FileTicketRepository] Skipping invalid ticket: ${JSON.stringify(item)}`);
        continue;
      }
      tickets.push(ticket);
    }

    return tickets;
  }
}

function validateTicket(item: unknown): RawTicket | null {
  if (!isObject(item)) return null;

  const t = item as Record<string, unknown>;
  if (
    typeof t['ticket_id'] !== 'string' || !t['ticket_id'] ||
    typeof t['submitted_at'] !== 'string' || !t['submitted_at'] ||
    typeof t['language'] !== 'string' || !t['language'] ||
    typeof t['subject'] !== 'string' || !t['subject'] ||
    typeof t['message'] !== 'string' || !t['message'] ||
    typeof t['customer_tier'] !== 'string' ||
    !VALID_TIERS.has(t['customer_tier'] as string)
  ) {
    return null;
  }

  return {
    ticket_id: t['ticket_id'] as string,
    submitted_at: t['submitted_at'] as string,
    customer_tier: t['customer_tier'] as CustomerTier,
    language: t['language'] as string,
    subject: t['subject'] as string,
    message: t['message'] as string,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
