import { ILLMCallLogger, LLMCallRecord } from '../../domain/services/ILLMCallLogger.js';
import { IArtifactRepository } from '../../domain/repositories/IArtifactRepository.js';

export class JsonlLLMCallLogger implements ILLMCallLogger {
  constructor(private readonly artifactRepo: IArtifactRepository) {}

  async log(record: LLMCallRecord): Promise<void> {
    await this.artifactRepo.appendLine('llm_calls.jsonl', JSON.stringify(record));
  }
}
