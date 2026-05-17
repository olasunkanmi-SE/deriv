import { describe, it, expect } from 'vitest';
import { NormaliseTicketsUseCase } from '../../../src/application/use-cases/NormaliseTicketsUseCase.js';
import { PipelineStateError } from '../../../src/domain/errors.js';
import { PipelineState } from '../../../src/domain/pipeline/PipelineState.js';
import type { RawTicket } from '../../../src/domain/entities/RawTicket.js';

function makeRaw(overrides: Partial<RawTicket> = {}): RawTicket {
  return {
    ticket_id: 'T-1001',
    submitted_at: '2026-05-10T09:15:00Z',
    customer_tier: 'standard',
    language: 'en',
    subject: 'Withdrawal pending for 3 days',
    message: 'My withdrawal has been pending for three days.',
    ...overrides,
  };
}

const useCase = new NormaliseTicketsUseCase();

describe('NormaliseTicketsUseCase', () => {
  it('throws PipelineStateError when state is not KNOWLEDGE_INDEXED', () => {
    expect(() =>
      useCase.execute([makeRaw()], PipelineState.INPUTS_LOADED),
    ).toThrow(PipelineStateError);
  });

  it('advances to TICKETS_NORMALISED', () => {
    const result = useCase.execute([makeRaw()], PipelineState.KNOWLEDGE_INDEXED);
    expect(result.nextState).toBe(PipelineState.TICKETS_NORMALISED);
  });

  it('preserves original fields that need no normalisation', () => {
    const raw = makeRaw();
    const result = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED);
    const ticket = result.tickets[0]!;

    expect(ticket.ticket_id).toBe(raw.ticket_id);
    expect(ticket.submitted_at).toBe(raw.submitted_at);
    expect(ticket.customer_tier).toBe(raw.customer_tier);
  });

  describe('whitespace trimming', () => {
    it('trims leading and trailing whitespace from subject', () => {
      const raw = makeRaw({ subject: '  Withdrawal pending  ' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.subject).toBe('Withdrawal pending');
    });

    it('trims leading and trailing whitespace from message', () => {
      const raw = makeRaw({ message: '  Please help.  ' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.message).toBe('Please help.');
    });

    it('collapses internal multiple spaces in subject', () => {
      const raw = makeRaw({ subject: 'Withdrawal   pending   now' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.subject).toBe('Withdrawal pending now');
    });
  });

  describe('language normalisation', () => {
    it('lowercases the language code', () => {
      const raw = makeRaw({ language: 'EN' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.language).toBe('en');
    });

    it('truncates to 2-char ISO code from full locale', () => {
      const raw = makeRaw({ language: 'en-US' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.language).toBe('en');
    });

    it('handles underscore-separated locale', () => {
      const raw = makeRaw({ language: 'EN_GB' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.language).toBe('en');
    });
  });

  describe('retrieval_query derivation', () => {
    it('combines subject and message into the retrieval query', () => {
      const raw = makeRaw({
        subject: 'Withdrawal pending',
        message: 'My funds have not arrived.',
      });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.retrieval_query).toContain('Withdrawal pending');
      expect(ticket.retrieval_query).toContain('My funds have not arrived');
    });

    it('retrieval query is a single space-separated string with no double spaces', () => {
      const raw = makeRaw({ subject: '  Pending  ', message: '  Help me.  ' });
      const ticket = useCase.execute([raw], PipelineState.KNOWLEDGE_INDEXED).tickets[0]!;
      expect(ticket.retrieval_query).not.toMatch(/\s{2,}/);
      expect(ticket.retrieval_query.startsWith(' ')).toBe(false);
      expect(ticket.retrieval_query.endsWith(' ')).toBe(false);
    });
  });

  it('normalises all four sample tickets without error', () => {
    const raws: RawTicket[] = [
      makeRaw({ ticket_id: 'T-1001', language: 'en' }),
      makeRaw({ ticket_id: 'T-1002', language: 'EN', customer_tier: 'vip' }),
      makeRaw({ ticket_id: 'T-1003', language: 'en-US' }),
      makeRaw({ ticket_id: 'T-1004', language: 'EN_GB' }),
    ];

    const result = useCase.execute(raws, PipelineState.KNOWLEDGE_INDEXED);

    expect(result.tickets).toHaveLength(4);
    for (const ticket of result.tickets) {
      expect(ticket.retrieval_query.length).toBeGreaterThan(0);
      expect(ticket.language).toHaveLength(2);
    }
  });
});
