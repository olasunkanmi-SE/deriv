import { describe, it, expect, vi } from 'vitest';
import { LoadInputsUseCase } from '../../../src/application/use-cases/LoadInputsUseCase.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { ITicketRepository } from '../../../src/domain/repositories/ITicketRepository.js';
import type { RawTicket } from '../../../src/domain/entities/RawTicket.js';

function makeRawTicket(overrides: Partial<RawTicket> = {}): RawTicket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending for 3 days',
    message: 'My withdrawal has been pending.',
    ...overrides,
  };
}

describe('LoadInputsUseCase', () => {
  it('throws PipelineStateError when state is not INIT', async () => {
    const repo: ITicketRepository = { loadAll: vi.fn() };
    const useCase = new LoadInputsUseCase(repo);

    await expect(useCase.execute(PipelineState.INPUTS_LOADED)).rejects.toThrow(PipelineStateError);
  });

  it('returns tickets from the repository and advances to INPUTS_LOADED', async () => {
    const tickets = [makeRawTicket(), makeRawTicket({ ticket_id: 'T-1002' })];
    const repo: ITicketRepository = { loadAll: vi.fn().mockResolvedValue(tickets) };
    const useCase = new LoadInputsUseCase(repo);

    const result = await useCase.execute(PipelineState.INIT);

    expect(result.tickets).toEqual(tickets);
    expect(result.nextState).toBe(PipelineState.INPUTS_LOADED);
  });

  it('returns an empty array and warns when no valid tickets are found', async () => {
    const repo: ITicketRepository = { loadAll: vi.fn().mockResolvedValue([]) };
    const useCase = new LoadInputsUseCase(repo);

    const result = await useCase.execute(PipelineState.INIT);

    expect(result.tickets).toHaveLength(0);
    expect(result.nextState).toBe(PipelineState.INPUTS_LOADED);
  });

  it('propagates errors thrown by the repository', async () => {
    const repo: ITicketRepository = {
      loadAll: vi.fn().mockRejectedValue(new Error('file not found')),
    };
    const useCase = new LoadInputsUseCase(repo);

    await expect(useCase.execute(PipelineState.INIT)).rejects.toThrow('file not found');
  });
});
