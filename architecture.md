# Deriv AI Recruiter — Architecture

**Support Triage Pipeline Blueprint**

This document is the authoritative implementation reference. Every feature, file, and decision is derived from `problem.md`. When they conflict, `problem.md` wins and this file is updated to match.

---

## 1. Purpose & Non-Goals

**Purpose.** A replayable, staged pipeline that reads a ticket queue and a local knowledge base from disk, retrieves relevant knowledge per ticket, classifies and prioritises each ticket via four separate LLM stages, produces grounded customer-facing responses and internal action plans, validates every substantive claim against source documents, and writes a fixed set of JSON artifacts.

**Non-goals.**
- This is support-*assistance* tooling. It does not take autonomous irreversible actions (locking accounts, reversing transactions, etc.).
- It is not a web application; there is no browser UI, no HTTP server, and no database.
- Precomputed / cached outputs are explicitly disallowed. The pipeline must re-run from inputs every time.

---

## 2. Pipeline Diagram

```
INIT
 │
 ▼
INPUTS_LOADED ──────────────────────────────────── tickets.json loaded
 │
 ▼
KNOWLEDGE_INDEXED ───────────────────────────────── artifacts/knowledge_corpus.json
 │
 ▼
TICKETS_NORMALISED ──────────────────────────────── (in-memory normalised tickets)
 │
 ▼
RETRIEVAL_COMPLETE ──────────────────────────────── artifacts/retrieval_results.json
 │
 ▼  [Stage 1 LLM — Haiku 4.5]
TRIAGE_COMPLETE ─────────────────────────────────── artifacts/triage.json
 │
 ▼  [Stage 2 LLM — Sonnet 4.6]
RESPONSE_DRAFTED ────────────────────────────────── artifacts/response_drafts.json
 │
 ▼  [Stage 3 LLM — Sonnet 4.6]
ACTION_PLAN_CREATED ─────────────────────────────── artifacts/action_plan.json
 │
 ▼  [Stage 4 LLM — Sonnet 4.6 + deterministic checker]
GROUNDING_VALIDATED ─────────────────────────────── artifacts/grounding_validation.json
 │
 ▼
FINAL_OUTPUTS_WRITTEN ───────────────────────────── artifacts/final_ticket_outputs.json
 │
 ▼
AUDIT_LOG_EXPORTED ──────────────────────────────── artifacts/audit_log.json
 │                                                   artifacts/llm_calls.jsonl (written incrementally)
 ▼
VALIDATION_COMPLETE ─────────────────────────────── (validate.ts exit 0)
 │
 ▼
RESULTS_FINALISED ───────────────────────────────── artifacts/queue_ranking.json (optional)
```

**Invariant.** No stage may execute unless its predecessor has completed. The `PipelineOrchestrator` is the only code allowed to advance `PipelineState`. Each use case asserts the required state on entry and throws `PipelineStateError` if it is not met.

---

## 3. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js 20+ | ESM modules |
| Language | TypeScript 5.x, `strict: true` | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Dev runner | `tsx` | `npx tsx src/interface/cli/run.ts` — no compile step for dev |
| Production build | `tsc` | Outputs to `dist/` |
| Test runner | Vitest | Vite-powered, TS-native, no separate transpile config |
| LLM | Anthropic Claude (`@anthropic-ai/sdk`) | Tool-use / structured-output mode; Haiku 4.5 for triage (cheap, fast), Sonnet 4.6 for responses + grounding |
| Retrieval | BM25 (pure local, no API) | Implemented in `src/infrastructure/retrieval/TfIdfBm25Retriever.ts` |
| Hashing | `node:crypto` SHA-256 | Chunk content hashes, prompt hashes |
| No database | — | All state lives on disk as JSON artifacts |

---

## 4. Clean Architecture Layers

```
src/
├── domain/          ← no dependencies; pure TypeScript types and interfaces
├── application/     ← depends on domain only; no I/O
├── infrastructure/  ← depends on domain + application; owns all I/O
└── interface/       ← depends on domain + application + infrastructure; CLI + validation
```

**Import direction rule.** Domain ← Application ← Infrastructure ← Interface. Never import inward (infrastructure must not be imported from application; domain must not import anything). Enforce with ESLint `no-restricted-imports` rules configured in `eslint.config.ts`.

| Layer | Folder | Responsibility |
|---|---|---|
| Domain | `src/domain/` | Entities, value objects, repository/service interfaces, `PipelineState` enum |
| Application | `src/application/` | Use cases, pipeline orchestrator, prompt builders, `GroundingChecker` |
| Infrastructure | `src/infrastructure/` | Anthropic LLM adapter, file repositories, chunker, BM25 retriever, JSONL logger, clock, env config |
| Interface | `src/interface/` | CLI entry point (`run.ts`), validation command (`validate.ts`) |

---

## 5. Domain Model

### Entities

| Entity | Key fields | Artifact |
|---|---|---|
| `Ticket` | `ticket_id`, `submitted_at`, `customer_tier`, `language`, `subject`, `message`, `retrieval_query` | input |
| `KnowledgeChunk` | `document_id`, `source_file`, `chunk_id`, `section_title`, `text`, `character_count`, `content_hash` | `knowledge_corpus.json` |
| `RetrievalResult` | `ticket_id`, `query_text`, `selected_chunk_ids`, `selection_reason`, `omitted_relevant_risk` | `retrieval_results.json` |
| `TriageResult` | `ticket_id`, `category`, `urgency`, `sentiment`, `resolution_mode`, `recommended_queue`, `reasoning_summary`, `source_chunk_ids` | `triage.json` |
| `ResponseDraft` | `ticket_id`, `response_text`, `tone`, `contains_policy_claims`, `source_chunk_ids` | `response_drafts.json` |
| `ActionPlan` | `ticket_id`, `actions[]` (each: `action_id`, `description`, `owner_queue`, `priority`, `depends_on`), `handoff_note` | `action_plan.json` |
| `GroundingValidation` | `ticket_id`, `artifact`, `claim`, `grounded`, `source_type`, `source_chunk_ids`, `issue`, `recommended_fix` | `grounding_validation.json` |
| `FinalTicketOutput` | `ticket_id`, `final_triage`, `final_response`, `final_action_plan`, `validation_summary` (`unsupported_claims_found`, `corrected`) | `final_ticket_outputs.json` |

### Type aliases

```typescript
type ChunkId   = string;   // e.g. "payments-001"
type TicketId  = string;   // e.g. "T-1001"
type ActionId  = string;   // e.g. "A-T-1001-1"
```

---

## 6. Controlled Vocabularies

Every value is a TypeScript `const` union. LLM output strings are passed through a `parseX(s)` function that throws `VocabularyError` on invalid values. On parse failure the LLM service retries once with an explicit correction message; on second failure the pipeline halts.

```typescript
// src/domain/value-objects/TicketCategory.ts
export const TICKET_CATEGORIES = [
  'withdrawal_delay', 'account_security', 'account_access',
  'trade_dispute', 'general_query',
] as const;
export type TicketCategory = typeof TICKET_CATEGORIES[number];
export function parseTicketCategory(s: string): TicketCategory { … }
```

| Vocabulary | Values |
|---|---|
| `TicketCategory` | `withdrawal_delay` `account_security` `account_access` `trade_dispute` `general_query` |
| `UrgencyLevel` | `critical` `high` `medium` `low` |
| `Sentiment` | `negative` `neutral` `positive` `mixed` |
| `ResolutionMode` | `reply_only` `needs_human_review` `needs_specialist_escalation` |
| `Queue` | `payments_ops` `trust_and_safety` `customer_support` `trading_ops` `account_operations` |
| `ActionPriority` | `P0` `P1` `P2` `P3` |

---

## 7. Pipeline State Machine

```typescript
// src/domain/pipeline/PipelineState.ts
export enum PipelineState {
  INIT                  = 'INIT',
  INPUTS_LOADED         = 'INPUTS_LOADED',
  KNOWLEDGE_INDEXED     = 'KNOWLEDGE_INDEXED',
  TICKETS_NORMALISED    = 'TICKETS_NORMALISED',
  RETRIEVAL_COMPLETE    = 'RETRIEVAL_COMPLETE',
  TRIAGE_COMPLETE       = 'TRIAGE_COMPLETE',
  RESPONSE_DRAFTED      = 'RESPONSE_DRAFTED',
  ACTION_PLAN_CREATED   = 'ACTION_PLAN_CREATED',
  GROUNDING_VALIDATED   = 'GROUNDING_VALIDATED',
  FINAL_OUTPUTS_WRITTEN = 'FINAL_OUTPUTS_WRITTEN',
  AUDIT_LOG_EXPORTED    = 'AUDIT_LOG_EXPORTED',
  VALIDATION_COMPLETE   = 'VALIDATION_COMPLETE',
  RESULTS_FINALISED     = 'RESULTS_FINALISED',
}

export const TRANSITIONS: Record<PipelineState, PipelineState | null> = {
  [PipelineState.INIT]:                  PipelineState.INPUTS_LOADED,
  [PipelineState.INPUTS_LOADED]:         PipelineState.KNOWLEDGE_INDEXED,
  …
  [PipelineState.RESULTS_FINALISED]:     null,
};

export function assertState(current: PipelineState, required: PipelineState): void {
  if (current !== required) throw new PipelineStateError(current, required);
}
```

`PipelineOrchestrator` (`src/application/pipeline/PipelineOrchestrator.ts`) holds the single mutable `state: PipelineState` reference and calls `advance()` after each use case completes successfully. Use cases call `assertState(state, PipelineState.X)` at entry.

---

## 8. Stage-by-Stage LLM Contract

### Stage 1 — Triage (`TRIAGE_COMPLETE`)

| | |
|---|---|
| **Model** | `claude-haiku-4-5-20251001` |
| **Input** | ticket text + selected chunks (from `RetrievalResult`) + all six vocabulary lists |
| **Prompt builder** | `src/application/prompts/buildTriagePrompt.ts` |
| **Output schema** | `TriageResult` minus `ticket_id` (added by caller) |
| **Parser** | `parseTicketCategory`, `parseUrgencyLevel`, `parseSentiment`, `parseResolutionMode`, `parseQueue` |
| **Retry trigger** | Any vocab parse failure → one retry with the error message appended |
| **LLM log stage key** | `"triage"` |

### Stage 2 — Response Drafting (`RESPONSE_DRAFTED`)

| | |
|---|---|
| **Model** | `claude-sonnet-4-6` |
| **Input** | `TriageResult` + selected chunks |
| **Prompt builder** | `src/application/prompts/buildResponsePrompt.ts` |
| **Prompt constraints** | Prohibit: guarantees on timing, actions framed as already taken, advice beyond KB, financial/security guidance not in sources |
| **Output schema** | `ResponseDraft` minus `ticket_id` |
| **LLM log stage key** | `"response_drafting"` |

### Stage 3 — Action Planning (`ACTION_PLAN_CREATED`)

| | |
|---|---|
| **Model** | `claude-sonnet-4-6` |
| **Input** | `TriageResult` + `ResponseDraft` |
| **Prompt builder** | `src/application/prompts/buildActionPlanPrompt.ts` |
| **Action ID format** | `A-{ticket_id}-{n}` e.g. `A-T-1001-1` |
| **Handoff note** | Prompt explicitly instructs: ticket-specific wording, not boilerplate; validator checks handoff notes differ across all tickets |
| **LLM log stage key** | `"action_planning"` |

### Stage 4 — Grounding Validation (`GROUNDING_VALIDATED`)

| | |
|---|---|
| **Model** | `claude-sonnet-4-6` |
| **Input** | All three prior artifacts + knowledge corpus |
| **Two-pass design** | (1) Deterministic: for every `source_chunk_ids` array in triage/response/action outputs, verify each chunk ID exists in the corpus and that key noun phrases from the claim appear in the chunk text. (2) LLM pass: semantic check for claims that passed (1) but may still be unsupported in meaning. |
| **Deterministic checker** | `src/application/services/GroundingChecker.ts` — no LLM call |
| **LLM log stage key** | `"grounding_validation"` |
| **Failure path** | Any `grounded: false` item → `FinaliseResultsUseCase` must strip or reword the claim in `final_ticket_outputs.json` |

---

## 9. Retrieval Design

### Chunking (`src/infrastructure/retrieval/MarkdownChunker.ts`)

- Split Markdown on heading lines (`^#{1,3} .+`). Each heading starts a new chunk.
- If a section exceeds 1,200 characters, further split on double-newline boundaries.
- **Chunk ID format:** `{document_id}-{NNN}` (zero-padded three digits, sequential within the document, e.g. `payments-001`).
- **Content hash:** SHA-256 of the raw chunk text (hex string).
- Blank files and files that produce zero chunks must be logged as ingestion failures; they do not halt the pipeline.

### BM25 Retrieval (`src/infrastructure/retrieval/TfIdfBm25Retriever.ts`)

- Parameters: `k1 = 1.5`, `b = 0.75` (standard BM25).
- Tokeniser: lowercase, strip punctuation, split on whitespace. No stemming (keeps it deterministic and inspectable).
- **Top-K:** 4 chunks per ticket (configurable via `EnvConfig.RETRIEVAL_TOP_K`).
- **Min-score floor:** `EnvConfig.RETRIEVAL_MIN_SCORE` (default 0.1). Chunks below this score are not selected.
- **`selection_reason`:** Populated with the top chunk IDs and their BM25 scores, plus the highest-scoring query tokens.
- **`omitted_relevant_risk`:** Set (non-null) when the (K+1)th chunk score is within 15% of the Kth score — signals borderline omission.
- **Ambiguous retrieval detection:** If the top chunk score < `EnvConfig.RETRIEVAL_CONFIDENCE_THRESHOLD` (default 0.2), or all top-K scores are within ε = 0.05 of each other, the ticket is flagged `low_retrieval_confidence`. The orchestrator then forces `resolution_mode = needs_human_review` on the downstream triage result (see §15 Confidence Policy).

---

## 10. Grounding Strategy

Two-pass validation in `ValidateGroundingUseCase`:

**Pass 1 — Deterministic (`GroundingChecker`).**
For each output item that carries `source_chunk_ids`:
1. Verify every chunk ID exists in the knowledge corpus (lookup by `chunk_id`).
2. Tokenise the claim text and the referenced chunk texts; check that the claim's key noun phrases (tokens of ≥5 chars) overlap with at least one chunk. If overlap < 30%, mark `grounded: false`, `source_type: "derived"`.

**Pass 2 — LLM semantic check.**
Run `claude-sonnet-4-6` on items that passed pass 1 but contain explicit policy statements (`"you will receive"`, `"we guarantee"`, `"cannot be reversed"`, etc.). The LLM judges whether each statement is supported by the referenced chunk text or is an hallucinated extension.

**Correction in `FinaliseResultsUseCase`.**
- Items where `grounded: false`: remove the offending sentence/clause from `final_response.response_text` / `final_action_plan.handoff_note`. Record `corrected: true` and `unsupported_claims_found` count in `validation_summary`.
- If removing the claim would leave the response empty, replace with: `"Our team is reviewing your case and will follow up shortly."` (conservative fallback).

---

## 11. LLM Call Logging

Every call made by `AnthropicLLMService` is synchronously appended to `artifacts/llm_calls.jsonl` via the injected `ILLMCallLogger` before the method returns.

**Record schema** (one JSON object per line):

```json
{
  "stage": "triage | response_drafting | action_planning | grounding_validation",
  "timestamp": "2026-05-17T10:00:00.000Z",
  "provider": "anthropic",
  "model": "claude-haiku-4-5-20251001",
  "prompt_hash": "<sha256-of-exact-prompt-string>",
  "input_artifacts": ["tickets.json", "artifacts/knowledge_corpus.json"],
  "output_artifact": "artifacts/triage.json",
  "ticket_ids": ["T-1001"],
  "chunk_ids_included": ["payments-001", "support_sla-001"]
}
```

**Prompt hash stability.** The hash is computed over the exact string passed to the API, including all injected chunk texts and ticket content. The hash changes if inputs change; stable inputs produce stable hashes (useful for verifying replay).

**Logger is injected, not global.** `AnthropicLLMService` receives `ILLMCallLogger` as a constructor argument. Tests inject a `SpyLLMCallLogger` to assert log records without touching the filesystem.

---

## 12. Testing Strategy

### Unit tests (`tests/unit/`)

| Subfolder | What is tested |
|---|---|
| `domain/` | Every `parseX()` rejects out-of-vocab strings and accepts all valid values; entity constructor invariants (e.g. non-empty `ticket_id`) |
| `application/use-cases/` | Each use case, injected with mock repositories and a `StubLLMService`; assert correct output shape, correct state transition, correct `source_chunk_ids` propagation |
| `application/prompts/` | Prompt builders are pure functions → vitest snapshot tests; regressions are immediately visible |
| `application/services/` | `GroundingChecker` with fixture corpus + known-good and known-bad claims |
| `infrastructure/retrieval/` | `MarkdownChunker` on multi-heading files, single-heading files, blank files; `TfIdfBm25Retriever` on a small fixture corpus with known expected rankings |
| `infrastructure/llm/` | `JsonlLLMCallLogger` appends correctly formatted JSONL; `AnthropicLLMService` retries once on parse failure |

### Integration test (`tests/integration/pipeline.e2e.test.ts`)

Runs `PipelineOrchestrator` against:
- the committed `tickets.json` and `knowledge_base/`
- `StubLLMService` returning deterministic fixture responses (keyed by `stage` + `ticket_id`)
- in-memory `SpyArtifactRepository` (avoids real filesystem writes)

Assertions:
- All 10 artifacts are produced.
- Every artifact is schema-valid (uses the same schema checkers as `validate.ts`).
- `source_chunk_ids` are non-empty in triage, response, and action plan outputs.
- Handoff notes differ across all four tickets.
- `validate.ts` exits 0 when run against the written artifacts.

### Running tests

```bash
npm test                        # all tests
npm run test:unit               # unit only
npm run test:integration        # integration only
npx vitest run tests/unit/domain/TicketCategory.test.ts   # single file
npx vitest run --reporter=verbose                          # verbose output
```

---

## 13. Build & Run Commands

```bash
# Install dependencies
npm install

# Run the full pipeline (dev, no compile step)
npm start
# equivalent: npx tsx src/interface/cli/run.ts

# Build for production
npm run build
# outputs to dist/; then run: node dist/interface/cli/run.js

# Validate artifacts (no API key needed)
npm run validate
# equivalent: npx tsx src/interface/validation/validate.ts

# Test
npm test
npm run test:unit
npm run test:integration
npm run test:watch    # vitest watch mode

# Type-check only (no emit)
npm run typecheck
```

`ANTHROPIC_API_KEY` must be set in the environment before running `npm start`. `EnvConfig` will print a clear error and exit 1 if the key is absent.

---

## 14. Validation Command (`validate.ts`)

`npm run validate` checks all of the following. Exits 1 immediately on first failure with a descriptive message.

| Check | How verified |
|---|---|
| Required artifacts exist | `fs.existsSync` for all 10 paths |
| All JSON files are valid | `JSON.parse` without throwing |
| Knowledge chunks have all required metadata fields | Schema check on each item in `knowledge_corpus.json` |
| Retrieval was performed before LLM stages | `llm_calls.jsonl` earliest triage timestamp > `retrieval_results.json` mtime |
| LLM stages are separate | `llm_calls.jsonl` contains ≥1 record for each of the 4 stage keys |
| Controlled vocabularies respected | Parse every `category`, `urgency`, `sentiment`, `resolution_mode`, `recommended_queue`, `priority` field through the `parseX` functions |
| Each response and action plan references source chunk IDs | `source_chunk_ids.length > 0` on every item in `response_drafts.json` and `action_plan.json` |
| Unsupported claims are corrected in final outputs | For every `grounded: false` item in `grounding_validation.json`, the corresponding final output must have `corrected: true` |
| Final outputs exist for every input ticket | `final_ticket_outputs.json` contains an entry for every `ticket_id` in `tickets.json` |
| Handoff notes are not identical boilerplate | Assert that `Set` of distinct handoff note strings has size equal to ticket count |

---

## 15. Confidence & Fallback Policy

See `assumptions.md` for full rationale. Summary:

When the retrieval stage detects **low confidence** (top BM25 score < 0.2, or top-K scores all within ε = 0.05 of each other):
- `RetrieveKnowledgeUseCase` sets `low_retrieval_confidence: true` on the `RetrievalResult`.
- `TriageTicketsUseCase` reads this flag and forces `resolution_mode = needs_human_review` regardless of what the LLM returns.
- `DraftResponsesUseCase` suppresses all direct policy assertions in the response prompt (replaces the "you may cite these chunks directly" instruction with "refer the customer to our support team").
- `ExportAuditLogUseCase` records a `low_confidence_tickets` list in `audit_log.json`.

---

## 16. Sequential Build Checklist

Work feature by feature. Each step is independently deployable and has tests before moving on.

- [x] **Step 1** — Project scaffolding (`package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, npm scripts, empty entrypoint). Deliverable: `npm test` passes.
- [x] **Step 2** — Domain layer (entities, value objects with `parseX`, all interfaces, `PipelineState`). Deliverable: VO unit tests pass.
- [x] **Step 3** — Knowledge ingestion (`MarkdownChunker`, `FileKnowledgeRepository`, `IndexKnowledgeUseCase`, sample `knowledge_base/*.md`). Deliverable: `knowledge_corpus.json` produced.
- [x] **Step 4** — Ticket loading (`FileTicketRepository`, `LoadInputsUseCase`, `NormaliseTicketsUseCase`, sample `tickets.json`). Deliverable: normalised tickets in memory; unit tests pass.
- [x] **Step 5** — Retrieval (`TfIdfBm25Retriever`, `RetrieveKnowledgeUseCase`). Deliverable: `retrieval_results.json` produced; BM25 unit tests pass.
- [ ] **Step 6** — LLM infrastructure (`AnthropicLLMService`, `JsonlLLMCallLogger`, `StubLLMService`, `EnvConfig`). Deliverable: stub call produces a valid JSONL record; graceful failure without API key.
- [ ] **Step 7** — Stage 1 Triage (`buildTriagePrompt`, `TriageTicketsUseCase`). Deliverable: `triage.json`; prompt snapshot test.
- [ ] **Step 8** — Stage 2 Response drafting (`buildResponsePrompt`, `DraftResponsesUseCase`). Deliverable: `response_drafts.json`.
- [ ] **Step 9** — Stage 3 Action planning (`buildActionPlanPrompt`, `CreateActionPlanUseCase`). Deliverable: `action_plan.json`; handoff note diversity asserted.
- [ ] **Step 10** — Stage 4 Grounding validation (`GroundingChecker`, `ValidateGroundingUseCase`). Deliverable: `grounding_validation.json`; known-bad claim caught by tests.
- [ ] **Step 11** — Finalisation (`FinaliseResultsUseCase`, `WriteArtifactsUseCase`). Deliverable: `final_ticket_outputs.json` with correct `validation_summary`.
- [ ] **Step 12** — Queue ranking (`RankQueueUseCase`). Deliverable: `queue_ranking.json`.
- [ ] **Step 13** — Audit log (`ExportAuditLogUseCase`). Deliverable: `audit_log.json`; `llm_calls.jsonl` written incrementally since step 6.
- [ ] **Step 14** — Pipeline orchestrator + CLI entry (`PipelineOrchestrator`, `src/interface/cli/run.ts`, DI wiring). Deliverable: `npm start` runs the full pipeline.
- [ ] **Step 15** — Validation command (`src/interface/validation/validate.ts`). Deliverable: `npm run validate` passes on the committed sample outputs.
- [ ] **Step 16** — `assumptions.md`. Deliverable: confidence/fallback policy documented.
- [ ] **Step 17** — End-to-end integration test. Deliverable: `pipeline.e2e.test.ts` passes without an API key using `StubLLMService`.

---

## 17. Artifact File Index

| Artifact | Produced by | Consumed by |
|---|---|---|
| `tickets.json` | (committed input) | `FileTicketRepository` |
| `knowledge_base/*.md` | (committed input) | `FileKnowledgeRepository` |
| `artifacts/knowledge_corpus.json` | `IndexKnowledgeUseCase` | `RetrieveKnowledgeUseCase`, `ValidateGroundingUseCase` |
| `artifacts/retrieval_results.json` | `RetrieveKnowledgeUseCase` | `TriageTicketsUseCase`, `DraftResponsesUseCase`, validate.ts |
| `artifacts/triage.json` | `TriageTicketsUseCase` | `DraftResponsesUseCase`, `CreateActionPlanUseCase`, `ValidateGroundingUseCase` |
| `artifacts/response_drafts.json` | `DraftResponsesUseCase` | `CreateActionPlanUseCase`, `ValidateGroundingUseCase` |
| `artifacts/action_plan.json` | `CreateActionPlanUseCase` | `ValidateGroundingUseCase` |
| `artifacts/grounding_validation.json` | `ValidateGroundingUseCase` | `FinaliseResultsUseCase`, validate.ts |
| `artifacts/final_ticket_outputs.json` | `FinaliseResultsUseCase` | validate.ts (every input ticket must be present) |
| `artifacts/queue_ranking.json` | `RankQueueUseCase` | (optional output) |
| `artifacts/audit_log.json` | `ExportAuditLogUseCase` | (informational) |
| `artifacts/llm_calls.jsonl` | `JsonlLLMCallLogger` (incremental) | validate.ts (stage ordering check) |
