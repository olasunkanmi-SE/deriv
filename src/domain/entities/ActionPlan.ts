import { ActionId, TicketId } from '../types.js';
import { ActionPriority } from '../value-objects/ActionPriority.js';
import { Queue } from '../value-objects/Queue.js';

export interface Action {
  action_id: ActionId;
  description: string;
  owner_queue: Queue;
  priority: ActionPriority;
  depends_on: ActionId[];
}

export interface ActionPlan {
  ticket_id: TicketId;
  actions: Action[];
  handoff_note: string;
}
