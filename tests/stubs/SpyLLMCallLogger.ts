import { ILLMCallLogger, LLMCallRecord } from '../../src/domain/services/ILLMCallLogger.js';

export class SpyLLMCallLogger implements ILLMCallLogger {
  readonly records: LLMCallRecord[] = [];

  async log(record: LLMCallRecord): Promise<void> {
    this.records.push(record);
  }

  clear(): void {
    this.records.length = 0;
  }
}
