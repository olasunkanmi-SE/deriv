import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PipelineOrchestrator } from '../../src/application/pipeline/PipelineOrchestrator.js';
import { PipelineState } from '../../src/domain/pipeline/PipelineState.js';
import { SpyLLMCallLogger } from '../stubs/SpyLLMCallLogger.js';
import { StubLLMService } from '../stubs/StubLLMService.js';
import { FileArtifactRepository } from '../../src/infrastructure/repositories/FileArtifactRepository.js';
import { FileKnowledgeRepository } from '../../src/infrastructure/repositories/FileKnowledgeRepository.js';
import { FileTicketRepository } from '../../src/infrastructure/repositories/FileTicketRepository.js';
import { MarkdownChunker } from '../../src/infrastructure/retrieval/MarkdownChunker.js';
import { TfIdfBm25Retriever } from '../../src/infrastructure/retrieval/TfIdfBm25Retriever.js';
import { JsonlLLMCallLogger } from '../../src/infrastructure/llm/JsonlLLMCallLogger.js';

// ─── fixture responses ────────────────────────────────────────────────────────

function makeTriage(ticketId: string, queue: string, category: string) {
  return JSON.stringify({
    category,
    urgency: 'high',
    sentiment: 'negative',
    resolution_mode: 'needs_human_review',
    recommended_queue: queue,
    reasoning_summary: `Customer ${ticketId} requires attention.`,
    source_chunk_ids: [],
  });
}

function makeDraft(ticketId: string) {
  return JSON.stringify({
    response_text: `Thank you for contacting us about ticket ${ticketId}. Our team is reviewing your case.`,
    tone: 'empathetic',
    contains_policy_claims: false,
    source_chunk_ids: [],
  });
}

function makeActionPlan(ticketId: string) {
  return JSON.stringify({
    actions: [
      {
        action_id: `A-${ticketId}-1`,
        description: `Review and resolve the issue reported in ticket ${ticketId} with appropriate team intervention.`,
        owner_queue: 'customer_support',
        priority: 'P2',
        depends_on: [],
      },
    ],
    handoff_note: `Ticket ${ticketId} requires follow-up. Customer reported a specific issue requiring team review. Please prioritise based on urgency and tier.`,
  });
}

const TICKET_IDS = ['T-1001', 'T-1002', 'T-1003', 'T-1004'];

const TRIAGE_FIXTURES: Record<string, string> = {
  'T-1001': makeTriage('T-1001', 'payments_ops', 'withdrawal_delay'),
  'T-1002': makeTriage('T-1002', 'trust_and_safety', 'account_access'),
  'T-1003': makeTriage('T-1003', 'customer_support', 'general_query'),
  'T-1004': makeTriage('T-1004', 'trust_and_safety', 'account_security'),
};

const DRAFT_FIXTURES: Record<string, string> = Object.fromEntries(
  TICKET_IDS.map((id) => [id, makeDraft(id)]),
);

const ACTION_PLAN_FIXTURES: Record<string, string> = Object.fromEntries(
  TICKET_IDS.map((id) => [id, makeActionPlan(id)]),
);

const GROUNDING_RESPONSE = JSON.stringify([]);

// ─── test setup ──────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..');
const KNOWLEDGE_DIR = path.join(ROOT, 'knowledge_base');
const TICKETS_PATH = path.join(ROOT, 'tickets.json');

let artifactsDir: string;
let orchestrator: PipelineOrchestrator;
let spyLogger: SpyLLMCallLogger;

beforeAll(async () => {
  artifactsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deriv-e2e-'));
  spyLogger = new SpyLLMCallLogger();
  const clock = { now: () => new Date().toISOString() };

  const artifactRepo = new FileArtifactRepository(artifactsDir);
  const llmCallLogger = new JsonlLLMCallLogger(artifactRepo);

  // Use JsonlLLMCallLogger so llm_calls.jsonl is written to disk.
  // SpyLogger is unused here but kept for type compatibility.
  const stub = new StubLLMService(
    {
      triage: TRIAGE_FIXTURES,
      response_drafting: DRAFT_FIXTURES,
      action_planning: ACTION_PLAN_FIXTURES,
      grounding_validation: GROUNDING_RESPONSE,
    },
    llmCallLogger,
    clock,
  );

  orchestrator = new PipelineOrchestrator({
    ticketRepo: new FileTicketRepository(TICKETS_PATH),
    knowledgeRepo: new FileKnowledgeRepository(KNOWLEDGE_DIR),
    artifactRepo,
    llm: stub,
    llmCallLogger,
    chunker: new MarkdownChunker(),
    retriever: new TfIdfBm25Retriever(),
    clock,
    retrievalConfig: { topK: 4, minScore: 0.0, confidenceThreshold: 0.2, epsilon: 0.05 },
  });

  await orchestrator.run();
}, 30_000);

afterAll(async () => {
  await fs.rm(artifactsDir, { recursive: true, force: true });
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Pipeline end-to-end', () => {
  it('reaches VALIDATION_COMPLETE state', () => {
    expect(orchestrator.getState()).toBe(PipelineState.VALIDATION_COMPLETE);
  });

  it('writes all required artifact files', async () => {
    const required = [
      'knowledge_corpus.json',
      'retrieval_results.json',
      'triage.json',
      'response_drafts.json',
      'action_plan.json',
      'grounding_validation.json',
      'final_ticket_outputs.json',
      'queue_ranking.json',
      'audit_log.json',
      'llm_calls.jsonl',
    ];

    for (const file of required) {
      const exists = await fs.access(path.join(artifactsDir, file)).then(() => true).catch(() => false);
      expect(exists, `Expected artifact: ${file}`).toBe(true);
    }
  });

  it('produces one triage result per input ticket', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'triage.json'), 'utf-8');
    const triage = JSON.parse(content) as unknown[];
    expect(triage).toHaveLength(TICKET_IDS.length);
  });

  it('produces one response draft per ticket', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'response_drafts.json'), 'utf-8');
    const drafts = JSON.parse(content) as unknown[];
    expect(drafts).toHaveLength(TICKET_IDS.length);
  });

  it('produces one action plan per ticket', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'action_plan.json'), 'utf-8');
    const plans = JSON.parse(content) as unknown[];
    expect(plans).toHaveLength(TICKET_IDS.length);
  });

  it('produces one final output per ticket', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'final_ticket_outputs.json'), 'utf-8');
    const finals = JSON.parse(content) as unknown[];
    expect(finals).toHaveLength(TICKET_IDS.length);
  });

  it('logs exactly 4 LLM calls per ticket (one per stage)', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'llm_calls.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(TICKET_IDS.length * 4);
  });

  it('logs separate records for each LLM stage', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'llm_calls.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const stages = new Set(records.map((r) => r['stage']));
    expect(stages).toContain('triage');
    expect(stages).toContain('response_drafting');
    expect(stages).toContain('action_planning');
    expect(stages).toContain('grounding_validation');
  });

  it('handoff notes differ across tickets', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'action_plan.json'), 'utf-8');
    const plans = JSON.parse(content) as Array<Record<string, unknown>>;
    const notes = plans.map((p) => String(p['handoff_note']));
    const unique = new Set(notes);
    expect(unique.size).toBe(plans.length);
  });

  it('final outputs include validation_summary for each ticket', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'final_ticket_outputs.json'), 'utf-8');
    const finals = JSON.parse(content) as Array<Record<string, unknown>>;
    for (const output of finals) {
      const summary = output['validation_summary'] as Record<string, unknown> | undefined;
      expect(summary).toBeDefined();
      expect(typeof summary?.['unsupported_claims_found']).toBe('number');
      expect(typeof summary?.['corrected']).toBe('boolean');
    }
  });

  it('queue ranking covers all tickets', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'queue_ranking.json'), 'utf-8');
    const ranking = JSON.parse(content) as unknown[];
    expect(ranking).toHaveLength(TICKET_IDS.length);
  });

  it('audit log records correct ticket count and LLM call count', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'audit_log.json'), 'utf-8');
    const log = JSON.parse(content) as Record<string, unknown>;
    expect(log['ticket_count']).toBe(TICKET_IDS.length);
    expect(log['llm_calls_total']).toBe(TICKET_IDS.length * 4);
  });

  it('all triage results have valid vocabulary values', async () => {
    const content = await fs.readFile(path.join(artifactsDir, 'triage.json'), 'utf-8');
    const triage = JSON.parse(content) as Array<Record<string, unknown>>;
    const validCategories = ['withdrawal_delay', 'account_security', 'account_access', 'trade_dispute', 'general_query'];
    const validUrgency = ['critical', 'high', 'medium', 'low'];
    const validQueues = ['payments_ops', 'trust_and_safety', 'customer_support', 'trading_ops', 'account_operations'];
    for (const t of triage) {
      expect(validCategories).toContain(t['category']);
      expect(validUrgency).toContain(t['urgency']);
      expect(validQueues).toContain(t['recommended_queue']);
    }
  });
});
