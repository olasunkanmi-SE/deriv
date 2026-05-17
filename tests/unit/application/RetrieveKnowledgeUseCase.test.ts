import { describe, it, expect, vi } from 'vitest';
import { RetrieveKnowledgeUseCase } from '../../../src/application/use-cases/RetrieveKnowledgeUseCase.js';
import type { KnowledgeChunk } from '../../../src/domain/entities/KnowledgeChunk.js';
import type { Ticket } from '../../../src/domain/entities/Ticket.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { IArtifactRepository } from '../../../src/domain/repositories/IArtifactRepository.js';
import type { IRetrievalService, RetrievalCandidate } from '../../../src/domain/services/IRetrievalService.js';
import type { RetrievalConfig } from '../../../src/infrastructure/config/EnvConfig.js';

const CONFIG: RetrievalConfig = {
  topK: 2,
  minScore: 0.1,
  confidenceThreshold: 0.2,
  epsilon: 0.05,
};

function makeChunk(id: string): KnowledgeChunk {
  return {
    document_id: id.split('-')[0]!,
    source_file: `kb/${id}.md`,
    chunk_id: id,
    section_title: 'Section',
    text: `Text for chunk ${id}`,
    character_count: 20,
    content_hash: 'hash',
  };
}

function makeTicket(id: string): Ticket {
  return {
    ticket_id: id,
    submitted_at: '2026-05-10T09:00:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Test subject',
    message: 'Test message about withdrawal.',
    retrieval_query: 'withdrawal funds pending',
  };
}

function makeArtifactRepo(): IArtifactRepository {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(),
    exists: vi.fn().mockResolvedValue(false),
    appendLine: vi.fn(),
  };
}

describe('RetrieveKnowledgeUseCase', () => {
  it('throws PipelineStateError when state is not TICKETS_NORMALISED', async () => {
    const retriever: IRetrievalService = { retrieve: vi.fn().mockReturnValue([]) };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    await expect(
      useCase.execute([makeTicket('T-1')], [], PipelineState.RETRIEVAL_COMPLETE),
    ).rejects.toThrow(PipelineStateError);
  });

  it('writes retrieval_results.json and advances to RETRIEVAL_COMPLETE', async () => {
    const chunk = makeChunk('payments-001');
    const candidates: RetrievalCandidate[] = [{ chunk, score: 0.5 }];
    const retriever: IRetrievalService = { retrieve: vi.fn().mockReturnValue(candidates) };
    const artifactRepo = makeArtifactRepo();
    const useCase = new RetrieveKnowledgeUseCase(retriever, artifactRepo, CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(artifactRepo.write).toHaveBeenCalledWith('retrieval_results.json', expect.any(Array));
    expect(result.nextState).toBe(PipelineState.RETRIEVAL_COMPLETE);
  });

  it('returns one RetrievalResult per ticket', async () => {
    const chunk = makeChunk('payments-001');
    const retriever: IRetrievalService = {
      retrieve: vi.fn().mockReturnValue([{ chunk, score: 0.4 }]),
    };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1'), makeTicket('T-2')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.ticket_id).toBe('T-1');
    expect(result.results[1]?.ticket_id).toBe('T-2');
  });

  it('includes selected_chunk_ids for chunks above min score', async () => {
    const chunk = makeChunk('payments-001');
    const retriever: IRetrievalService = {
      retrieve: vi.fn().mockReturnValue([{ chunk, score: 0.5 }]),
    };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.results[0]?.selected_chunk_ids).toContain('payments-001');
  });

  it('excludes chunks below min score threshold', async () => {
    const chunk = makeChunk('payments-001');
    const retriever: IRetrievalService = {
      retrieve: vi.fn().mockReturnValue([{ chunk, score: 0.05 }]), // below 0.1
    };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.results[0]?.selected_chunk_ids).toHaveLength(0);
  });

  it('flags low_retrieval_confidence when top score is below confidenceThreshold', async () => {
    const chunk = makeChunk('payments-001');
    const retriever: IRetrievalService = {
      // Score is above minScore (0.1) but below confidenceThreshold (0.2)
      retrieve: vi.fn().mockReturnValue([{ chunk, score: 0.15 }]),
    };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.tickets[0]?.low_retrieval_confidence).toBe(true);
  });

  it('does not flag low_retrieval_confidence when top score is above threshold', async () => {
    const chunk = makeChunk('payments-001');
    const retriever: IRetrievalService = {
      retrieve: vi.fn().mockReturnValue([{ chunk, score: 0.8 }]),
    };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      [chunk],
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.tickets[0]?.low_retrieval_confidence).toBe(false);
  });

  it('sets omitted_relevant_risk when K+1 score is within 15% of Kth score', async () => {
    const chunks = [
      makeChunk('payments-001'),
      makeChunk('payments-002'),
      makeChunk('security-001'), // K+1
    ];
    // topK = 2; spillover score is 95% of Kth → should trigger omitted risk
    const candidates: RetrievalCandidate[] = [
      { chunk: chunks[0]!, score: 0.9 },
      { chunk: chunks[1]!, score: 0.5 },  // Kth
      { chunk: chunks[2]!, score: 0.48 }, // spillover: 0.48/0.5 = 0.96 ≥ 0.85
    ];
    const retriever: IRetrievalService = { retrieve: vi.fn().mockReturnValue(candidates) };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      chunks,
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.results[0]?.omitted_relevant_risk).not.toBeNull();
    expect(result.results[0]?.omitted_relevant_risk).toContain('security-001');
  });

  it('sets omitted_relevant_risk to null when K+1 score is far below Kth', async () => {
    const chunks = [makeChunk('payments-001'), makeChunk('payments-002'), makeChunk('security-001')];
    const candidates: RetrievalCandidate[] = [
      { chunk: chunks[0]!, score: 0.9 },
      { chunk: chunks[1]!, score: 0.5 },  // Kth
      { chunk: chunks[2]!, score: 0.1 },  // spillover: 0.1/0.5 = 0.2 < 0.85
    ];
    const retriever: IRetrievalService = { retrieve: vi.fn().mockReturnValue(candidates) };
    const useCase = new RetrieveKnowledgeUseCase(retriever, makeArtifactRepo(), CONFIG);

    const result = await useCase.execute(
      [makeTicket('T-1')],
      chunks,
      PipelineState.TICKETS_NORMALISED,
    );

    expect(result.results[0]?.omitted_relevant_risk).toBeNull();
  });
});
