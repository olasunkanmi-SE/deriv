import { ChunkId, LLMStage, TicketId } from '../types.js';

export interface LLMCallRecord {
  stage: LLMStage;
  timestamp: string;
  provider: string;
  model: string;
  prompt_hash: string;
  input_artifacts: string[];
  output_artifact: string;
  ticket_ids: TicketId[];
  chunk_ids_included: ChunkId[];
}

export interface ILLMCallLogger {
  log(record: LLMCallRecord): Promise<void>;
}
