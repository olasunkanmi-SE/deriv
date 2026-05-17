import { describe, it, expect } from 'vitest';
import { buildResponsePrompt } from '../../../src/application/prompts/buildResponsePrompt.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending for 3 days',
    message: 'My withdrawal has been pending. When will I receive my funds?',
    retrieval_query: 'withdrawal pending',
    low_retrieval_confidence: false,
    ...overrides,
  };
}

function makeTriage(overrides: Partial<TriageResult> = {}): TriageResult {
  return {
    ticket_id: 'T-1001',
    category: 'withdrawal_delay',
    urgency: 'high',
    sentiment: 'negative',
    resolution_mode: 'needs_human_review',
    recommended_queue: 'payments_ops',
    reasoning_summary: 'Customer waiting beyond standard window.',
    source_chunk_ids: ['payments-001'],
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

const CHUNKS: KnowledgeChunk[] = [
  makeChunk('payments-001', 'Withdrawals', 'Verified customers have withdrawals reviewed within 24 hours.'),
];

describe('buildResponsePrompt', () => {
  it('matches snapshot', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), CHUNKS);
    expect(prompt).toMatchSnapshot();
  });

  it('includes the ticket subject and message', () => {
    const ticket = makeTicket({ subject: 'Test subject', message: 'Test message body.' });
    const prompt = buildResponsePrompt(ticket, makeTriage(), []);
    expect(prompt).toContain('Test subject');
    expect(prompt).toContain('Test message body.');
  });

  it('includes triage category, urgency and queue', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), CHUNKS);
    expect(prompt).toContain('withdrawal_delay');
    expect(prompt).toContain('high');
    expect(prompt).toContain('payments_ops');
  });

  it('includes the chunk ID and section title in context', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), CHUNKS);
    expect(prompt).toContain('[payments-001]');
    expect(prompt).toContain('Withdrawals');
  });

  it('includes chunk text in the context', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), CHUNKS);
    expect(prompt).toContain('reviewed within 24 hours');
  });

  it('shows no-context placeholder when chunks are empty', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), []);
    expect(prompt).toContain('no knowledge base context available');
  });

  it('includes all hard constraints', () => {
    const prompt = buildResponsePrompt(makeTicket(), makeTriage(), []);
    expect(prompt).toContain('Do NOT guarantee');
    expect(prompt).toContain('Do NOT claim');
    expect(prompt).toContain('Do NOT provide financial advice');
  });

  it('adds a low-confidence note when ticket has low_retrieval_confidence', () => {
    const ticket = makeTicket({ low_retrieval_confidence: true });
    const prompt = buildResponsePrompt(ticket, makeTriage(), []);
    expect(prompt).toContain('Retrieval confidence for this ticket is low');
  });

  it('does not include the low-confidence note for normal tickets', () => {
    const prompt = buildResponsePrompt(makeTicket({ low_retrieval_confidence: false }), makeTriage(), []);
    expect(prompt).not.toContain('Retrieval confidence');
  });

  it('is a pure function — identical inputs produce identical output', () => {
    const ticket = makeTicket();
    const triage = makeTriage();
    const a = buildResponsePrompt(ticket, triage, CHUNKS);
    const b = buildResponsePrompt(ticket, triage, CHUNKS);
    expect(a).toBe(b);
  });
});
