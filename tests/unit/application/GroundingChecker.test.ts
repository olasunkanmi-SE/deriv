import { describe, it, expect } from 'vitest';
import { GroundingChecker } from '../../../src/application/services/GroundingChecker.js';
import type { ActionPlan } from '../../../src/domain/entities/ActionPlan.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { ResponseDraft } from '../../../src/domain/entities/ResponseDraft.js';

function makeChunk(id: string, text: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: 'Section',
    text,
    character_count: text.length,
    content_hash: 'hash',
  };
}

function makeDraft(overrides: Partial<ResponseDraft> = {}): ResponseDraft {
  return {
    ticket_id: 'T-1001',
    response_text: 'Your withdrawal review takes 24 hours for verified customers.',
    tone: 'professional',
    contains_policy_claims: true,
    source_chunk_ids: ['payments-001'],
    ...overrides,
  };
}

function makePlan(overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    ticket_id: 'T-1001',
    actions: [
      {
        action_id: 'A-T-1001-1',
        description: 'Escalate withdrawal case to payments team for manual review and resolution.',
        owner_queue: 'payments_ops',
        priority: 'P1',
        depends_on: [],
      },
    ],
    handoff_note: 'VIP customer T-1001 has a withdrawal pending beyond 3 days. Payments team must review.',
    ...overrides,
  };
}

const CORPUS = [
  makeChunk('payments-001', 'Verified customers have withdrawals reviewed within 24 hours.'),
];

describe('GroundingChecker', () => {
  const checker = new GroundingChecker();

  it('returns empty array when all citations are valid and well-grounded', () => {
    const results = checker.check([makeDraft()], [makePlan()], CORPUS);
    const ungrounded = results.filter((r) => !r.grounded);
    expect(ungrounded).toHaveLength(0);
  });

  it('flags a draft that cites a non-existent chunk ID', () => {
    const draft = makeDraft({ source_chunk_ids: ['payments-001', 'GHOST-999'] });
    const results = checker.check([draft], [makePlan()], CORPUS);
    const ghostIssue = results.find((r) => r.source_chunk_ids.includes('GHOST-999'));
    expect(ghostIssue).toBeDefined();
    expect(ghostIssue?.grounded).toBe(false);
    expect(ghostIssue?.issue).toContain('GHOST-999');
  });

  it('flags a draft with contains_policy_claims=true but no source_chunk_ids', () => {
    const draft = makeDraft({ contains_policy_claims: true, source_chunk_ids: [] });
    const results = checker.check([draft], [makePlan()], CORPUS);
    const policyIssue = results.find((r) => r.claim.includes('policy claims'));
    expect(policyIssue).toBeDefined();
    expect(policyIssue?.grounded).toBe(false);
  });

  it('marks citation as grounded when response tokens overlap with chunk text', () => {
    const draft = makeDraft({
      response_text: 'Verified customers withdrawal reviewed within hours.',
      source_chunk_ids: ['payments-001'],
    });
    const results = checker.check([draft], [makePlan()], CORPUS);
    const citation = results.find((r) => r.source_chunk_ids.includes('payments-001'));
    expect(citation?.grounded).toBe(true);
  });

  it('flags a draft citation with no token overlap with the chunk', () => {
    const draft = makeDraft({
      response_text: 'Please contact our team regarding your account balance.',
      source_chunk_ids: ['payments-001'],
    });
    const results = checker.check([draft], [makePlan()], CORPUS);
    const citation = results.find((r) => r.source_chunk_ids.includes('payments-001') && r.artifact === 'response_drafts.json');
    expect(citation?.grounded).toBe(false);
  });

  it('flags an action plan with a missing or trivial handoff note', () => {
    const plan = makePlan({ handoff_note: 'Follow up.' });
    const results = checker.check([makeDraft()], [plan], CORPUS);
    const noteIssue = results.find((r) => r.claim.includes('handoff note'));
    expect(noteIssue).toBeDefined();
    expect(noteIssue?.grounded).toBe(false);
  });

  it('flags an action with a trivial description', () => {
    const plan = makePlan({
      actions: [{
        action_id: 'A-T-1001-1',
        description: 'Act.',
        owner_queue: 'payments_ops',
        priority: 'P1',
        depends_on: [],
      }],
    });
    const results = checker.check([makeDraft()], [plan], CORPUS);
    const descIssue = results.find((r) => r.claim.includes('A-T-1001-1') && r.claim.includes('description'));
    expect(descIssue).toBeDefined();
    expect(descIssue?.grounded).toBe(false);
  });

  it('processes multiple tickets independently', () => {
    const draft1 = makeDraft({ ticket_id: 'T-1001' });
    const draft2: ResponseDraft = { ...makeDraft(), ticket_id: 'T-1002', source_chunk_ids: ['MISSING-999'] };
    const plan1 = makePlan({ ticket_id: 'T-1001' });
    const plan2: ActionPlan = { ...makePlan(), ticket_id: 'T-2002' };

    const results = checker.check([draft1, draft2], [plan1, plan2], CORPUS);
    const t2Issues = results.filter((r) => r.ticket_id === 'T-1002' && !r.grounded);
    expect(t2Issues.length).toBeGreaterThan(0);
  });
});
