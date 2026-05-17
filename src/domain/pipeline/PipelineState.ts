import { PipelineStateError } from '../errors.js';

export enum PipelineState {
  INIT                  = 'INIT',
  INPUTS_LOADED         = 'INPUTS_LOADED',
  KNOWLEDGE_INDEXED     = 'KNOWLEDGE_INDEXED',
  TICKETS_NORMALISED    = 'TICKETS_NORMALISED',
  RETRIEVAL_COMPLETE    = 'RETRIEVAL_COMPLETE',
  TRIAGE_COMPLETE       = 'TRIAGE_COMPLETE',
  RESPONSE_DRAFTED      = 'RESPONSE_DRAFTED',
  ACTION_PLAN_CREATED   = 'ACTION_PLAN_CREATED',
  GROUNDING_VALIDATED   = 'GROUNDING_VALIDATED',
  FINAL_OUTPUTS_WRITTEN = 'FINAL_OUTPUTS_WRITTEN',
  AUDIT_LOG_EXPORTED    = 'AUDIT_LOG_EXPORTED',
  VALIDATION_COMPLETE   = 'VALIDATION_COMPLETE',
  RESULTS_FINALISED     = 'RESULTS_FINALISED',
}

export const TRANSITIONS: Readonly<Record<PipelineState, PipelineState | null>> = {
  [PipelineState.INIT]:                  PipelineState.INPUTS_LOADED,
  [PipelineState.INPUTS_LOADED]:         PipelineState.KNOWLEDGE_INDEXED,
  [PipelineState.KNOWLEDGE_INDEXED]:     PipelineState.TICKETS_NORMALISED,
  [PipelineState.TICKETS_NORMALISED]:    PipelineState.RETRIEVAL_COMPLETE,
  [PipelineState.RETRIEVAL_COMPLETE]:    PipelineState.TRIAGE_COMPLETE,
  [PipelineState.TRIAGE_COMPLETE]:       PipelineState.RESPONSE_DRAFTED,
  [PipelineState.RESPONSE_DRAFTED]:      PipelineState.ACTION_PLAN_CREATED,
  [PipelineState.ACTION_PLAN_CREATED]:   PipelineState.GROUNDING_VALIDATED,
  [PipelineState.GROUNDING_VALIDATED]:   PipelineState.FINAL_OUTPUTS_WRITTEN,
  [PipelineState.FINAL_OUTPUTS_WRITTEN]: PipelineState.AUDIT_LOG_EXPORTED,
  [PipelineState.AUDIT_LOG_EXPORTED]:    PipelineState.VALIDATION_COMPLETE,
  [PipelineState.VALIDATION_COMPLETE]:   PipelineState.RESULTS_FINALISED,
  [PipelineState.RESULTS_FINALISED]:     null,
};

export function assertState(current: PipelineState, required: PipelineState): void {
  if (current !== required) {
    throw new PipelineStateError(current, required);
  }
}

export function nextState(current: PipelineState): PipelineState {
  const next = TRANSITIONS[current];
  if (next === null) {
    throw new PipelineStateError(current, 'a non-terminal state');
  }
  return next;
}
