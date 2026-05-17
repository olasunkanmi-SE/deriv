# Deriv AI Support Triage Pipeline

An AI-assisted pipeline that ingests customer support tickets and a local knowledge base, then runs four sequential LLM stages to classify, prioritise, draft responses for, and validate each ticket — producing a full set of auditable JSON artifacts.

## Prerequisites

- **Node.js 20+**
- **Anthropic API key** — set as `ANTHROPIC_API_KEY` in your environment

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

To validate the produced artifacts against all pipeline rules:

```bash
npm run validate
```

## npm scripts

| Command | What it does |
|---|---|
| `npm start` | Run the full pipeline (`tickets.json` + `knowledge_base/` → `artifacts/`) |
| `npm run validate` | Check all 10 output artifacts exist, are valid JSON, and pass schema/vocab rules |
| `npm test` | Run all tests (unit + integration) with Vitest |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration test (full pipeline with stub LLM, no API key needed) |
| `npm run test:watch` | Vitest watch mode |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |

## Pipeline stages

The pipeline advances through 13 explicit states. Each stage asserts its predecessor before running.

```
INIT → INPUTS_LOADED → KNOWLEDGE_INDEXED → TICKETS_NORMALISED
     → RETRIEVAL_COMPLETE
     → TRIAGE_COMPLETE          (LLM stage 1)
     → RESPONSE_DRAFTED         (LLM stage 2)
     → ACTION_PLAN_CREATED      (LLM stage 3)
     → GROUNDING_VALIDATED      (LLM stage 4 + deterministic checks)
     → FINAL_OUTPUTS_WRITTEN
     → QUEUE_RANKED
     → AUDIT_LOG_EXPORTED
```

| Stage | Artifact produced | Model |
|---|---|---|
| BM25 retrieval | `artifacts/retrieval_results.json` | — |
| Triage | `artifacts/triage.json` | claude-haiku-4-5 |
| Response drafting | `artifacts/response_drafts.json` | claude-sonnet-4-6 |
| Action planning | `artifacts/action_plan.json` | claude-sonnet-4-6 |
| Grounding validation | `artifacts/grounding_validation.json` | claude-sonnet-4-6 |
| Finalisation | `artifacts/final_ticket_outputs.json` | — |
| Queue ranking | `artifacts/queue_ranking.json` | — |
| Audit log | `artifacts/audit_log.json` | — |

Every LLM call is appended to `artifacts/llm_calls.jsonl` with stage, model, prompt hash, and ticket/chunk IDs.

## Sample output

**`artifacts/triage.json`** (excerpt):
```json
[
  {
    "ticket_id": "T-1002",
    "category": "account_security",
    "urgency": "critical",
    "sentiment": "negative",
    "resolution_mode": "needs_specialist_escalation",
    "recommended_queue": "trust_and_safety",
    "reasoning_summary": "VIP customer has locked account with open positions at risk during security review..."
  }
]
```

**`artifacts/queue_ranking.json`** (excerpt):
```json
[
  { "ticket_id": "T-1002", "rank": 1, "score": 59, "urgency": "critical", "customer_tier": "vip" },
  { "ticket_id": "T-1004", "rank": 2, "score": 48, "urgency": "critical", "customer_tier": "standard" }
]
```

Scoring: urgency (critical=40, high=30, medium=20, low=10) + customer tier (vip=+10) + category priority (account_security=+9, withdrawal_delay=+10, etc.).

## Providing inputs

**Tickets** — edit `tickets.json` at the repo root. Each ticket requires:

```json
{
  "ticket_id": "T-XXXX",
  "submitted_at": "2026-05-10T09:15:00Z",
  "customer_tier": "standard",
  "language": "en",
  "subject": "...",
  "message": "..."
}
```

`customer_tier` accepts `standard` or `vip`.

**Knowledge base** — add or edit Markdown files under `knowledge_base/`. The chunker splits on `#`/`##` headings; each chunk gets a stable ID (`{document_id}-{NNN}`) and a SHA-256 content hash. The BM25 retriever selects the top-4 most relevant chunks per ticket.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required; pipeline exits with a clear error if absent |
| `TRIAGE_MODEL` | `claude-haiku-4-5-20251001` | Model for triage stage |
| `RESPONSE_MODEL` | `claude-sonnet-4-6` | Model for response drafting, action planning, grounding |
| `RETRIEVAL_TOP_K` | `4` | Chunks retrieved per ticket |
| `RETRIEVAL_MIN_SCORE` | `0.1` | BM25 min score; tickets below threshold are flagged `low_retrieval_confidence` |

## Running tests without an API key

The integration test runs the full pipeline end-to-end using a `StubLLMService` that returns fixture responses — no API key required:

```bash
npm run test:integration
```

Unit tests are also entirely offline:

```bash
npm run test:unit
```

## Architecture

The codebase follows Clean Architecture with a strict one-way import rule:

```
domain ← application ← infrastructure ← interface
```

- **`src/domain/`** — entities, value objects, repository/service interfaces, `PipelineState` enum. No dependencies.
- **`src/application/`** — use cases, prompt builders, `PipelineOrchestrator`, `GroundingChecker`. Depends only on domain.
- **`src/infrastructure/`** — `AnthropicLLMService`, `TfIdfBm25Retriever`, `MarkdownChunker`, file repositories, `JsonlLLMCallLogger`.
- **`src/interface/`** — `cli/run.ts` (DI wiring + pipeline entry), `validation/validate.ts`.

See `architecture.md` for the full design document and `assumptions.md` for the retrieval confidence and fallback policy.
