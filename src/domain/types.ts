export type ChunkId = string;
export type TicketId = string;
export type ActionId = string;

export type LLMStage =
  | 'triage'
  | 'response_drafting'
  | 'action_planning'
  | 'grounding_validation';
