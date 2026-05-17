import { KnowledgeChunk } from '../entities/KnowledgeChunk.js';

export interface IChunker {
  chunk(content: string, documentId: string, sourceFile: string): KnowledgeChunk[];
}
