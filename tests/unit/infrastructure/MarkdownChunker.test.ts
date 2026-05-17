import { describe, it, expect } from 'vitest';
import { MarkdownChunker } from '../../../src/infrastructure/retrieval/MarkdownChunker.js';

const chunker = new MarkdownChunker();

describe('MarkdownChunker', () => {
  describe('chunk IDs and metadata', () => {
    it('assigns stable sequential IDs prefixed with document ID', () => {
      const content = '# Section One\nContent one.\n\n# Section Two\nContent two.';
      const chunks = chunker.chunk(content, 'payments', 'knowledge_base/payments.md');

      expect(chunks[0]?.chunk_id).toBe('payments-001');
      expect(chunks[1]?.chunk_id).toBe('payments-002');
    });

    it('records the correct source_file and document_id', () => {
      const content = '# Title\nSome text.';
      const chunks = chunker.chunk(content, 'security', 'knowledge_base/security.md');

      expect(chunks[0]?.document_id).toBe('security');
      expect(chunks[0]?.source_file).toBe('knowledge_base/security.md');
    });

    it('computes a non-empty SHA-256 content_hash', () => {
      const content = '# Title\nSome text.';
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces the same hash for identical text', () => {
      const content = '# Title\nExact same text.';
      const a = chunker.chunk(content, 'doc', 'doc.md');
      const b = chunker.chunk(content, 'doc', 'doc.md');
      expect(a[0]?.content_hash).toBe(b[0]?.content_hash);
    });

    it('sets character_count to the trimmed text length', () => {
      const content = '# Title\nHello world.';
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      const chunk = chunks[0]!;
      expect(chunk.character_count).toBe(chunk.text.length);
    });
  });

  describe('section splitting', () => {
    it('creates one chunk per top-level heading', () => {
      const content = [
        '# Withdrawals',
        'Withdrawal info.',
        '',
        '# Security',
        'Security info.',
        '',
        '# Trading',
        'Trading info.',
      ].join('\n');

      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks.length).toBe(3);
      expect(chunks[0]?.section_title).toBe('Withdrawals');
      expect(chunks[1]?.section_title).toBe('Security');
      expect(chunks[2]?.section_title).toBe('Trading');
    });

    it('includes both heading and body in the chunk text', () => {
      const content = '# Withdrawals\nVerified customers get 24h review.';
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks[0]?.text).toContain('Withdrawals');
      expect(chunks[0]?.text).toContain('Verified customers');
    });

    it('handles sub-headings (##) as separate chunks', () => {
      const content = [
        '# Main',
        'Main body.',
        '',
        '## Sub-section',
        'Sub body.',
      ].join('\n');

      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks.length).toBe(2);
      expect(chunks[1]?.section_title).toBe('Sub-section');
    });

    it('content before the first heading becomes a preamble chunk', () => {
      const content = 'Intro text before any heading.\n\n# Section One\nBody.';
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks.length).toBe(2);
      expect(chunks[0]?.section_title).toBe('(preamble)');
      expect(chunks[0]?.text).toContain('Intro text');
    });

    it('document with no headings becomes a single chunk', () => {
      const content = 'Just some plain text with no headings at all.';
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.text).toContain('Just some plain text');
    });
  });

  describe('blank and empty input', () => {
    it('returns [] for empty string', () => {
      expect(chunker.chunk('', 'doc', 'doc.md')).toEqual([]);
    });

    it('returns [] for whitespace-only content', () => {
      expect(chunker.chunk('   \n\n\t  ', 'doc', 'doc.md')).toEqual([]);
    });
  });

  describe('large section splitting', () => {
    it('splits a section exceeding 1200 chars on double-newline boundaries', () => {
      // Each paragraph is ~500 chars; 4 of them + heading = ~2022 chars > 1200
      const para = (n: number) => `Para${n} word `.repeat(50).trim();
      const content = [
        '# Large Section',
        para(1),
        '',
        para(2),
        '',
        para(3),
        '',
        para(4),
      ].join('\n');

      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.character_count).toBeLessThanOrEqual(1200 + 50); // allow slight overage at boundary
      }
    });

    it('each sub-chunk from a split section shares the same section_title', () => {
      const para = 'Word '.repeat(100).trim();
      const content = `# Big Section\n${para}\n\n${para}\n\n${para}\n\n${para}`;
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      const titles = new Set(chunks.map((c) => c.section_title));
      expect(titles.size).toBe(1);
    });
  });

  describe('chunk ID uniqueness', () => {
    it('all chunk IDs are unique within a document', () => {
      const content = Array.from({ length: 10 }, (_, i) => `# Section ${i}\nBody ${i}.`).join('\n\n');
      const chunks = chunker.chunk(content, 'doc', 'doc.md');
      const ids = chunks.map((c) => c.chunk_id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
