import { describe, it, expect } from 'vitest';
import { buildTriagePrompt } from '../../../src/application/prompts/buildTriagePrompt.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending for 3 days',
    message: 'My withdrawal has been pending for three days. When will I receive my funds?',
    retrieval_query: 'Withdrawal pending for 3 days. My withdrawal has been pending.',
    low_retrieval_confidence: false,
    ...overrides,
  };
}

function makeChunk(id: string, title: string, text: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: title,
    text,
    character_count: text.length,
    content_hash: 'hash',
  };
}

const SAMPLE_CHUNKS: KnowledgeChunk[] = [
  makeChunk('payments-001', 'Withdrawals', 'Verified customers have withdrawals reviewed within 24 hours.'),
  makeChunk('support_sla-001', 'Support prioritisation', 'VIP and security cases are prioritised.'),
];

describe('buildTriagePrompt', () => {
  it('matches snapshot', () => {
    const prompt = buildTriagePrompt(makeTicket(), SAMPLE_CHUNKS);
    expect(prompt).toMatchSnapshot();
  });

  it('includes the ticket ID, subject, and message', () => {
    const ticket = makeTicket({ ticket_id: 'T-1001', subject: 'Test subject', message: 'Test body.' });
    const prompt = buildTriagePrompt(ticket, []);
    expect(prompt).toContain('T-1001');
    expect(prompt).toContain('Test subject');
    expect(prompt).toContain('Test body.');
  });

  it('includes the customer tier', () => {
    const prompt = buildTriagePrompt(makeTicket({ customer_tier: 'vip' }), []);
    expect(prompt).toContain('vip');
  });

  it('includes all controlled vocabulary values', () => {
    const prompt = buildTriagePrompt(makeTicket(), []);
    expect(prompt).toContain('withdrawal_delay');
    expect(prompt).toContain('account_security');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('needs_human_review');
    expect(prompt).toContain('payments_ops');
  });

  it('includes each chunk ID and section title in the context', () => {
    const prompt = buildTriagePrompt(makeTicket(), SAMPLE_CHUNKS);
    expect(prompt).toContain('[payments-001]');
    expect(prompt).toContain('Withdrawals');
    expect(prompt).toContain('[support_sla-001]');
    expect(prompt).toContain('Support prioritisation');
  });

  it('includes chunk text in the context', () => {
    const prompt = buildTriagePrompt(makeTicket(), SAMPLE_CHUNKS);
    expect(prompt).toContain('reviewed within 24 hours');
  });

  it('shows a no-context placeholder when chunks are empty', () => {
    const prompt = buildTriagePrompt(makeTicket(), []);
    expect(prompt).toContain('no knowledge base context available');
  });

  it('is a pure function — same inputs always produce identical output', () => {
    const ticket = makeTicket();
    const a = buildTriagePrompt(ticket, SAMPLE_CHUNKS);
    const b = buildTriagePrompt(ticket, SAMPLE_CHUNKS);
    expect(a).toBe(b);
  });
});
