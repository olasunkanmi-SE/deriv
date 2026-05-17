import { RawTicket } from '../../domain/entities/RawTicket.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';
import { ITicketRepository } from '../../domain/repositories/ITicketRepository.js';

export interface LoadInputsResult {
  tickets: RawTicket[];
  nextState: PipelineState;
}

export class LoadInputsUseCase {
  constructor(private readonly ticketRepo: ITicketRepository) {}

  async execute(currentState: PipelineState): Promise<LoadInputsResult> {
    assertState(currentState, PipelineState.INIT);

    const tickets = await this.ticketRepo.loadAll();

    if (tickets.length === 0) {
      console.warn('[LoadInputs] No valid tickets found in the input file.');
    }

    return {
      tickets,
      nextState: nextState(PipelineState.INIT),
    };
  }
}
