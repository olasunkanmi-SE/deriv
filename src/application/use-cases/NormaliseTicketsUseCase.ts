import { RawTicket } from '../../domain/entities/RawTicket.js';
import { Ticket } from '../../domain/entities/Ticket.js';
import { assertState, nextState, PipelineState } from '../../domain/pipeline/PipelineState.js';

export interface NormaliseTicketsResult {
  tickets: Ticket[];
  nextState: PipelineState;
}

export class NormaliseTicketsUseCase {
  execute(rawTickets: RawTicket[], currentState: PipelineState): NormaliseTicketsResult {
    assertState(currentState, PipelineState.KNOWLEDGE_INDEXED);

    const tickets: Ticket[] = rawTickets.map(normalise);

    return {
      tickets,
      nextState: nextState(PipelineState.KNOWLEDGE_INDEXED),
    };
  }
}

function normalise(raw: RawTicket): Ticket {
  const subject = raw.subject.trim().replace(/\s+/g, ' ');
  const message = raw.message.trim().replace(/\s+/g, ' ');
  const language = normaliseLanguageCode(raw.language);
  const retrieval_query = deriveRetrievalQuery(subject, message);

  return {
    ...raw,
    subject,
    message,
    language,
    retrieval_query,
  };
}

function normaliseLanguageCode(lang: string): string {
  // Accept "en", "en-US", "EN", "EN_US" — return lowercase 2-char ISO 639-1 code
  return lang.trim().toLowerCase().slice(0, 2);
}

function deriveRetrievalQuery(subject: string, message: string): string {
  return `${subject} ${message}`.replace(/\s+/g, ' ').trim();
}
