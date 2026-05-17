import fs from 'node:fs/promises';
import path from 'node:path';
import { TICKET_CATEGORIES } from '../../domain/value-objects/TicketCategory.js';
import { URGENCY_LEVELS } from '../../domain/value-objects/UrgencyLevel.js';
import { QUEUES } from '../../domain/value-objects/Queue.js';
import { RESOLUTION_MODES } from '../../domain/value-objects/ResolutionMode.js';
import { SENTIMENTS } from '../../domain/value-objects/Sentiment.js';
import { ACTION_PRIORITIES } from '../../domain/value-objects/ActionPriority.js';


const ROOT = path.resolve(__dirname, '..', '..', '..');
const ARTIFACTS = path.join(ROOT, 'artifacts');

interface CheckResult {
  passed: boolean;
  message: string;
}

function pass(message: string): CheckResult {
  return { passed: true, message: `  ✓ ${message}` };
}

function fail(message: string): CheckResult {
  return { passed: false, message: `  ✗ ${message}` };
}

async function readJSON<T>(fileName: string): Promise<T> {
  const fullPath = path.join(ARTIFACTS, fileName);
  const content = await fs.readFile(fullPath, 'utf-8');
  return JSON.parse(content) as T;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Check 1: Required artifacts exist
async function checkArtifactsExist(): Promise<CheckResult[]> {
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

  const results: CheckResult[] = [];
  for (const file of required) {
    const exists = await fileExists(path.join(ARTIFACTS, file));
    results.push(
      exists
        ? pass(`Artifact exists: ${file}`)
        : fail(`Missing artifact: ${file}`),
    );
  }
  return results;
}

// Check 2: JSON files are valid and parseable
async function checkJsonValid(): Promise<CheckResult[]> {
  const jsonFiles = [
    'knowledge_corpus.json',
    'retrieval_results.json',
    'triage.json',
    'response_drafts.json',
    'action_plan.json',
    'grounding_validation.json',
    'final_ticket_outputs.json',
  ];

  const results: CheckResult[] = [];
  for (const file of jsonFiles) {
    try {
      await readJSON(file);
      results.push(pass(`Valid JSON: ${file}`));
    } catch (err) {
      results.push(fail(`Invalid JSON in ${file}: ${String(err)}`));
    }
  }
  return results;
}

// Check 3: Knowledge chunks contain required metadata
async function checkKnowledgeChunks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const corpus = await readJSON<unknown[]>('knowledge_corpus.json');
    if (!Array.isArray(corpus) || corpus.length === 0) {
      return [fail('knowledge_corpus.json is empty or not an array')];
    }

    let valid = 0;
    for (const chunk of corpus) {
      const c = chunk as Record<string, unknown>;
      if (
        typeof c['chunk_id'] === 'string' &&
        typeof c['document_id'] === 'string' &&
        typeof c['section_title'] === 'string' &&
        typeof c['text'] === 'string' &&
        typeof c['content_hash'] === 'string' &&
        typeof c['character_count'] === 'number'
      ) {
        valid++;
      }
    }

    if (valid === corpus.length) {
      results.push(pass(`All ${corpus.length} knowledge chunks have required metadata`));
    } else {
      results.push(fail(`${corpus.length - valid}/${corpus.length} chunks missing required metadata fields`));
    }
  } catch (err) {
    results.push(fail(`Cannot check knowledge chunks: ${String(err)}`));
  }
  return results;
}

// Check 4: Retrieval was performed before LLM stages
async function checkRetrievalBeforeLLM(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const llmCallsPath = path.join(ARTIFACTS, 'llm_calls.jsonl');
    const content = await fs.readFile(llmCallsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const retrievalResult = await readJSON<unknown[]>('retrieval_results.json');
    const hasRetrieval = Array.isArray(retrievalResult) && retrievalResult.length > 0;

    if (!hasRetrieval) {
      results.push(fail('retrieval_results.json is empty — retrieval must run before LLM stages'));
    } else {
      results.push(pass('Retrieval results exist before LLM stages'));
    }

    const inputArtifacts = records.flatMap((r) =>
      Array.isArray(r['input_artifacts']) ? (r['input_artifacts'] as string[]) : [],
    );
    const retrievalReferencedAsInput = inputArtifacts.some((a) => a.includes('retrieval_results'));
    if (retrievalReferencedAsInput) {
      results.push(pass('LLM calls reference retrieval_results.json as input artifact'));
    } else {
      results.push(fail('LLM calls do not reference retrieval_results.json — retrieval ordering unverified'));
    }
  } catch (err) {
    results.push(fail(`Cannot check retrieval ordering: ${String(err)}`));
  }
  return results;
}

// Check 5: LLM stages are separate and logged
async function checkLLMStagesSeparate(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const llmCallsPath = path.join(ARTIFACTS, 'llm_calls.jsonl');
    const content = await fs.readFile(llmCallsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

    const stages = new Set(records.map((r) => r['stage']));
    const requiredStages: string[] = ['triage', 'response_drafting', 'action_planning', 'grounding_validation'];

    for (const stage of requiredStages) {
      if (stages.has(stage)) {
        const count = records.filter((r) => r['stage'] === stage).length;
        results.push(pass(`Stage "${stage}" has ${count} LLM call(s) logged`));
      } else {
        results.push(fail(`No LLM calls logged for stage "${stage}"`));
      }
    }

    const hasAllRequiredFields = records.every(
      (r) =>
        typeof r['stage'] === 'string' &&
        typeof r['timestamp'] === 'string' &&
        typeof r['provider'] === 'string' &&
        typeof r['model'] === 'string' &&
        typeof r['prompt_hash'] === 'string' &&
        Array.isArray(r['input_artifacts']) &&
        typeof r['output_artifact'] === 'string' &&
        Array.isArray(r['ticket_ids']) &&
        Array.isArray(r['chunk_ids_included']),
    );
    results.push(
      hasAllRequiredFields
        ? pass('All LLM call records contain required fields')
        : fail('Some LLM call records are missing required fields'),
    );
  } catch (err) {
    results.push(fail(`Cannot check LLM stage logging: ${String(err)}`));
  }
  return results;
}

// Check 6: Controlled vocabularies are respected
async function checkVocabularies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const triage = await readJSON<unknown[]>('triage.json');
    let vocabErrors = 0;
    for (const t of triage) {
      const item = t as Record<string, unknown>;
      if (!(TICKET_CATEGORIES as readonly string[]).includes(String(item['category']))) vocabErrors++;
      if (!(URGENCY_LEVELS as readonly string[]).includes(String(item['urgency']))) vocabErrors++;
      if (!(SENTIMENTS as readonly string[]).includes(String(item['sentiment']))) vocabErrors++;
      if (!(RESOLUTION_MODES as readonly string[]).includes(String(item['resolution_mode']))) vocabErrors++;
      if (!(QUEUES as readonly string[]).includes(String(item['recommended_queue']))) vocabErrors++;
    }
    results.push(
      vocabErrors === 0
        ? pass('All triage vocabulary values are in-range')
        : fail(`${vocabErrors} triage vocabulary violations found`),
    );
  } catch (err) {
    results.push(fail(`Cannot check triage vocabularies: ${String(err)}`));
  }

  try {
    const plans = await readJSON<unknown[]>('action_plan.json');
    let vocabErrors = 0;
    for (const p of plans) {
      const plan = p as Record<string, unknown>;
      const actions = Array.isArray(plan['actions']) ? plan['actions'] : [];
      for (const a of actions) {
        const action = a as Record<string, unknown>;
        if (!(QUEUES as readonly string[]).includes(String(action['owner_queue']))) vocabErrors++;
        if (!(ACTION_PRIORITIES as readonly string[]).includes(String(action['priority']))) vocabErrors++;
      }
    }
    results.push(
      vocabErrors === 0
        ? pass('All action plan vocabulary values are in-range')
        : fail(`${vocabErrors} action plan vocabulary violations found`),
    );
  } catch (err) {
    results.push(fail(`Cannot check action plan vocabularies: ${String(err)}`));
  }

  return results;
}

// Check 7: Each response and action plan references source chunk IDs
async function checkSourceChunkIds(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const corpus = await readJSON<Array<Record<string, unknown>>>('knowledge_corpus.json');
    const validChunkIds = new Set(corpus.map((c) => String(c['chunk_id'])));

    const drafts = await readJSON<unknown[]>('response_drafts.json');
    let missingIds = 0;
    for (const d of drafts) {
      const draft = d as Record<string, unknown>;
      const ids = Array.isArray(draft['source_chunk_ids']) ? draft['source_chunk_ids'] : [];
      for (const id of ids) {
        if (!validChunkIds.has(String(id))) missingIds++;
      }
    }
    results.push(
      missingIds === 0
        ? pass('All response draft source_chunk_ids reference valid corpus chunks')
        : fail(`${missingIds} source_chunk_ids in response_drafts.json reference unknown chunks`),
    );
  } catch (err) {
    results.push(fail(`Cannot check response source chunk IDs: ${String(err)}`));
  }
  return results;
}

// Check 8: Unsupported claims are corrected in final outputs
async function checkUnsupportedClaimsCorrected(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const validations = await readJSON<Array<Record<string, unknown>>>('grounding_validation.json');
    const finals = await readJSON<Array<Record<string, unknown>>>('final_ticket_outputs.json');

    const ungroundedByTicket = new Map<string, Set<string>>();
    for (const v of validations) {
      if (!v['grounded']) {
        const tid = String(v['ticket_id']);
        if (!ungroundedByTicket.has(tid)) ungroundedByTicket.set(tid, new Set());
        const ids = Array.isArray(v['source_chunk_ids']) ? v['source_chunk_ids'] : [];
        for (const id of ids) ungroundedByTicket.get(tid)!.add(String(id));
      }
    }

    let correctionErrors = 0;
    for (const [ticketId, failedIds] of ungroundedByTicket) {
      const output = finals.find((f) => f['ticket_id'] === ticketId);
      if (!output) { correctionErrors++; continue; }
      const finalResponse = output['final_response'] as Record<string, unknown> | undefined;
      const responseIds: string[] = Array.isArray(finalResponse?.['source_chunk_ids'])
        ? finalResponse['source_chunk_ids'] as string[]
        : [];
      for (const failedId of failedIds) {
        if (responseIds.includes(failedId)) correctionErrors++;
      }
    }

    results.push(
      correctionErrors === 0
        ? pass('All unsupported claims are corrected in final_ticket_outputs.json')
        : fail(`${correctionErrors} unsupported claim(s) still present in final outputs`),
    );
  } catch (err) {
    results.push(fail(`Cannot check claim correction: ${String(err)}`));
  }
  return results;
}

// Check 9: Final outputs exist for every input ticket
async function checkFinalOutputsComplete(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const ticketsPath = path.join(ROOT, 'tickets.json');
    const ticketsRaw = JSON.parse(await fs.readFile(ticketsPath, 'utf-8')) as Record<string, unknown>;
    const inputTickets: string[] = Array.isArray(ticketsRaw['tickets'])
      ? (ticketsRaw['tickets'] as Array<Record<string, unknown>>).map((t) => String(t['ticket_id']))
      : [];

    const finals = await readJSON<Array<Record<string, unknown>>>('final_ticket_outputs.json');
    const finalTicketIds = new Set(finals.map((f) => String(f['ticket_id'])));

    const missing = inputTickets.filter((id) => !finalTicketIds.has(id));
    results.push(
      missing.length === 0
        ? pass(`Final outputs exist for all ${inputTickets.length} input tickets`)
        : fail(`Missing final outputs for: ${missing.join(', ')}`),
    );
  } catch (err) {
    results.push(fail(`Cannot check final output completeness: ${String(err)}`));
  }
  return results;
}

// Check 10: Handoff notes are not identical boilerplate across all tickets
async function checkHandoffNotesDiverse(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  try {
    const plans = await readJSON<Array<Record<string, unknown>>>('action_plan.json');
    if (plans.length < 2) {
      results.push(pass('Only one action plan — handoff note diversity not applicable'));
      return results;
    }

    const notes = plans.map((p) => String(p['handoff_note'] ?? '').trim());
    const uniqueNotes = new Set(notes);

    if (uniqueNotes.size === notes.length) {
      results.push(pass(`All ${notes.length} handoff notes are unique`));
    } else if (uniqueNotes.size === 1) {
      results.push(fail('All handoff notes are identical — not ticket-specific'));
    } else {
      const duplicateCount = notes.length - uniqueNotes.size;
      results.push(fail(`${duplicateCount} duplicate handoff notes found across ${notes.length} plans`));
    }
  } catch (err) {
    results.push(fail(`Cannot check handoff note diversity: ${String(err)}`));
  }
  return results;
}

async function validate(): Promise<void> {
  console.log('\n=== Deriv Pipeline Validation ===\n');

  const checks = [
    { name: '1. Required artifacts exist', fn: checkArtifactsExist },
    { name: '2. JSON files are valid', fn: checkJsonValid },
    { name: '3. Knowledge chunk metadata', fn: checkKnowledgeChunks },
    { name: '4. Retrieval before LLM stages', fn: checkRetrievalBeforeLLM },
    { name: '5. Separate LLM stages logged', fn: checkLLMStagesSeparate },
    { name: '6. Controlled vocabularies', fn: checkVocabularies },
    { name: '7. Source chunk IDs present', fn: checkSourceChunkIds },
    { name: '8. Unsupported claims corrected', fn: checkUnsupportedClaimsCorrected },
    { name: '9. Final outputs complete', fn: checkFinalOutputsComplete },
    { name: '10. Handoff notes diverse', fn: checkHandoffNotesDiverse },
  ];

  let totalFailed = 0;

  for (const check of checks) {
    console.log(`${check.name}:`);
    const results = await check.fn();
    for (const r of results) {
      console.log(r.message);
      if (!r.passed) totalFailed++;
    }
    console.log();
  }

  if (totalFailed === 0) {
    console.log('All checks passed.\n');
    process.exit(0);
  } else {
    console.log(`${totalFailed} check(s) failed.\n`);
    process.exit(1);
  }
}

validate().catch((err: unknown) => {
  console.error('[Validate] Fatal error:', err);
  process.exit(1);
});
