export class VocabularyError extends Error {
  constructor(vocab: string, received: string, allowed: readonly string[]) {
    super(`Invalid ${vocab}: "${received}". Allowed values: ${allowed.join(', ')}`);
    this.name = 'VocabularyError';
  }
}

export class PipelineStateError extends Error {
  constructor(current: string, required: string) {
    super(`Pipeline state mismatch: expected "${required}", current is "${current}"`);
    this.name = 'PipelineStateError';
  }
}
