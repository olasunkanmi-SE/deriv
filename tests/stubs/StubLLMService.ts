import crypto from 'node:crypto';
import { ILLMCallLogger } from '../../src/domain/services/ILLMCallLogger.js';
import { ILLMService, LLMRequest } from '../../src/domain/services/ILLMService.js';
import { IClock } from '../../src/domain/services/IClock.js';
import { LLMStage, TicketId } from '../../src/domain/types.js';

// Fixtures keyed by stage, then optionally by ticket ID
export type StubFixtures = Partial<Record<LLMStage, string | Record<TicketId, string>>>;

export class StubLLMService implements ILLMService {
  private readonly completedRequests: LLMRequest[] = [];

  constructor(
    private readonly fixtures: StubFixtures,
    private readonly logger: ILLMCallLogger,
    private readonly clock: IClock,
  ) {}

  async complete(request: LLMRequest): Promise<string> {
    const stageFixture = this.fixtures[request.stage];
    let response: string;

    if (typeof stageFixture === 'string') {
      response = stageFixture;
    } else if (stageFixture && typeof stageFixture === 'object') {
      const ticketId = request.ticketIds[0];
      response = (ticketId ? stageFixture[ticketId] : undefined) ?? '{}';
    } else {
      response = '{}';
    }

    await this.logger.log({
      stage: request.stage,
      timestamp: this.clock.now(),
      provider: 'stub',
      model: 'stub',
      prompt_hash: sha256(request.prompt),
      input_artifacts: request.inputArtifacts,
      output_artifact: request.outputArtifact,
      ticket_ids: request.ticketIds,
      chunk_ids_included: request.chunkIds,
    });

    this.completedRequests.push(request);
    return response;
  }

  getCompletedRequests(): LLMRequest[] {
    return [...this.completedRequests];
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
