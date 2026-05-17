# Assumptions and Confidence/Fallback Policy

## Retrieval Confidence

The pipeline uses BM25 scoring to select knowledge chunks for each ticket. After retrieval, two conditions may flag a ticket as having **low retrieval confidence**:

1. **Score below threshold**: The top-scored chunk scores below `RETRIEVAL_CONFIDENCE_THRESHOLD` (default `0.2`). This indicates the query has little lexical overlap with any chunk in the corpus.

2. **Ambiguous retrieval**: The top-K chunks all score within `epsilon` (default `0.05`) of each other. When scores are this close, there is no clear winner and any selection may be arbitrary.

Either condition sets `low_retrieval_confidence: true` on the normalised ticket.

## Consequences of Low Confidence

When `low_retrieval_confidence` is `true`:

| Stage | Effect |
|---|---|
| Triage | `resolution_mode` is forced to `needs_human_review` regardless of the LLM's output |
| Response Drafting | A visible NOTE is injected into the prompt: "Retrieval confidence for this ticket is low. Be conservative — do not assert specific policies. Refer the customer to our support team for definitive guidance." |
| Grounding Validation | Deterministic checks apply as normal; low-confidence drafts typically cite no chunks, so `contains_policy_claims` is set to `false` during finalisation |

## Safe Defaults

If an LLM returns invalid JSON or out-of-vocabulary values, the pipeline applies safe defaults rather than crashing:

| Field | Safe Default |
|---|---|
| `category` | `general_query` |
| `urgency` | `medium` |
| `sentiment` | `neutral` |
| `resolution_mode` | `needs_human_review` |
| `recommended_queue` | `customer_support` |
| `response_text` | `"Our team is reviewing your case and will follow up shortly."` |
| `tone` | `professional` |
| `source_chunk_ids` | Falls back to all allowed chunk IDs from retrieval |
| `action owner_queue` | `customer_support` |
| `action priority` | `P2` |

## Configuration

Retrieval parameters can be tuned via environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `RETRIEVAL_TOP_K` | `4` | Maximum chunks selected per ticket |
| `RETRIEVAL_MIN_SCORE` | `0.1` | Minimum BM25 score to include a chunk at all |
| `RETRIEVAL_CONFIDENCE_THRESHOLD` | `0.2` | Score below which retrieval is flagged as low-confidence |

The epsilon (ambiguity band) is fixed at `0.05` and is not configurable via environment.

## What the Pipeline Does NOT Do

- It does not guarantee payout timing unless the knowledge base explicitly states it.
- It does not make autonomous decisions — all `needs_human_review` tickets require a human agent to act.
- It does not send emails, modify account state, or call external APIs.
- It does not use the entire knowledge base indiscriminately — only top-K retrieved chunks are passed to each LLM stage.
