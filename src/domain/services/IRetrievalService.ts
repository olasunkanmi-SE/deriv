import { KnowledgeChunk } from '../entities/KnowledgeChunk.js';

export interface RetrievalCandidate {
  chunk: KnowledgeChunk;
  score: number;
}

export interface RetrievalConfig {
  topK: number;
  minScore: number;
  confidenceThreshold: number;
  epsilon: number;
}

export interface IRetrievalService {
  retrieve(query: string, chunks: KnowledgeChunk[], topK: number): RetrievalCandidate[];
}
