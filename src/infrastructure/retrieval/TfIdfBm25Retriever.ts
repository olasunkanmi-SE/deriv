import { KnowledgeChunk } from '../../domain/entities/KnowledgeChunk.js';
import { IRetrievalService, RetrievalCandidate } from '../../domain/services/IRetrievalService.js';

const K1 = 1.5;
const B = 0.75;

export class TfIdfBm25Retriever implements IRetrievalService {
  retrieve(query: string, chunks: KnowledgeChunk[], topK: number): RetrievalCandidate[] {
    if (chunks.length === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const tokenizedChunks = chunks.map((c) => tokenize(c.text));
    const totalTokens = tokenizedChunks.reduce((sum, t) => sum + t.length, 0);
    const avgdl = totalTokens / chunks.length;
    const N = chunks.length;

    // Document frequency: how many chunks contain each term
    const df = new Map<string, number>();
    for (const tokens of tokenizedChunks) {
      for (const term of new Set(tokens)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }

    const idf = (term: string): number => {
      const n = df.get(term) ?? 0;
      return Math.log((N - n + 0.5) / (n + 0.5) + 1);
    };

    const scored: RetrievalCandidate[] = chunks.map((chunk, i) => {
      const tokens = tokenizedChunks[i]!;
      const dl = tokens.length;

      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      let score = 0;
      for (const term of new Set(queryTokens)) {
        const termFreq = tf.get(term) ?? 0;
        if (termFreq === 0) continue;
        const numerator = termFreq * (K1 + 1);
        const denominator = termFreq + K1 * (1 - B + B * (dl / avgdl));
        score += idf(term) * (numerator / denominator);
      }

      return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}
