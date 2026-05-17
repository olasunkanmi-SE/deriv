import path from 'node:path';
import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { IKnowledgeRepository } from '../../domain/repositories/IKnowledgeRepository.js';
import { IChunker } from '../../domain/services/IChunker.js';

export interface IndexKnowledgeResult {
  chunks: KnowledgeChunk[];
  ingestionFailures: string[];
  nextState: PipelineState;
}

export class IndexKnowledgeUseCase {
  constructor(
    private readonly knowledgeRepo: IKnowledgeRepository,
    private readonly chunker: IChunker,
    private readonly artifactRepo: IArtifactRepository,
  ) {}

  async execute(currentState: PipelineState): Promise<IndexKnowledgeResult> {
    assertState(currentState, PipelineState.INPUTS_LOADED);

    const files = await this.knowledgeRepo.loadFiles();
    const allChunks: KnowledgeChunk[] = [];
    const failures: string[] = [];

    for (const file of files) {
      const documentId = path.basename(file.fileName, path.extname(file.fileName));
      try {
        const chunks = this.chunker.chunk(file.content, documentId, file.fileName);
        if (chunks.length === 0) {
          console.warn(`[IndexKnowledge] Blank or empty file produced no chunks: ${file.fileName}`);
          failures.push(file.fileName);
          continue;
        }
        allChunks.push(...chunks);
      } catch (err) {
        console.warn(`[IndexKnowledge] Failed to chunk "${file.fileName}": ${String(err)}`);
        failures.push(file.fileName);
      }
    }

    if (failures.length > 0) {
      console.warn(`[IndexKnowledge] ${failures.length} file(s) had ingestion failures: ${failures.join(', ')}`);
    }

    await this.artifactRepo.write('knowledge_corpus.json', allChunks);

    return {
      chunks: allChunks,
      ingestionFailures: failures,
      nextState: nextState(PipelineState.INPUTS_LOADED),
    };
  }
}
