import { ChunkId } from '../types.js';

export interface KnowledgeChunk {
  document_id: string;
  source_file: string;
  chunk_id: ChunkId;
  section_title: string;
  text: string;
  character_count: number;
  content_hash: string;
}
