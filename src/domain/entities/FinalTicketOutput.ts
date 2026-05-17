import { TicketId } from '../types.js';
import { ActionPlan } from './ActionPlan.js';
import { ResponseDraft } from './ResponseDraft.js';
import { TriageResult } from './TriageResult.js';

export interface ValidationSummary {
  unsupported_claims_found: number;
  corrected: boolean;
}

export interface FinalTicketOutput {
  ticket_id: TicketId;
  final_triage: TriageResult;
  final_response: ResponseDraft;
  final_action_plan: ActionPlan;
  validation_summary: ValidationSummary;
}
