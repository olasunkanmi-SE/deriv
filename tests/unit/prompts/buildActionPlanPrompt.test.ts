import { describe, it, expect } from 'vitest';
import { buildActionPlanPrompt } from '../../../src/application/prompts/buildActionPlanPrompt.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';

function makeTicket(): Ticket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'vip',
    language: 'en',
    subject: 'Withdrawal pending for 3 days',
    message: 'My withdrawal has been pending. When will I receive my funds?',
    retrieval_query: 'withdrawal pending',
    low_retrieval_confidence: false,
  };
}

function makeTriage(): TriageResult {
  return {
    ticket_id: 'T-1001',
    category: 'withdrawal_delay',
    urgency: 'high',
    sentiment: 'negative',
    resolution_mode: 'needs_human_review',
    recommended_queue: 'payments_ops',
    reasoning_summary: 'Customer waiting beyond standard window.',
    source_chunk_ids: ['payments-001'],
  };
}

function makeDraft(): ResponseDraft {
  return {
    ticket_id: 'T-1001',
    response_text: 'Thank you for reaching out. Your withdrawal is under review.',
    tone: 'empathetic',
    contains_policy_claims: true,
    source_chunk_ids: ['payments-001'],
  };
}

function makeChunk(): KnowledgeChunk {
  return {
    document_id: 'payments',
    source_file: 'knowledge_base/payments.md',
    chunk_id: 'payments-001',
    section_title: 'Withdrawals',
    text: 'Verified customers have withdrawals reviewed within 24 hours.',
    character_count: 61,
    content_hash: 'hash',
  };
}

describe('buildActionPlanPrompt', () => {
  it('matches snapshot', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), [makeChunk()]);
    expect(prompt).toMatchSnapshot();
  });

  it('includes ticket subject and message', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('Withdrawal pending for 3 days');
    expect(prompt).toContain('My withdrawal has been pending.');
  });

  it('includes triage category and urgency', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('withdrawal_delay');
    expect(prompt).toContain('high');
    expect(prompt).toContain('payments_ops');
  });

  it('includes the drafted response text', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('Thank you for reaching out. Your withdrawal is under review.');
  });

  it('includes action_id pattern for the ticket', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('A-T-1001-1');
  });

  it('includes all valid queues', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('payments_ops');
    expect(prompt).toContain('trust_and_safety');
    expect(prompt).toContain('customer_support');
  });

  it('includes chunk context when chunks provided', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), [makeChunk()]);
    expect(prompt).toContain('[payments-001]');
    expect(prompt).toContain('Withdrawals');
    expect(prompt).toContain('reviewed within 24 hours');
  });

  it('shows no-context placeholder when chunks are empty', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('no knowledge base context available');
  });

  it('requires ticket-specific handoff note', () => {
    const prompt = buildActionPlanPrompt(makeTicket(), makeTriage(), makeDraft(), []);
    expect(prompt).toContain('ticket-specific');
    expect(prompt).toContain('handoff_note');
  });

  it('is a pure function — identical inputs produce identical output', () => {
    const ticket = makeTicket();
    const triage = makeTriage();
    const draft = makeDraft();
    const chunks = [makeChunk()];
    const a = buildActionPlanPrompt(ticket, triage, draft, chunks);
    const b = buildActionPlanPrompt(ticket, triage, draft, chunks);
    expect(a).toBe(b);
  });
});
