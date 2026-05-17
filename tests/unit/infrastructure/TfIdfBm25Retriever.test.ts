import { describe, it, expect } from 'vitest';
import { TfIdfBm25Retriever } from '../../../src/infrastructure/retrieval/TfIdfBm25Retriever.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';

function makeChunk(id: string, text: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `knowledge_base/${id.split('-')[0]}.md`,
    chunk_id: id,
    section_title: 'Test',
    text,
    character_count: text.length,
    content_hash: 'hash',
  };
}

const retriever = new TfIdfBm25Retriever();

const CORPUS: KnowledgeChunk[] = [
  makeChunk('payments-001', 'Withdrawals are reviewed within 24 hours for verified customers. Delays may occur during payment reviews.'),
  makeChunk('payments-002', 'Refunds and deposit reversals take 5 to 10 business days via the original payment method.'),
  makeChunk('security-001', 'Accounts may be restricted if suspicious login or password activity is detected. Security review takes 1 to 3 days.'),
  makeChunk('security-002', 'Customers who suspect unauthorised access should reset their password and enable two-factor authentication.'),
  makeChunk('trading-001', 'Executed trades are final and cannot be reversed unless there is a confirmed platform error.'),
  makeChunk('sla-001', 'VIP and security-related cases are prioritised ahead of general informational requests.'),
];

describe('TfIdfBm25Retriever', () => {
  describe('ranking', () => {
    it('ranks the most relevant chunk highest for a withdrawal query', () => {
      const results = retriever.retrieve('withdrawal pending funds', CORPUS, 3);
      expect(results[0]?.chunk.chunk_id).toBe('payments-001');
    });

    it('ranks security chunk highest for an account locked query', () => {
      const results = retriever.retrieve('account locked security review', CORPUS, 3);
      const topId = results[0]?.chunk.chunk_id;
      expect(['security-001', 'security-002']).toContain(topId);
    });

    it('ranks trade reversal chunk highest for a trade dispute query', () => {
      const results = retriever.retrieve('reverse trade loss platform error', CORPUS, 3);
      expect(results[0]?.chunk.chunk_id).toBe('trading-001');
    });

    it('returns scores in descending order', () => {
      const results = retriever.retrieve('withdrawal payment verified', CORPUS, 4);
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    it('assigns higher score to chunks with more query-term overlap', () => {
      const specific = retriever.retrieve('password reset two-factor authentication unauthorised access', CORPUS, 2);
      expect(specific[0]?.chunk.chunk_id).toBe('security-002');
    });
  });

  describe('topK limit', () => {
    it('returns at most topK results', () => {
      const results = retriever.retrieve('account', CORPUS, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns all chunks when topK exceeds corpus size', () => {
      const results = retriever.retrieve('account', CORPUS, 100);
      expect(results.length).toBe(CORPUS.length);
    });

    it('returns exactly topK when corpus is larger', () => {
      const results = retriever.retrieve('payment', CORPUS, 3);
      expect(results.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('returns [] for an empty corpus', () => {
      expect(retriever.retrieve('withdrawal', [], 4)).toEqual([]);
    });

    it('returns [] for an empty query', () => {
      expect(retriever.retrieve('', CORPUS, 4)).toEqual([]);
    });

    it('returns [] for a whitespace-only query', () => {
      expect(retriever.retrieve('   ', CORPUS, 4)).toEqual([]);
    });

    it('handles a query with only punctuation gracefully', () => {
      const results = retriever.retrieve('!!!???...', CORPUS, 4);
      expect(results).toEqual([]);
    });

    it('is case-insensitive', () => {
      const lower = retriever.retrieve('withdrawal', CORPUS, 3);
      const upper = retriever.retrieve('WITHDRAWAL', CORPUS, 3);
      expect(lower[0]?.chunk.chunk_id).toBe(upper[0]?.chunk.chunk_id);
      expect(lower[0]?.score).toBeCloseTo(upper[0]?.score ?? 0, 8);
    });

    it('is deterministic — same query produces same ranked order', () => {
      const a = retriever.retrieve('security account restricted', CORPUS, 4);
      const b = retriever.retrieve('security account restricted', CORPUS, 4);
      expect(a.map((r) => r.chunk.chunk_id)).toEqual(b.map((r) => r.chunk.chunk_id));
    });
  });

  describe('IDF behaviour', () => {
    it('gives lower weight to terms that appear in many chunks', () => {
      // "account" appears in multiple chunks; a rare term should score higher
      const rareCorpus: KnowledgeChunk[] = [
        makeChunk('a-001', 'zymurgy is the study of fermentation processes'),
        makeChunk('a-002', 'common word appears in many documents across the corpus'),
        makeChunk('a-003', 'another document with common word and generic text'),
        makeChunk('a-004', 'yet another common word document here'),
      ];
      const results = retriever.retrieve('zymurgy', rareCorpus, 4);
      // The chunk with the rare term should rank first
      expect(results[0]?.chunk.chunk_id).toBe('a-001');
    });
  });
});
