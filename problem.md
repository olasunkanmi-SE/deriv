## BUILD

Build a replayable AI-assisted support triage pipeline that ingests a small ticket queue from disk, retrieves relevant product and policy knowledge from a local knowledge base, classifies and prioritises tickets, drafts grounded customer-safe responses, generates internal escalation actions, and validates that every substantive claim in the output is traceable to source documents.

This is not a single-prompt summarisation exercise. The evaluator will run your pipeline from a clean checkout, may replace the ticket queue and knowledge-base fixtures with equivalent local files, and will verify that ingestion, retrieval, classification, response generation, action planning, and grounding validation are implemented as explicit stages.

The pipeline must preserve intermediate artifacts, use document-level and chunk-level source metadata, log LLM calls, handle retrieval selection explicitly, and ensure final outputs do not contain unsupported policy or product claims.

---

## INPUT FILES

Your pipeline must read these files from disk:

- `tickets.json`
- `knowledge_base/` directory

The evaluator may replace the sample contents with equivalent fixtures.

---

## SAMPLE `tickets.json`

```json
{
  "tickets": [
    {
      "ticket_id": "T-1001",
      "submitted_at": "2026-05-10T09:15:00Z",
      "customer_tier": "standard",
      "language": "en",
      "subject": "Withdrawal pending for 3 days",
      "message": "Hi, my withdrawal has been pending for three days. I already verified my identity last month. Can you tell me what is going on and when I will receive my funds?"
    },
    {
      "ticket_id": "T-1002",
      "submitted_at": "2026-05-10T09:18:00Z",
      "customer_tier": "vip",
      "language": "en",
      "subject": "Why was my account locked?",
      "message": "I tried logging in today and got a message saying my account is locked for security review. I need access urgently because I have open positions."
    },
    {
      "ticket_id": "T-1003",
      "submitted_at": "2026-05-10T09:20:00Z",
      "customer_tier": "standard",
      "language": "en",
      "subject": "Can you reverse my losing trade?",
      "message": "I made a mistake and closed a trade at a loss. Please reverse it and restore my balance."
    },
    {
      "ticket_id": "T-1004",
      "submitted_at": "2026-05-10T09:22:00Z",
      "customer_tier": "standard",
      "language": "en",
      "subject": "I think someone accessed my account",
      "message": "I saw a password reset email that I did not request and I am worried someone may have accessed my account. What should I do right now?"
    }
  ]
}
```

---

## SAMPLE `knowledge_base/` FILES

Provide sample files in your repository for local testing. The evaluator may replace them with equivalent files.

Minimum suggested files:

- `knowledge_base/payments.md`
- `knowledge_base/security.md`
- `knowledge_base/trading_policies.md`
- `knowledge_base/support_sla.md`

Example content shape:

`payments.md`

```md
# Withdrawals

Verified customers usually have withdrawals reviewed within 24 hours, but delays may occur if enhanced checks are required, payment rails are unavailable, or account activity is under review.

## Additional checks

Support agents must not guarantee payout timing unless the payment provider has confirmed processing.
```

`security.md`

```md
# Account security review

Accounts may be temporarily restricted if suspicious login, device, password, or payment activity is detected.

## Immediate actions for customers

Customers who suspect unauthorised access should reset their password, enable two-factor authentication if available, and contact support immediately.
```

`trading_policies.md`

```md
# Trade finality

Executed trades are final and cannot be reversed unless there is a confirmed platform error or an approved operational adjustment.
```

`support_sla.md`

```md
# Support prioritisation

VIP and security-related cases should be prioritised ahead of general informational requests.
```

---

## CONTROLLED VOCABULARIES

Define these vocabularies in code and validate LLM outputs against them.

Allowed ticket categories:

```text
withdrawal_delay
account_security
account_access
trade_dispute
general_query
```

Allowed urgency levels:

```text
critical
high
medium
low
```

Allowed customer sentiment:

```text
negative
neutral
positive
mixed
```

Allowed resolution modes:

```text
reply_only
needs_human_review
needs_specialist_escalation
```

Allowed internal queues:

```text
payments_ops
trust_and_safety
customer_support
trading_ops
account_operations
```

Allowed action priorities:

```text
P0
P1
P2
P3
```

---

## PIPELINE STAGES

Your implementation must enforce these stages in code:

```text
INIT
 -> INPUTS_LOADED
 -> KNOWLEDGE_INDEXED
 -> TICKETS_NORMALISED
 -> RETRIEVAL_COMPLETE
 -> TRIAGE_COMPLETE
 -> RESPONSE_DRAFTED
 -> ACTION_PLAN_CREATED
 -> GROUNDING_VALIDATED
 -> FINAL_OUTPUTS_WRITTEN
 -> AUDIT_LOG_EXPORTED
 -> VALIDATION_COMPLETE
 -> RESULTS_FINALISED
```

Final responses and escalation outputs must not be produced before retrieval, triage, drafting, and validation stages have completed.

---

## MUST COMPLETE

### 1. Knowledge Ingestion and Chunking

Read all files in `knowledge_base/` and build a local retrieval corpus.

For each source document:

- preserve file name and title metadata
- split into logical chunks
- assign stable chunk IDs
- compute a content hash
- store chunk text and metadata

Save output to `knowledge_corpus.json`.

Each chunk must include:

```json
{
  "document_id": "payments",
  "source_file": "knowledge_base/payments.md",
  "chunk_id": "payments-001",
  "section_title": "Withdrawals",
  "text": "string",
  "character_count": 0,
  "content_hash": "string"
}
```

Do not silently ignore malformed files. Log ingestion failures.

---

### 2. Retrieval Stage

For each ticket, retrieve the most relevant knowledge chunks before any triage or drafting LLM call.

You may use embeddings, keyword retrieval, TF-IDF, or another local method.

For each ticket, save retrieval results to `retrieval_results.json`.

Each record must include:

```json
{
  "ticket_id": "T-1001",
  "query_text": "string",
  "selected_chunk_ids": ["payments-001", "support_sla-001"],
  "selection_reason": "string",
  "omitted_relevant_risk": "string | null"
}
```

The pipeline must not send the entire knowledge base blindly to the model.

---

### 3. Ticket Triage

Make a Stage 1 LLM call for each ticket, or a batched call with clearly separated per-ticket outputs.

Input must include:

- ticket content
- retrieved knowledge chunks
- controlled vocabularies

Generate `triage.json`.

Each ticket result must include:

```json
{
  "ticket_id": "T-1001",
  "category": "withdrawal_delay | account_security | account_access | trade_dispute | general_query",
  "urgency": "critical | high | medium | low",
  "sentiment": "negative | neutral | positive | mixed",
  "resolution_mode": "reply_only | needs_human_review | needs_specialist_escalation",
  "recommended_queue": "payments_ops | trust_and_safety | customer_support | trading_ops | account_operations",
  "reasoning_summary": "string",
  "source_chunk_ids": ["payments-001", "support_sla-001"]
}
```

Urgency should reflect customer risk and business risk, not just tone.

---

### 4. Draft Customer Response

Make a separate Stage 2 LLM call.

Using the triage result and retrieved chunks, generate a customer-facing response for each ticket.

Save output to `response_drafts.json`.

Each draft must include:

```json
{
  "ticket_id": "T-1001",
  "response_text": "string",
  "tone": "string",
  "contains_policy_claims": true,
  "source_chunk_ids": ["payments-001"]
}
```

Responses must:

- be clear and empathetic
- avoid guarantees not supported by sources
- avoid unsafe financial or security advice beyond the provided knowledge
- avoid claiming actions were already taken unless explicitly stated in the ticket or source knowledge

---

### 5. Internal Action Plan

Make a separate Stage 3 LLM call.

Using triage outputs and response drafts, generate an internal action plan per ticket.

Save output to `action_plan.json`.

Each action plan entry must include:

```json
{
  "ticket_id": "T-1001",
  "actions": [
    {
      "action_id": "A-T-1001-1",
      "description": "string",
      "owner_queue": "payments_ops | trust_and_safety | customer_support | trading_ops | account_operations",
      "priority": "P0 | P1 | P2 | P3",
      "depends_on": []
    }
  ],
  "handoff_note": "string"
}
```

The handoff note should read like a realistic internal note to the receiving queue.

---

### 6. Grounding / Hallucination Validation

Make a separate Stage 4 LLM call, or implement deterministic validation plus an LLM validator.

Validate that each substantive claim in:

- `triage.json`
- `response_drafts.json`
- `action_plan.json`

is supported by the ticket text or retrieved knowledge chunks.

Save results to `grounding_validation.json`.

Each validation item must include:

```json
{
  "ticket_id": "T-1001",
  "artifact": "response_drafts.json",
  "claim": "string",
  "grounded": true,
  "source_type": "ticket | knowledge_base | derived",
  "source_chunk_ids": ["payments-001"],
  "issue": "string | null",
  "recommended_fix": "string | null"
}
```

If an output contains an unsupported claim, the final written artifact must be corrected or that claim removed.

---

## SHOULD ATTEMPT

### 7. Priority Ranking Across the Whole Queue

Produce `queue_ranking.json` that orders tickets for handling.

Each item should include:

```json
{
  "rank": 1,
  "ticket_id": "T-1004",
  "why": "string"
}
```

The ranking should reflect urgency, customer risk, and queue policy.

---

### 8. Confidence and Fallback Handling

If retrieval quality appears weak or knowledge support is insufficient, mark the case conservatively.

For example:

- downgrade confidence
- select `needs_human_review`
- avoid direct policy assertions in the customer reply

Document this behavior in `assumptions.md` or code comments.

---

## REQUIRED ARTIFACTS

Your repository must produce:

- `tickets.json`
- `knowledge_corpus.json`
- `retrieval_results.json`
- `triage.json`
- `response_drafts.json`
- `action_plan.json`
- `grounding_validation.json`
- `final_ticket_outputs.json`
- `llm_calls.jsonl`
- `validate.py` or equivalent validation command

Optional but valuable:

- `queue_ranking.json`
- `audit_log.json`
- `assumptions.md`

---

## `final_ticket_outputs.json` REQUIREMENTS

This artifact should contain the corrected, final per-ticket outputs after validation.

Each ticket must include:

```json
{
  "ticket_id": "T-1001",
  "final_triage": {},
  "final_response": {},
  "final_action_plan": {},
  "validation_summary": {
    "unsupported_claims_found": 0,
    "corrected": true
  }
}
```

---

## `llm_calls.jsonl` REQUIREMENTS

Log one JSON object per LLM call.

Each record must include:

```json
{
  "stage": "string",
  "timestamp": "ISO-8601 timestamp",
  "provider": "string",
  "model": "string",
  "prompt_hash": "string",
  "input_artifacts": ["path"],
  "output_artifact": "path",
  "ticket_ids": ["T-1001"],
  "chunk_ids_included": ["payments-001"]
}
```

There must be separate records for:

- Stage 1 triage
- Stage 2 response drafting
- Stage 3 action planning
- Stage 4 grounding validation

---

## VALIDATION REQUIREMENTS

The repository must include a validation command, for example:

```bash
python validate.py
```

The validation command must check that:

- required artifacts exist
- JSON files are valid
- knowledge chunks contain required metadata
- retrieval was performed before LLM stages
- LLM stages are separate and logged
- controlled vocabularies are respected
- each response and action plan references source chunk IDs
- unsupported claims identified in validation are corrected in final outputs
- final outputs exist for every input ticket
- handoff notes are not identical boilerplate across all tickets

---

## EXECUTION REQUIREMENTS

The evaluator will run the pipeline from a clean checkout.

Generated artifacts may be deleted before evaluation.

The evaluator may replace `tickets.json` and the `knowledge_base/` contents with equivalent local inputs.

Static precomputed outputs are not sufficient.

The solution must actually run the staged pipeline and regenerate required artifacts.

---

## TOOLS

Python or TypeScript may be used.

Any LLM provider or AI tooling may be used.

If external APIs are used, the pipeline should fail gracefully when credentials are unavailable, and the code should make it clear where provider configuration belongs.

---

## TECHNICAL CONSTRAINTS

- Read all inputs from disk.
- Use explicit chunking for the knowledge base.
- Use retrieval before generation.
- Do not blindly stuff the whole corpus into prompts.
- Implement triage, response drafting, action planning, and validation as separate stages.
- Preserve source references through the pipeline.
- Ensure customer-facing outputs are grounded and conservative.
- Frame outputs as support-assistance tooling, not autonomous irreversible decision-making.
