import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IndexKnowledgeUseCase } from '../../../src/application/use-cases/IndexKnowledgeUseCase.js';
import { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import type { IKnowledgeRepository } from '../../../src/domain/repositories/IKnowledgeRepository.js';
import type { IChunker } from '../../../src/domain/services/IChunker.js';

function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    document_id: 'payments',
    source_file: 'knowledge_base/payments.md',
    chunk_id: 'payments-001',
    section_title: 'Withdrawals',
    text: 'Withdrawal policy text.',
    character_count: 24,
    content_hash: 'abc123',
    ...overrides,
  };
}

function makeRepos() {
  const knowledgeRepo: IKnowledgeRepository = {
    loadFiles: vi.fn().mockResolvedValue([
      { fileName: 'knowledge_base/payments.md', content: '# Withdrawals\nSome text.' },
    ]),
  };

  const chunker: IChunker = {
    chunk: vi.fn().mockReturnValue([makeChunk()]),
  };

  const written: Record<string, unknown> = {};
  const artifactRepo: IArtifactRepository = {
    write: vi.fn().mockImplementation(async (name: string, data: unknown) => {
      written[name] = data;
    }),
    read: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    appendLine: vi.fn(),
  };

  return { knowledgeRepo, chunker, artifactRepo, written };
}

describe('IndexKnowledgeUseCase', () => {
  it('throws PipelineStateError when state is not INPUTS_LOADED', async () => {
    const { knowledgeRepo, chunker, artifactRepo } = makeRepos();
    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, chunker, artifactRepo);

    await expect(useCase.execute(PipelineState.INIT)).rejects.toThrow(PipelineStateError);
  });

  it('writes knowledge_corpus.json with the chunked output', async () => {
    const { knowledgeRepo, chunker, artifactRepo, written } = makeRepos();
    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, chunker, artifactRepo);

    await useCase.execute(PipelineState.INPUTS_LOADED);

    expect(artifactRepo.write).toHaveBeenCalledWith('knowledge_corpus.json', expect.any(Array));
    expect(written['knowledge_corpus.json']).toEqual([makeChunk()]);
  });

  it('returns all chunks and advances to KNOWLEDGE_INDEXED', async () => {
    const { knowledgeRepo, chunker, artifactRepo } = makeRepos();
    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, chunker, artifactRepo);

    const result = await useCase.execute(PipelineState.INPUTS_LOADED);

    expect(result.chunks).toHaveLength(1);
    expect(result.nextState).toBe(PipelineState.KNOWLEDGE_INDEXED);
    expect(result.ingestionFailures).toHaveLength(0);
  });

  it('records a failure and skips a blank file without crashing', async () => {
    const { chunker, artifactRepo } = makeRepos();
    const knowledgeRepo: IKnowledgeRepository = {
      loadFiles: vi.fn().mockResolvedValue([
        { fileName: 'knowledge_base/empty.md', content: '' },
        { fileName: 'knowledge_base/payments.md', content: '# Payments\nText.' },
      ]),
    };
    vi.mocked(chunker.chunk)
      .mockReturnValueOnce([])            // blank file → no chunks
      .mockReturnValueOnce([makeChunk()]); // normal file → one chunk

    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, chunker, artifactRepo);
    const result = await useCase.execute(PipelineState.INPUTS_LOADED);

    expect(result.ingestionFailures).toContain('knowledge_base/empty.md');
    expect(result.chunks).toHaveLength(1);
  });

  it('records a failure when the chunker throws', async () => {
    const { knowledgeRepo, artifactRepo } = makeRepos();
    const brokenChunker: IChunker = {
      chunk: vi.fn().mockImplementation(() => { throw new Error('parse error'); }),
    };

    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, brokenChunker, artifactRepo);
    const result = await useCase.execute(PipelineState.INPUTS_LOADED);

    expect(result.ingestionFailures).toHaveLength(1);
    expect(result.chunks).toHaveLength(0);
  });

  it('aggregates chunks from multiple files', async () => {
    const { artifactRepo } = makeRepos();
    const knowledgeRepo: IKnowledgeRepository = {
      loadFiles: vi.fn().mockResolvedValue([
        { fileName: 'knowledge_base/payments.md', content: '# A\nA.' },
        { fileName: 'knowledge_base/security.md', content: '# B\nB.' },
      ]),
    };
    const chunker: IChunker = {
      chunk: vi.fn()
        .mockReturnValueOnce([makeChunk({ chunk_id: 'payments-001' })])
        .mockReturnValueOnce([makeChunk({ chunk_id: 'security-001', document_id: 'security' })]),
    };

    const useCase = new IndexKnowledgeUseCase(knowledgeRepo, chunker, artifactRepo);
    const result = await useCase.execute(PipelineState.INPUTS_LOADED);

    expect(result.chunks).toHaveLength(2);
  });
});
