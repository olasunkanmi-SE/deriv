import { ChunkId, LLMStage, TicketId } from '../types.js';

export interface LLMRequest {
  prompt: string;
  stage: LLMStage;
  ticketIds: TicketId[];
  chunkIds: ChunkId[];
  inputArtifacts: string[];
  outputArtifact: string;
}

export interface ILLMService {
  complete(request: LLMRequest): Promise<string>;
}
