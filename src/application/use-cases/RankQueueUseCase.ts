import { FinalTicketOutput } from '../../domain/entities/FinalTicketOutput.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';
import { CustomerTier } from '../../domain/entities/RawTicket.js';
import { Queue } from '../../domain/value-objects/Queue.js';
import { TicketCategory } from '../../domain/value-objects/TicketCategory.js';
import { UrgencyLevel } from '../../domain/value-objects/UrgencyLevel.js';

export interface QueueEntry {
  ticket_id: string;
  rank: number;
  score: number;
  recommended_queue: Queue;
  urgency: UrgencyLevel;
  customer_tier: CustomerTier;
  category: TicketCategory;
}

export interface RankQueueResult {
  ranking: QueueEntry[];
  nextState: PipelineState;
}

const URGENCY_SCORE: Record<UrgencyLevel, number> = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10,
};

const TIER_SCORE: Record<CustomerTier, number> = {
  vip: 10,
  standard: 0,
};

const CATEGORY_SCORE: Record<TicketCategory, number> = {
  withdrawal_delay: 10,
  account_security: 9,
  account_access: 8,
  trade_dispute: 6,
  general_query: 0,
};

export class RankQueueUseCase {
  constructor(private readonly artifactRepo: IArtifactRepository) {}

  async execute(
    tickets: Ticket[],
    outputs: FinalTicketOutput[],
    currentState: PipelineState,
  ): Promise<RankQueueResult> {
    assertState(currentState, PipelineState.FINAL_OUTPUTS_WRITTEN);

    const ticketMap = new Map(tickets.map((t) => [t.ticket_id, t]));
    const entries: QueueEntry[] = [];

    for (const output of outputs) {
      const ticket = ticketMap.get(output.ticket_id);
      if (!ticket) continue;

      const urgency = output.final_triage.urgency;
      const tier = ticket.customer_tier;
      const category = output.final_triage.category;

      const score =
        (URGENCY_SCORE[urgency] ?? 0) +
        (TIER_SCORE[tier] ?? 0) +
        (CATEGORY_SCORE[category] ?? 0);

      entries.push({
        ticket_id: output.ticket_id,
        rank: 0,
        score,
        recommended_queue: output.final_triage.recommended_queue,
        urgency,
        customer_tier: tier,
        category,
      });
    }

    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, i) => { e.rank = i + 1; });

    await this.artifactRepo.write('queue_ranking.json', entries);

    return {
      ranking: entries,
      nextState: nextState(PipelineState.FINAL_OUTPUTS_WRITTEN),
    };
  }
}
