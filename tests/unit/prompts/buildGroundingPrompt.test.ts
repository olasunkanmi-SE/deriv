import { describe, it, expect } from 'vitest';
import { buildGroundingPrompt } from '../../../src/application/prompts/buildGroundingPrompt.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import type { TriageResult } from '../../../src/domain/entities/TriageResult.js';

function makeTicket(): Ticket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending',
    message: 'My withdrawal is pending for 3 days.',
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
    response_text: 'Your withdrawal review takes 24 hours.',
    tone: 'professional',
    contains_policy_claims: true,
    source_chunk_ids: ['payments-001'],
  };
}

function makePlan(): ActionPlan {
  return {
    ticket_id: 'T-1001',
    actions: [
      {
        action_id: 'A-T-1001-1',
        description: 'Escalate to payments_ops.',
        owner_queue: 'payments_ops',
        priority: 'P1',
        depends_on: [],
      },
    ],
    handoff_note: 'Customer T-1001 awaits resolution.',
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

describe('buildGroundingPrompt', () => {
  it('matches snapshot', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), [makeChunk()]);
    expect(prompt).toMatchSnapshot();
  });

  it('includes ticket subject and message', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), []);
    expect(prompt).toContain('Withdrawal pending');
    expect(prompt).toContain('My withdrawal is pending for 3 days.');
  });

  it('includes drafted response text', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), []);
    expect(prompt).toContain('Your withdrawal review takes 24 hours.');
  });

  it('includes action plan actions and handoff note', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), []);
    expect(prompt).toContain('A-T-1001-1');
    expect(prompt).toContain('Customer T-1001 awaits resolution.');
  });

  it('includes chunk context when chunks provided', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), [makeChunk()]);
    expect(prompt).toContain('[payments-001]');
    expect(prompt).toContain('reviewed within 24 hours');
  });

  it('shows no-context placeholder when chunks are empty', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), []);
    expect(prompt).toContain('no knowledge base context available');
  });

  it('instructs return of a JSON array', () => {
    const prompt = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), []);
    expect(prompt).toContain('JSON array');
  });

  it('is a pure function — identical inputs produce identical output', () => {
    const a = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), [makeChunk()]);
    const b = buildGroundingPrompt(makeTicket(), makeTriage(), makeDraft(), makePlan(), [makeChunk()]);
    expect(a).toBe(b);
  });
});
